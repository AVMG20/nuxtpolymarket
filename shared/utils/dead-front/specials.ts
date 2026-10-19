import type { DfAabb } from './map'
import type { DfEnemyType, DfHitZone, Vec3 } from './types'

// Rules for the special rounds and set pieces, shared by the server (which
// runs them) and the client (prompts, HUD callouts): gas rounds, the electric
// traps, crawlers and kill streaks. Pure and unit tested; the server's state
// machine lives in server/utils/dead-front/specials.ts.

// ---------------------------------------------------------------- gas rounds

/**
 * Mustard gas rolls in every few rounds: a smaller, faster pack of
 * gas-masked ghouls rising out of the fog. The last kill always drops a Max
 * Ammo. The gas itself only makes you cough; it never hurts.
 */
export const DF_GAS = {
    /** The first gas round falls on one of these rounds. */
    first: [5, 6],
    /** Then one every this many rounds. */
    every: [4, 6],
    /** The pack, as a share of the round's normal count. */
    countMult: 0.6,
    minCount: 6,
    /** Spawn interval multiplier (they pour in faster). */
    spawnMult: 0.65,
    /** Masked ghouls run this much faster than plain ones. */
    speedMult: 1.12,
    /** Gas pockets per round and their radius (metres). */
    pockets: 4,
    pocketRadius: 4.5
} as const

/** The first gas round; `roll` is uniform in [0, 1). */
export function dfGasFirstRound(roll: number): number {
    const [a, b] = DF_GAS.first
    return a + Math.min(b - a, Math.floor(roll * (b - a + 1)))
}

/** The gas round after one on `round`; `roll` is uniform in [0, 1). */
export function dfGasNextRound(round: number, roll: number): number {
    const [a, b] = DF_GAS.every
    return round + a + Math.min(b - a, Math.floor(roll * (b - a + 1)))
}

/**
 * Advances the schedule when a round starts: is `round` a gas round, and when
 * is the next one. A schedule a jump skipped past (dev hooks) catches up.
 */
export function dfGasSchedule(round: number, next: number, roll: () => number): { gas: boolean, next: number } {
    let n = next
    while (n < round) n = dfGasNextRound(n, roll())
    if (n !== round) return { gas: false, next: n }
    return { gas: true, next: dfGasNextRound(round, roll()) }
}

/** Zombies in a gas round. */
export function dfGasRoundCount(normal: number): number {
    return Math.max(DF_GAS.minCount, Math.round(normal * DF_GAS.countMult))
}

export interface DfGasPocketDef {
    x: number
    y: number
    z: number
    r: number
}

/** 0..1 how deep a point stands in the gas pockets (1 at a pocket's heart, 0 outside every pocket). */
export function dfGasDepth(pockets: readonly DfGasPocketDef[], p: Vec3): number {
    let best = 0
    for (const g of pockets) {
        if (Math.abs(p.y - g.y) > 2.5) continue
        const d = Math.hypot(p.x - g.x, p.z - g.z)
        if (d >= g.r) continue
        best = Math.max(best, 1 - d / g.r)
    }
    return best
}

// ---------------------------------------------------------------- electric traps

/** A buyable electric trap across a passage: a lever on the wall, coils either side. */
export interface DfTrap {
    id: string
    /** "Churchyard Passage" */
    label: string
    /** Zone of the lever. */
    zone: string
    /** The door the passage goes through: the trap is only worth buying once it is open. */
    door?: string
    /** The lever on the wall: `pos` on the wall surface at floor height, `yaw` faces the player. */
    lever: { pos: Vec3, yaw: number }
    /** Everything inside this box is fried while the trap runs. */
    area: DfAabb
    /** Arc emitters, in pairs: arcs leap between the two ends of each pair. */
    coils: [Vec3, Vec3][]
}

export const DF_TRAP = {
    cost: 1000,
    /** Seconds the trap runs once bought. */
    active: 25,
    /** Seconds before it can be bought again. */
    cooldown: 60,
    /** Points the buyer earns per zombie fried. */
    killPoints: 50,
    /** A player standing in it takes this much per pulse... */
    playerDamage: 8,
    pulse: 0.5,
    /** ...but never drops below this: a trap stings, it never downs you. */
    playerFloor: 20
} as const

export type DfTrapPhase = 'idle' | 'active' | 'cooldown'

export interface DfTrapRun {
    state: DfTrapPhase
    /** Seconds left in `active` / `cooldown`. */
    timer: number
    /** pid that paid for the current run (-1 when idle). */
    owner: number
}

/** Can the trap be bought now? Returns why not, or null. */
export function dfTrapBlocked(run: DfTrapRun, power: boolean, points: number): 'power' | 'active' | 'cooldown' | 'points' | null {
    if (run.state === 'active') return 'active'
    if (run.state === 'cooldown') return 'cooldown'
    if (!power) return 'power'
    if (points < DF_TRAP.cost) return 'points'
    return null
}

/** Starts a paid run. */
export function dfTrapStart(run: DfTrapRun, pid: number): void {
    run.state = 'active'
    run.timer = DF_TRAP.active
    run.owner = pid
}

/** Runs the trap clock; returns the phase it entered this step, if any. */
export function dfTrapTick(run: DfTrapRun, dt: number): DfTrapPhase | null {
    if (run.state === 'idle') return null
    run.timer -= dt
    if (run.timer > 0) return null
    if (run.state === 'active') {
        run.state = 'cooldown'
        run.timer = DF_TRAP.cooldown + run.timer
        run.owner = -1
        return 'cooldown'
    }
    run.state = 'idle'
    run.timer = 0
    return 'idle'
}

/** Is a body at `p` (feet) inside the trap's area? */
export function dfInTrap(area: DfAabb, p: Vec3): boolean {
    return p.x >= area.min.x && p.x <= area.max.x && p.z >= area.min.z && p.z <= area.max.z && p.y >= area.min.y - 0.4 && p.y <= area.max.y
}

/** How much a pulse of the trap takes off a player with `health` (never below the floor). */
export function dfTrapPlayerDamage(health: number): number {
    return Math.max(0, Math.min(DF_TRAP.playerDamage, health - DF_TRAP.playerFloor))
}

// ---------------------------------------------------------------- crawlers

/**
 * Legs blown off: a crawler drags itself along by the arms, low to the ground,
 * and still bites. Explosions and heavy leg hits can do it. Slow enough to keep
 * one alive at the end of a round while you shop.
 */
export const DF_CRAWL = {
    /** Crawling speed (m/s); ghouls drag themselves a bit faster. */
    speed: 0.8,
    ghoulSpeed: 1.15,
    /** A leg hit taking at least this share of the zombie's health may take the legs. */
    limbShare: 0.3,
    limbChance: 0.45,
    /** A blast taking at least this share may. */
    blastShare: 0.2,
    blastChance: 0.35
} as const

/** Chance a non-lethal hit turns this zombie into a crawler. */
export function dfCrawlChance(type: DfEnemyType, zone: DfHitZone, dmg: number, maxHp: number, explosive: boolean): number {
    if (type !== 'shambler' && type !== 'ghoul') return 0
    if (!(maxHp > 0) || !(dmg > 0)) return 0
    const share = dmg / maxHp
    if (explosive) return share >= DF_CRAWL.blastShare ? DF_CRAWL.blastChance : 0
    if (zone === 'limb' && share >= DF_CRAWL.limbShare) return DF_CRAWL.limbChance
    return 0
}

/** Crawling speed for a type. */
export function dfCrawlSpeed(type: DfEnemyType): number {
    return type === 'ghoul' ? DF_CRAWL.ghoulSpeed : DF_CRAWL.speed
}

// ---------------------------------------------------------------- kill streaks

export type DfStreakKind = 'double' | 'triple' | 'multi' | 'massacre' | 'head'

export const DF_STREAK = {
    /** Kills closer together than this (seconds) chain into a multi-kill. */
    window: 1,
    /** Every this many headshot kills in a row is a headshot streak. */
    heads: 5,
    headBonus: 50,
    tiers: [
        { n: 2, kind: 'double', title: 'Double kill', bonus: 50 },
        { n: 3, kind: 'triple', title: 'Triple kill', bonus: 50 },
        { n: 5, kind: 'multi', title: 'Multi kill', bonus: 75 },
        { n: 8, kind: 'massacre', title: 'Massacre', bonus: 100 }
    ]
} as const satisfies { window: number, heads: number, headBonus: number, tiers: readonly { n: number, kind: DfStreakKind, title: string, bonus: number }[] }

export const DF_STREAK_TITLES: Record<DfStreakKind, string> = {
    double: 'Double kill',
    triple: 'Triple kill',
    multi: 'Multi kill',
    massacre: 'Massacre',
    head: 'Headhunter'
}

export interface DfStreakState {
    /** Kills in the current multi-kill chain. */
    chain: number
    lastKillAt: number
    /** Headshot kills in a row. */
    heads: number
}

export function dfNewStreak(): DfStreakState {
    return { chain: 0, lastKillAt: -100, heads: 0 }
}

export interface DfStreakHit {
    kind: DfStreakKind
    /** Kills in the chain (multi) or headshots in a row (head). */
    n: number
    bonus: number
}

/**
 * Records one kill at `time`. Returns the callouts it earned: a multi-kill
 * tier the chain just reached and / or a headshot streak milestone.
 */
export function dfStreakKill(st: DfStreakState, time: number, head: boolean): DfStreakHit[] {
    const out: DfStreakHit[] = []
    st.chain = time - st.lastKillAt <= DF_STREAK.window ? st.chain + 1 : 1
    st.lastKillAt = time
    const tier = DF_STREAK.tiers.find(t => t.n === st.chain)
    if (tier) out.push({ kind: tier.kind, n: st.chain, bonus: tier.bonus })
    st.heads = head ? st.heads + 1 : 0
    if (head && st.heads % DF_STREAK.heads === 0) out.push({ kind: 'head', n: st.heads, bonus: DF_STREAK.headBonus })
    return out
}
