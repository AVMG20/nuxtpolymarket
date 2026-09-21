// Void Runner — what a run reports about itself for balance audits. None of
// it pays anything: the server only bounds it and files it next to the run.

/** Bump when a balance change lands, so audits can split runs before and after it. */
export const VOID_BALANCE_VERSION = '2026-09-21'

export const VOID_BOSS_IDS = ['warden', 'dreadnought', 'tyrant', 'harbinger'] as const
export type VoidBossId = typeof VOID_BOSS_IDS[number]

export interface VoidBossRecord {
    id: VoidBossId
    /** Jump depth the fight happened at. */
    depth: number
    /** Seconds into the run of the pilot's first and last hit on it. */
    firstHit: number
    lastHit: number
    /** Seconds into the run it died, or null if it outlived the fight. */
    killedAt: number | null
    /** How the fight ended: killed, the pilot died, jumped or flew off, or the run ended. */
    outcome: 'killed' | 'died' | 'left' | 'ended'
    /** Hull fraction it had left. */
    hpLeft: number
    /** Damage the pilot took from it and everything it launched. */
    taken: number
}

export interface VoidRunTelemetry {
    /** Kills by hostile kind. */
    kills: Record<string, number>
    elites: number
    /** Damage taken by source, after mitigation: `raider`, `tyrant`, `mauler:storm`, `hazard`. */
    damage: Record<string, number>
    bosses: VoidBossRecord[]
    /** Zones flown, in order, with the second each was entered. */
    zones: { zone: string, at: number }[]
    death: null | { by: string, boss: VoidBossId | null, depth: number, zone: string, at: number }
    peakWanted: number
    /** Lowest hull fraction the run saw. */
    lowestHull: number
    /** Times the shield was stripped to nothing. */
    shieldBreaks: number
    rocksMined: number
}

const LABEL = /^[a-z][a-z0-9:_-]{0,31}$/

function num(raw: unknown, min: number, max: number, digits = 0) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return min
    const f = 10 ** digits
    return Math.round(Math.max(min, Math.min(max, n)) * f) / f
}

function tally(raw: unknown, limit: number, max: number) {
    const out: Record<string, number> = {}
    if (!raw || typeof raw !== 'object') return out
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (Object.keys(out).length >= limit) break
        if (LABEL.test(key)) out[key] = num(value, 0, max)
    }
    return out
}

function label(raw: unknown, fallback: string) {
    return typeof raw === 'string' && LABEL.test(raw) ? raw : fallback
}

/** Bounds a client telemetry blob: known shapes, short labels, clamped numbers, capped lists. */
export function voidCleanTelemetry(raw: unknown): VoidRunTelemetry | null {
    if (!raw || typeof raw !== 'object') return null
    const t = raw as Record<string, unknown>
    const bosses = (Array.isArray(t.bosses) ? t.bosses : []).slice(0, 16).flatMap((b): VoidBossRecord[] => {
        const r = (b ?? {}) as Record<string, unknown>
        const id = VOID_BOSS_IDS.find(x => x === r.id)
        const outcome = (['killed', 'died', 'left', 'ended'] as const).find(x => x === r.outcome)
        if (!id || !outcome) return []
        return [{
            id, outcome, depth: num(r.depth, 1, 8), firstHit: num(r.firstHit, 0, 3600), lastHit: num(r.lastHit, 0, 3600),
            killedAt: r.killedAt === null || r.killedAt === undefined ? null : num(r.killedAt, 0, 3600), hpLeft: num(r.hpLeft, 0, 1, 3), taken: num(r.taken, 0, 1e7)
        }]
    })
    const zones = (Array.isArray(t.zones) ? t.zones : []).slice(0, 9).map((z) => {
        const r = (z ?? {}) as Record<string, unknown>
        return { zone: label(r.zone, 'unknown'), at: num(r.at, 0, 3600) }
    })
    const d = t.death && typeof t.death === 'object' ? t.death as Record<string, unknown> : null
    return {
        kills: tally(t.kills, 32, 100_000),
        elites: num(t.elites, 0, 100_000),
        damage: tally(t.damage, 48, 1e8),
        bosses,
        zones,
        death: d ? { by: label(d.by, 'unknown'), boss: VOID_BOSS_IDS.find(x => x === d.boss) ?? null, depth: num(d.depth, 1, 8), zone: label(d.zone, 'unknown'), at: num(d.at, 0, 3600) } : null,
        peakWanted: num(t.peakWanted, 0, 5),
        lowestHull: num(t.lowestHull, 0, 1, 3),
        shieldBreaks: num(t.shieldBreaks, 0, 10_000),
        rocksMined: num(t.rocksMined, 0, 100_000)
    }
}
