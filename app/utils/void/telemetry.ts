// Void Runner — a run's own record of what happened to it, for balance audits.
// It pays nothing and steers nothing; the server bounds it and files it.

import type { VoidBossId, VoidBossRecord, VoidRunTelemetry } from '#shared/utils/gamelogic/void-telemetry'
import type { Enemy } from './types'

interface OpenBoss extends VoidBossRecord {
    enemy: Enemy
}

/** Which boss a hostile belongs to: a warden, a capital hull or one of a capital's fittings. */
export function bossOf(e: Enemy): { id: VoidBossId, hull: Enemy } | null {
    if (e.kind === 'warden') return { id: 'warden', hull: e }
    const hull = e.kind === 'mothership' ? e : e.kind === 'battery' || e.kind === 'reactor' ? e.group.userData.parent as Enemy | undefined : undefined
    if (!hull) return null
    return { id: hull.data.capital === 2 ? 'harbinger' : hull.data.capital === 1 ? 'tyrant' : 'dreadnought', hull }
}

/** The name damage from this hostile is filed under. */
export function causeOf(e: Enemy) {
    return bossOf(e)?.id ?? e.kind
}

export class RunTelemetry {
    /** Whose code is running or whose shot is landing; damage with no label of its own is filed here. */
    cause: string | null = null
    private kills: Record<string, number> = {}
    private elites = 0
    private damage: Record<string, number> = {}
    private bosses: OpenBoss[] = []
    private zones: { zone: string, at: number }[] = []
    private death: VoidRunTelemetry['death'] = null
    private lastCause = 'unknown'
    private peakWanted = 0
    private lowestHull = 1
    private shieldBreaks = 0
    private rocksMined = 0

    enterZone(zone: string, at: number) {
        this.zones.push({ zone, at })
    }

    /** The zone is about to be torn down: fights still open were walked away from. */
    leaveZone() {
        for (const b of this.bosses) this.close(b, 'left')
    }

    onKill(e: Enemy, at: number) {
        if (!e.hostile || e.kind === 'mine') return
        this.kills[e.kind] = (this.kills[e.kind] ?? 0) + 1
        if (e.elite) this.elites++
        const boss = bossOf(e)
        if (boss?.hull !== e) return
        const open = this.open(boss.id, e)
        if (!open) return
        open.killedAt = Math.round(at)
        this.close(open, 'killed')
    }

    /** The pilot landed a hit on a boss or one of its fittings. */
    onBossHit(e: Enemy, at: number, depth: number) {
        const boss = bossOf(e)
        if (!boss) return
        const open = this.open(boss.id, boss.hull) ?? this.start(boss.id, boss.hull, at, depth)
        open.lastHit = Math.round(at)
    }

    onDamage(amount: number, cause: string | undefined) {
        const by = cause ?? this.cause ?? 'other'
        this.lastCause = by
        this.damage[by] = (this.damage[by] ?? 0) + amount
        const id = by.split(':')[0]
        for (const b of this.bosses) if (b.id === id && b.enemy.alive) b.taken += amount
    }

    onDeath(at: number, depth: number, zone: string) {
        const id = this.lastCause.split(':')[0]
        const boss = this.bosses.find(b => b.id === id && b.enemy.alive)
        this.death = { by: this.lastCause, boss: boss?.id ?? null, depth, zone, at: Math.round(at) }
        for (const b of this.bosses) this.close(b, b === boss ? 'died' : 'ended')
    }

    sample(hullFrac: number, wanted: number) {
        if (hullFrac < this.lowestHull) this.lowestHull = Math.max(0, hullFrac)
        if (wanted > this.peakWanted) this.peakWanted = wanted
    }

    onShieldBreak() {
        this.shieldBreaks++
    }

    onRockMined() {
        this.rocksMined++
    }

    report(): VoidRunTelemetry {
        for (const b of this.bosses) this.close(b, 'ended')
        const round = (t: Record<string, number>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)]))
        return {
            kills: { ...this.kills },
            elites: this.elites,
            damage: round(this.damage),
            bosses: this.bosses.map(({ enemy: _enemy, ...b }) => ({ ...b, taken: Math.round(b.taken) })),
            zones: this.zones.map(z => ({ zone: z.zone, at: Math.round(z.at) })),
            death: this.death,
            peakWanted: this.peakWanted,
            lowestHull: Math.round(this.lowestHull * 1000) / 1000,
            shieldBreaks: this.shieldBreaks,
            rocksMined: this.rocksMined
        }
    }

    private open(id: VoidBossId, hull: Enemy) {
        return this.bosses.find(b => b.id === id && b.enemy === hull)
    }

    private start(id: VoidBossId, hull: Enemy, at: number, depth: number) {
        const record: OpenBoss = { id, enemy: hull, depth, firstHit: Math.round(at), lastHit: Math.round(at), killedAt: null, outcome: 'ended', hpLeft: 1, taken: 0 }
        this.bosses.push(record)
        return record
    }

    /** Freezes a fight's outcome the first time it ends; later calls leave it alone. */
    private close(b: OpenBoss, outcome: VoidBossRecord['outcome']) {
        if (b.outcome !== 'ended') return
        b.outcome = outcome
        b.hpLeft = Math.round(Math.max(0, Math.min(1, b.enemy.hp / b.enemy.maxHp)) * 1000) / 1000
    }
}
