import { dfZombieBaseHealth } from './enemies'
import type { DfStrikeHit } from './salvage'
import type { Vec3 } from './types'

// Support: artillery, a Zeppelin, a bomber and a lent grenade launcher,
// bought at a workbench with salvage (salvage.ts), held (up to three) until
// it is called in (X) on the spot you look at (the launcher simply comes
// out). The strike plans are pure (positions and times of every impact), so
// the server resolves the damage and the client stages the show from the
// same plan. Friendly-safe: support never hurts a player.

export type DfSupportId = 'barrage' | 'zeppelin' | 'launcher' | 'bomber'

/** The support that is called in on a spot (all but the launcher). */
export type DfStrikeId = Exclude<DfSupportId, 'launcher'>

export interface DfSupportDef {
    id: DfSupportId
    name: string
    /** One line for the HUD callout. */
    desc: string
    /** Seconds from the call-in to the first impact. */
    delay: number
    /** Damage per impact, as a share of the round's zombie health. */
    damageShare: number
}

export const DF_SUPPORT: Record<DfSupportId, DfSupportDef> = {
    barrage: { id: 'barrage', name: 'Artillery Barrage', desc: 'Eight shells on the spot you mark', delay: 2.4, damageShare: 2.6 },
    zeppelin: { id: 'zeppelin', name: 'Zeppelin Raid', desc: 'A bomb run along your line of sight', delay: 4.2, damageShare: 3.2 },
    launcher: { id: 'launcher', name: 'Granatwerfer', desc: 'A grenade launcher in your hands for a while', delay: 0, damageShare: 0 },
    bomber: { id: 'bomber', name: 'Bomber Run', desc: 'A Gotha carpets the spot you mark: nothing in it survives', delay: 4.6, damageShare: 4 }
}

/** Is this support called in on a spot (rather than handed over)? */
export function dfIsStrike(id: DfSupportId): id is DfStrikeId {
    return id !== 'launcher'
}

/** The lent grenade launcher: how long it stays in your hands. */
export const DF_LAUNCHER = {
    weapon: 'granatwerfer',
    seconds: 45
} as const

export const DF_SUPPORT_HELD = {
    /** Support held at once (the bench won't sell more). */
    max: 3,
    /** Call-ins reach this far (metres, horizontally). */
    range: 90
} as const

/** Damage of one impact on a round. */
export function dfStrikeDamage(id: DfSupportId, round: number): number {
    return dfZombieBaseHealth(Math.max(1, round)) * DF_SUPPORT[id].damageShare
}

export const DF_STRIKE = {
    barrage: { shells: 8, spread: 5.5, interval: 0.34, jitter: 0.12, radius: 4.6 },
    zeppelin: { bombs: 11, length: 36, speed: 13, radius: 4.8, altitude: 26 },
    /** Rows of bombs across the mark, then everything inside `radius` is gone. */
    bomber: { radius: 11, rows: 3, perRow: 5, speed: 24, bombRadius: 5, altitude: 30 }
} as const

export interface DfStrikePlan {
    id: DfStrikeId
    /** Impacts on the ground: `y` is the aim point's height (the server finds the floor). */
    hits: DfStrikeHit[]
    /** The flight line (zeppelin, plane) through the target, start to end, and its length in seconds. */
    from: Vec3
    to: Vec3
    duration: number
}

/** Unit horizontal direction (falls back to north). */
export function dfFlatDir(dir: Vec3): { x: number, z: number } {
    const l = Math.hypot(dir.x, dir.z)
    if (!(l > 1e-6)) return { x: 0, z: -1 }
    return { x: dir.x / l, z: dir.z / l }
}

/** Where every impact lands and when; `roll` is uniform in [0, 1). */
export function dfPlanStrike(id: DfStrikeId, at: Vec3, dir: Vec3, roll: () => number): DfStrikePlan {
    const d = dfFlatDir(dir)
    const delay = DF_SUPPORT[id].delay
    const r2 = (n: number) => Math.round(n * 100) / 100
    if (id === 'barrage') {
        const c = DF_STRIKE.barrage
        const hits: DfStrikeHit[] = []
        for (let i = 0; i < c.shells; i++) {
            // the first lands on the mark, the rest walk around it
            const a = roll() * Math.PI * 2
            const rr = i === 0 ? 0 : c.spread * Math.sqrt(0.15 + 0.85 * roll())
            hits.push({ x: r2(at.x + Math.cos(a) * rr), y: at.y, z: r2(at.z + Math.sin(a) * rr), t: r2(delay + i * c.interval + (roll() - 0.5) * c.jitter), r: c.radius })
        }
        hits.sort((a, b) => a.t - b.t)
        const from = { x: at.x, y: at.y + 40, z: at.z }
        return { id, hits, from, to: { ...at }, duration: hits[hits.length - 1]!.t + 1 }
    }
    const hits: DfStrikeHit[] = []
    const { half, speed, altitude, lead } = flight(id)
    if (id === 'zeppelin') {
        const c = DF_STRIKE.zeppelin
        for (let i = 0; i < c.bombs; i++) {
            const s = -half + (c.length * i) / Math.max(1, c.bombs - 1)
            // bombs scatter a little either side of the line
            const side = (roll() - 0.5) * 2.4
            hits.push({ x: r2(at.x + d.x * s - d.z * side), y: at.y, z: r2(at.z + d.z * s + d.x * side), t: r2(delay + (s + half) / speed), r: c.radius })
        }
    } else {
        // rows of bombs walking across the mark, then the whole circle goes
        const c = DF_STRIKE.bomber
        for (let i = 0; i < c.perRow; i++) {
            const s = -half + (2 * half * i) / Math.max(1, c.perRow - 1)
            for (let row = 0; row < c.rows; row++) {
                const side = (row - (c.rows - 1) / 2) * (c.radius * 0.62) + (roll() - 0.5) * 1.5
                const along = s + (roll() - 0.5) * 1.5
                if (Math.hypot(along, side) > c.radius + 0.5) continue
                hits.push({ x: r2(at.x + d.x * along - d.z * side), y: at.y, z: r2(at.z + d.z * along + d.x * side), t: r2(delay + (along + half) / speed), r: c.bombRadius })
            }
        }
        hits.sort((a, b) => a.t - b.t)
        hits.push({ x: r2(at.x), y: at.y, z: r2(at.z), t: r2(hits[hits.length - 1]!.t + 0.15), r: c.radius, all: true })
    }
    // the flight line runs well past the strike zone at both ends
    const from = { x: at.x - d.x * (half + lead), y: at.y + altitude, z: at.z - d.z * (half + lead) }
    const to = { x: at.x + d.x * (half + lead), y: at.y + altitude, z: at.z + d.z * (half + lead) }
    return { id, hits, from, to, duration: delay + (2 * half + lead) / speed + 2 }
}

/** A flyer's line: half the strike zone's length, speed, height, and the run-in before it. */
function flight(id: 'zeppelin' | 'bomber'): { half: number, speed: number, altitude: number, lead: number } {
    if (id === 'zeppelin') return { half: DF_STRIKE.zeppelin.length / 2, speed: DF_STRIKE.zeppelin.speed, altitude: DF_STRIKE.zeppelin.altitude, lead: 40 }
    return { half: DF_STRIKE.bomber.radius, speed: DF_STRIKE.bomber.speed, altitude: DF_STRIKE.bomber.altitude, lead: 60 }
}

/** The flyer's speed (m/s) and height. */
export function dfStrikeFlyer(id: 'zeppelin' | 'bomber'): { speed: number, altitude: number } {
    const f = flight(id)
    return { speed: f.speed, altitude: f.altitude }
}

/** Seconds into the plan at which the flyer passes over the start of the strike zone (its flight starts `lead` metres back). */
export function dfStrikeFlightStart(plan: DfStrikePlan): number {
    if (plan.id === 'barrage') return 0
    const f = flight(plan.id)
    return DF_SUPPORT[plan.id].delay - f.lead / f.speed
}
