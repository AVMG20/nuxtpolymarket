import { DF_RECONNECT_GRACE, DF_TICK_HZ } from '#shared/utils/dead-front/constants'
import { DF_MAP } from '#shared/utils/dead-front/map'
import type { DfClientMsg, DfMatchEnd, DfMatchStart, DfServerMsg } from '#shared/utils/dead-front/protocol'
import type { DfProfileView, DfProgressReport, DfWeaponId } from '#shared/utils/dead-front/types'
import { DF_WEAPONS, DF_WEAPON_IDS, dfSanitizeAttachments, dfWeaponLevel } from '#shared/utils/dead-front/weapons'
import { DfMatchSim } from './sim'
import type { DfPlayerSetup } from './sim-types'

// One running match: owns the simulation, its 20 Hz tick, the snapshot fan-out,
// reconnect grace and the once-per-player progression write. The hub routes
// in-match messages here.

export interface DfMatchMember {
    userId: string
    name: string
}

export interface DfMatchHooks {
    /** Send a raw frame to a user's current socket (no-op when they have none). */
    send: (userId: string, frame: string) => void
    /** A player is gone for good (left, or the reconnect grace ran out). */
    onPlayerGone: (userId: string) => void
    /** The match is over and cleaned up. */
    onFinished: (match: DfMatch) => void
    onRound?: (round: number) => void
    loadProfile: (userId: string) => Promise<DfProfileView>
    applyResult: (userId: string, result: import('#shared/utils/dead-front/types').DfMatchResult) => Promise<DfProgressReport>
}

interface MatchPlayer {
    userId: string
    name: string
    pid: number
    applied: boolean
    progress: DfProgressReport | null
    gone: boolean
    graceTimer: ReturnType<typeof setTimeout> | null
}

let matchSeq = 0

/** Resolves a profile into the simulation's player setup (validated start weapon, sanitised attachments). */
export function dfPlayerSetup(member: DfMatchMember, profile: DfProfileView): DfPlayerSetup {
    const wanted = profile.loadout?.startWeapon
    const startWeapon: DfWeaponId = wanted && DF_WEAPONS[wanted] && DF_WEAPONS[wanted].startable && profile.unlockedWeapons.includes(wanted) ? wanted : 'm1911'
    const attachments: DfPlayerSetup['attachments'] = {}
    for (const id of DF_WEAPON_IDS) {
        const choice = profile.loadout?.attachments?.[id]
        if (!choice) continue
        attachments[id] = dfSanitizeAttachments(id, dfWeaponLevel(profile.weaponXp?.[id] ?? 0), choice)
    }
    return { userId: member.userId, name: member.name, startWeapon, attachments, perkMods: profile.perkMods ?? {} }
}

export class DfMatch {
    readonly id: string
    readonly sim: DfMatchSim
    private readonly players: MatchPlayer[]
    private readonly hooks: DfMatchHooks
    private timer: ReturnType<typeof setInterval> | null = null
    private lastTickAt = 0
    /** Seconds of wall time not yet simulated. */
    private tickDebt = 0
    private finished = false
    private lastRound = 0

    private constructor(id: string, sim: DfMatchSim, players: MatchPlayer[], hooks: DfMatchHooks) {
        this.id = id
        this.sim = sim
        this.players = players
        this.hooks = hooks
    }

    /** Loads every profile, builds the simulation and starts ticking. */
    static async create(members: DfMatchMember[], hooks: DfMatchHooks): Promise<DfMatch> {
        const setups = await Promise.all(members.map(async (m) => {
            try {
                return dfPlayerSetup(m, await hooks.loadProfile(m.userId))
            } catch (e) {
                console.error('[dead-front] profile load failed', m.userId, e)
                return { userId: m.userId, name: m.name, startWeapon: 'm1911' as DfWeaponId, attachments: {}, perkMods: {} }
            }
        }))
        const sim = new DfMatchSim(setups)
        const players = members.map((m, i): MatchPlayer => ({ userId: m.userId, name: m.name, pid: i, applied: false, progress: null, gone: false, graceTimer: null }))
        const match = new DfMatch(`m${Date.now().toString(36)}${(++matchSeq).toString(36)}`, sim, players, hooks)
        match.timer = setInterval(() => match.tickOnce(), 1000 / DF_TICK_HZ)
        return match
    }

    get round(): number {
        return this.sim.round
    }

    get isFinished(): boolean {
        return this.finished
    }

    has(userId: string): boolean {
        return this.players.some(p => p.userId === userId && !p.gone)
    }

    private find(userId: string): MatchPlayer | undefined {
        return this.players.find(p => p.userId === userId && !p.gone)
    }

    private send(userId: string, msg: DfServerMsg): void {
        this.hooks.send(userId, JSON.stringify(msg))
    }

    /** Tells a player the match is on (also used on reconnect so the client remounts the game). */
    sendStart(userId: string): void {
        const p = this.find(userId)
        if (!p) return
        const start: DfMatchStart = { matchId: this.id, you: p.pid, mapId: DF_MAP.id }
        this.send(userId, { t: 'start', start })
    }

    handle(userId: string, msg: DfClientMsg): void {
        const p = this.find(userId)
        if (!p || this.finished) return
        const sim = this.sim
        try {
            switch (msg.t) {
                case 'in': sim.input(p.pid, msg)
                    break
                case 'fire': sim.fire(p.pid, msg)
                    break
                case 'reload': sim.reload(p.pid, typeof msg.mag === 'number' ? msg.mag : undefined)
                    break
                case 'pause': sim.pause(p.pid, msg.paused === true)
                    break
                case 'swap': sim.swap(p.pid, msg.slot)
                    break
                case 'melee': sim.melee(p.pid, msg)
                    break
                case 'grenade': sim.grenade(p.pid, msg)
                    break
                case 'use': sim.use(p.pid, msg.id)
                    break
                case 'revive': sim.revive(p.pid, typeof msg.pid === 'number' ? msg.pid : null)
                    break
                case 'chat': sim.chat(p.pid, msg.text)
                    break
                case 'dev':
                    // test hooks for local development only; production builds drop this branch
                    if (import.meta.dev) sim.dev(p.pid, msg.op)
                    break
            }
        } catch (e) {
            console.error('[dead-front] message failed', msg.t, e)
        }
    }

    /** The socket dropped: keep the player for the grace period. */
    disconnect(userId: string): void {
        const p = this.find(userId)
        if (!p || this.finished) return
        this.sim.setConnected(p.pid, false)
        if (p.graceTimer) clearTimeout(p.graceTimer)
        p.graceTimer = setTimeout(() => {
            p.graceTimer = null
            void this.leave(userId, false)
        }, DF_RECONNECT_GRACE * 1000)
    }

    /** Back within the grace period: resume. */
    reconnect(userId: string): boolean {
        const p = this.find(userId)
        if (!p || this.finished) return false
        if (p.graceTimer) clearTimeout(p.graceTimer)
        p.graceTimer = null
        this.sim.setConnected(p.pid, true)
        this.sendStart(userId)
        return true
    }

    /** The player leaves for good: their result is written and they get their end screen. */
    async leave(userId: string, notify = true): Promise<void> {
        const p = this.find(userId)
        if (!p || this.finished) return
        if (p.graceTimer) clearTimeout(p.graceTimer)
        p.graceTimer = null
        p.gone = true
        const round = this.sim.finalRound
        const report = await this.applyOnce(p)
        const board = this.sim.endPlayers()
        this.sim.removePlayer(p.pid)
        if (notify) {
            const end: DfMatchEnd = { round, players: board, progress: report }
            this.send(userId, { t: 'end', end })
        }
        this.hooks.onPlayerGone(userId)
        if (!this.players.some(q => !q.gone)) await this.finish()
    }

    /** Writes a player's result exactly once; the flag is set before the await so parallel callers can't double up. */
    private async applyOnce(p: MatchPlayer): Promise<DfProgressReport | null> {
        if (p.applied) return p.progress
        p.applied = true
        const result = this.sim.result(p.pid)
        if (!result) return null
        try {
            p.progress = await this.hooks.applyResult(p.userId, result)
        } catch (e) {
            console.error('[dead-front] applying match result failed', p.userId, e)
            p.progress = null
        }
        return p.progress
    }

    private tickOnce(): void {
        if (this.finished) return
        const sim = this.sim
        // Nobody connected, the solo player paused, or their line stalled: hold the world still.
        if (sim.connectedCount === 0 || sim.paused || sim.soloStalled) {
            this.lastTickAt = 0
            return
        }
        // Fixed steps driven by the wall clock: on a busy host setInterval fires late, and
        // stepping once per callback would let the sim (and the snapshot clock clients
        // interpolate on) fall behind real time, which reads as stuttering zombies.
        const dt = 1 / DF_TICK_HZ
        const now = Date.now()
        this.tickDebt += this.lastTickAt ? Math.min(0.25, (now - this.lastTickAt) / 1000) : dt
        this.lastTickAt = now
        let steps = 0
        // Half a tick of tolerance keeps a callback that fires a hair early from skipping a step.
        while (this.tickDebt >= dt * 0.5 && steps < 4) {
            try {
                sim.step(dt)
            } catch (e) {
                console.error('[dead-front] tick failed', e)
            }
            this.tickDebt -= dt
            steps++
        }
        if (steps === 0) return
        try {
            this.broadcastSnapshot()
        } catch (e) {
            console.error('[dead-front] snapshot failed', e)
        }
        if (sim.round !== this.lastRound) {
            this.lastRound = sim.round
            this.hooks.onRound?.(sim.round)
        }
        if (sim.over) void this.finish()
    }

    private broadcastSnapshot(): void {
        const shared = JSON.stringify(this.sim.snapshot())
        // Every player gets the same body; only `ack` differs, appended without re-serialising.
        const head = `{"t":"snap","s":${shared.slice(0, -1)},"ack":`
        for (const p of this.players) {
            if (p.gone) continue
            this.hooks.send(p.userId, `${head}${this.sim.ack(p.pid)}}}`)
        }
    }

    /** Game over (or everyone left): write every remaining result, send the end screens, stop. */
    async finish(): Promise<void> {
        if (this.finished) return
        this.finished = true
        if (this.timer) clearInterval(this.timer)
        this.timer = null
        for (const p of this.players) {
            if (p.graceTimer) clearTimeout(p.graceTimer)
            p.graceTimer = null
        }
        const remaining = this.players.filter(p => !p.gone)
        const round = this.sim.finalRound
        const board = this.sim.endPlayers()
        await Promise.all(remaining.map(p => this.applyOnce(p)))
        for (const p of remaining) {
            const end: DfMatchEnd = { round, players: board, progress: p.progress }
            this.send(p.userId, { t: 'end', end })
        }
        try {
            this.hooks.onFinished(this)
        } catch (e) {
            console.error('[dead-front] finish hook failed', e)
        }
    }

    /** Users still in the match (connected or within grace). */
    members(): string[] {
        return this.players.filter(p => !p.gone).map(p => p.userId)
    }
}
