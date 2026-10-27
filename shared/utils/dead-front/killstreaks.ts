import { dfZombieBaseHealth } from './enemies'
import type { DfStrikeHit } from './salvage'
import type { Vec3 } from './types'

// Killstreak rewards (CoD style): kills without going down earn air and
// artillery support, held until called in (X) on the spot you look at. The
// strike plans are pure (positions and times of every impact), so the server
// resolves the damage and the client stages the show from the same plan.
// Friendly-safe: support never hurts a player.

export type DfRewardId = 'barrage' | 'zeppelin' | 'strafe'

export interface DfRewardDef {
    id: DfRewardId
    /** Kills without going down that earn it. */
    kills: number
    name: string
    /** One line for the HUD callout. */
    desc: string
    /** Seconds from the call-in to the first impact. */
    delay: number
    /** Damage per impact, as a share of the round's zombie health. */
    damageShare: number
}

export const DF_REWARDS: Record<DfRewardId, DfRewardDef> = {
    barrage: { id: 'barrage', kills: 15, name: 'Artillery Barrage', desc: 'Eight shells on the spot you mark', delay: 2.4, damageShare: 2.6 },
    zeppelin: { id: 'zeppelin', kills: 30, name: 'Zeppelin Raid', desc: 'A bomb run along your line of sight', delay: 4.2, damageShare: 3.2 },
    strafe: { id: 'strafe', kills: 50, name: 'Sopwith Strafing Run', desc: 'Machine guns rake the ground in front of you', delay: 2.8, damageShare: 0.9 }
}

/** In the order they are earned. */
export const DF_REWARD_ORDER: readonly DfRewardId[] = ['barrage', 'zeppelin', 'strafe']

export const DF_KILLSTREAK = {
    /** The count starts over after the last reward. */
    cycle: 50,
    /** Rewards held at once (more are lost). */
    maxHeld: 3,
    /** Call-ins reach this far (metres, horizontally). */
    range: 90
} as const

export interface DfKillstreakState {
    kills: number
    rewards: DfRewardId[]
}

export function dfNewKillstreak(): DfKillstreakState {
    return { kills: 0, rewards: [] }
}

/**
 * One kill toward the streak. Returns the reward it earned (also pushed onto
 * `rewards` when there is room), or null. The count starts over after the
 * last tier.
 */
export function dfKillstreakKill(st: DfKillstreakState): DfRewardId | null {
    st.kills++
    const def = DF_REWARD_ORDER.map(id => DF_REWARDS[id]).find(r => r.kills === st.kills)
    if (st.kills >= DF_KILLSTREAK.cycle) st.kills = 0
    if (!def) return null
    if (st.rewards.length < DF_KILLSTREAK.maxHeld) st.rewards.push(def.id)
    return def.id
}

/** Going down ends the streak (rewards already earned are kept). */
export function dfKillstreakDown(st: DfKillstreakState): void {
    st.kills = 0
}

/** The next reward up and the kills it needs (for the HUD meter). */
export function dfNextReward(kills: number): { id: DfRewardId, at: number, from: number } {
    let from = 0
    for (const id of DF_REWARD_ORDER) {
        const at = DF_REWARDS[id].kills
        if (kills < at) return { id, at, from }
        from = at
    }
    return { id: DF_REWARD_ORDER[0]!, at: DF_REWARDS[DF_REWARD_ORDER[0]!].kills, from: 0 }
}

/** Damage of one impact on a round. */
export function dfStrikeDamage(id: DfRewardId, round: number): number {
    return dfZombieBaseHealth(Math.max(1, round)) * DF_REWARDS[id].damageShare
}

export const DF_STRIKE = {
    barrage: { shells: 8, spread: 5.5, interval: 0.34, jitter: 0.12, radius: 4.6 },
    zeppelin: { bombs: 11, length: 36, speed: 13, radius: 4.8, altitude: 26 },
    strafe: { length: 44, step: 1.1, speed: 40, radius: 2.1, altitude: 16 }
} as const

export interface DfStrikePlan {
    id: DfRewardId
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
export function dfPlanStrike(id: DfRewardId, at: Vec3, dir: Vec3, roll: () => number): DfStrikePlan {
    const d = dfFlatDir(dir)
    const delay = DF_REWARDS[id].delay
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
    const c = id === 'zeppelin' ? DF_STRIKE.zeppelin : DF_STRIKE.strafe
    const half = c.length / 2
    const n = id === 'zeppelin' ? DF_STRIKE.zeppelin.bombs : Math.floor(c.length / DF_STRIKE.strafe.step) + 1
    const hits: DfStrikeHit[] = []
    for (let i = 0; i < n; i++) {
        const s = -half + (c.length * i) / Math.max(1, n - 1)
        // bombs and bursts scatter a little either side of the line
        const side = (roll() - 0.5) * (id === 'zeppelin' ? 2.4 : 1.2)
        hits.push({
            x: r2(at.x + d.x * s - d.z * side),
            y: at.y,
            z: r2(at.z + d.z * s + d.x * side),
            t: r2(delay + (s + half) / c.speed),
            r: c.radius
        })
    }
    // the flight line runs well past the strike zone at both ends
    const lead = id === 'zeppelin' ? 40 : 70
    const alt = c.altitude
    const from = { x: at.x - d.x * (half + lead), y: at.y + alt, z: at.z - d.z * (half + lead) }
    const to = { x: at.x + d.x * (half + lead), y: at.y + alt, z: at.z + d.z * (half + lead) }
    return { id, hits, from, to, duration: delay + (c.length + lead) / c.speed + 2 }
}

/** Seconds into the plan at which the flyer passes over the start of the strike zone (its flight starts `lead` metres back). */
export function dfStrikeFlightStart(plan: DfStrikePlan): number {
    if (plan.id === 'barrage') return 0
    const c = plan.id === 'zeppelin' ? DF_STRIKE.zeppelin : DF_STRIKE.strafe
    const lead = plan.id === 'zeppelin' ? 40 : 70
    return DF_REWARDS[plan.id].delay - lead / c.speed
}
