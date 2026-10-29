import { DF_RECONNECT_GRACE, DF_TICK_HZ } from '#shared/utils/dead-front/constants'
import { DF_MAP } from '#shared/utils/dead-front/map'
import { dfPackZombie } from '#shared/utils/dead-front/protocol'
import type { DfClientMsg, DfMatchEnd, DfMatchStart, DfServerMsg } from '#shared/utils/dead-front/protocol'
import type { DfProfileView, DfProgressReport } from '#shared/utils/dead-front/types'
import { DF_WEAPON_IDS, dfSanitizeAttachments, dfWeaponLevel } from '#shared/utils/dead-front/weapons'
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
/** Seconds of simulation a late tick loop catches up on (a weak host's stalls); beyond this the world just pauses. */
const MAX_CATCH_UP = 0.6
/** Steps per callback while catching up: one snapshot carries them all, so clients see a single longer tick. */
const MAX_STEPS_PER_TICK = 4
const TICK_MS = 1000 / DF_TICK_HZ
/** A timer may fire this many ms before its deadline (timer clocks are coarser than Date.now). */
const EARLY_MS = 2

/**
 * Resolves a profile into the simulation's player setup (sanitised attachments,
 * research mods). There is no start weapon to pick: everyone starts with the
 * M1911, whatever an old stored loadout says.
 */
export function dfPlayerSetup(member: DfMatchMember, profile: DfProfileView): DfPlayerSetup {
    const attachments: DfPlayerSetup['attachments'] = {}
    for (const id of DF_WEAPON_IDS) {
        const choice = profile.loadout?.attachments?.[id]
        if (!choice) continue
        attachments[id] = dfSanitizeAttachments(id, dfWeaponLevel(profile.weaponXp?.[id] ?? 0), choice)
    }
    return { userId: member.userId, name: member.name, attachments, perkMods: profile.perkMods ?? {} }
}

export class DfMatch {
    readonly id: string
    readonly sim: DfMatchSim
    private readonly players: MatchPlayer[]
    private readonly hooks: DfMatchHooks
    private timer: ReturnType<typeof setTimeout> | null = null
    /** Wall time (ms) the next step is due; 0 while the world is held (the next step runs at once). */
    private nextDue = 0
    /** Wall time (ms) of stream-clock zero, set by the first step. */
    private streamAt = 0
    /** Stream clock (seconds) of the last step: sim time plus the wall time the world was held or dropped. */
    private clk = 0
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
                return { userId: m.userId, name: m.name, attachments: {}, perkMods: {} }
            }
        }))
        const sim = new DfMatchSim(setups)
        const players = members.map((m, i): MatchPlayer => ({ userId: m.userId, name: m.name, pid: i, applied: false, progress: null, gone: false, graceTimer: null }))
        const match = new DfMatch(`m${Date.now().toString(36)}${(++matchSeq).toString(36)}`, sim, players, hooks)
        match.schedule(TICK_MS)
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
                case 'reload': sim.reload(p.pid, typeof msg.mag === 'number' ? msg.mag : undefined, typeof msg.weapon === 'string' ? msg.weapon : undefined)
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
                case 'arsenal': {
                    const sp = sim.player(p.pid)
                    if (sp) sim.arsenal.handle(sp, msg.op)
                    break
                }
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

    private schedule(ms: number): void {
        if (this.finished) return
        this.timer = setTimeout(() => {
            this.timer = null
            this.schedule(this.tickOnce())
        }, Math.max(0, Math.min(TICK_MS, ms)))
    }

    /**
     * Runs the steps that are due and returns the ms until the next one. The
     * loop wakes for each step's deadline instead of on a fixed interval:
     * setInterval drifts a little late every callback, so steps bunched into a
     * double step every few seconds and the snapshots wobbled half a tick
     * around wall time, which clients measure as jitter and widen their
     * render delay for.
     */
    private tickOnce(): number {
        if (this.finished) return TICK_MS
        const sim = this.sim
        // Nobody connected, the solo player paused, or their line stalled: hold the world still.
        if (sim.connectedCount === 0 || sim.paused || sim.soloStalled) {
            this.nextDue = 0
            return TICK_MS
        }
        // Fixed steps on wall-clock deadlines: a late callback runs every step that is due,
        // so the sim (and the snapshot clock clients interpolate on) never falls behind real
        // time. A host stall of up to MAX_CATCH_UP is made up for (a few steps per callback, so
        // it never spirals); time beyond it is dropped, like time the world is held.
        const dt = 1 / DF_TICK_HZ
        const now = Date.now()
        if (!this.nextDue) this.nextDue = now
        if (now - this.nextDue > MAX_CATCH_UP * 1000) this.nextDue = now - MAX_CATCH_UP * 1000
        if (this.nextDue - now > TICK_MS * 2) {
            // the system clock was set back: carry on from now, the stream clock with it
            this.streamAt -= this.nextDue - now
            this.nextDue = now
        }
        if (!this.streamAt) this.streamAt = this.nextDue - sim.time * 1000
        let steps = 0
        while (now >= this.nextDue - EARLY_MS && steps < MAX_STEPS_PER_TICK) {
            try {
                sim.step(dt)
            } catch (e) {
                console.error('[dead-front] tick failed', e)
            }
            // the stream clock runs on the step's deadline: held or dropped time moves it on,
            // so clients map it onto the sim clock instead of re-syncing to a shifted one
            this.clk = (this.nextDue - this.streamAt) / 1000 + dt
            this.nextDue += TICK_MS
            steps++
        }
        if (steps === 0) return this.nextDue - now
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
        // still behind after a full batch: catch up over the next callbacks, a tick apart
        return steps === MAX_STEPS_PER_TICK ? TICK_MS : this.nextDue - now
    }

    private broadcastSnapshot(): void {
        const snap = this.sim.snapshot()
        // zombies go packed (`DfWireZombie`): they are most of the frame; DfNet unpacks them
        const wire = { ...snap, zombies: snap.zombies.map(dfPackZombie) }
        const shared = JSON.stringify(wire)
        // Every player gets the same body; only `ack` differs, appended without re-serialising.
        const head = `{"t":"snap","s":${shared.slice(0, -1)},"clk":${Math.round(this.clk * 1000) / 1000},"ack":`
        for (const p of this.players) {
            if (p.gone) continue
            // the player's own salvage rides along after `ack`: nobody else sees it
            this.hooks.send(p.userId, `${head}${this.sim.ack(p.pid)},"mine":${JSON.stringify(this.sim.arsenal.mine(p.pid))}}}`)
        }
    }

    /** Game over (or everyone left): write every remaining result, send the end screens, stop. */
    async finish(): Promise<void> {
        if (this.finished) return
        this.finished = true
        if (this.timer) clearTimeout(this.timer)
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
