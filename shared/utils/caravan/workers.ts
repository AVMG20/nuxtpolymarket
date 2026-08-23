import {
    CATEGORIES,
    RARITIES,
    RARITY_BY_ID,
    RESOURCES,
    SPECIALTY_HARVEST_BONUS
} from './config'
import { emptyTotals, sumAffixes } from './items'
import type { Bonuses } from './progression'
import type { Rng } from './rng'
import type { Category, Item, Rarity, ResourceId, Worker } from './types'

/**
 * Worker stats. Base stats are rolled once at hire time and never change; every
 * other source of power is items, levels and research, so a bad hire is never a
 * dead end -- it is just a worker that wants better gear.
 */

const FIRST_NAMES = [
    'Bram', 'Nessa', 'Corin', 'Isolde', 'Radek', 'Mira', 'Tobin', 'Sable',
    'Ovid', 'Wren', 'Halden', 'Juno', 'Kestrel', 'Ardo', 'Lyra', 'Fen',
    'Osric', 'Vetch', 'Marrow', 'Quill', 'Dagon', 'Elspeth', 'Rook', 'Thistle'
]
const LAST_NAMES = [
    'Carter', 'Ashdown', 'Pell', 'Grimwald', 'Vance', 'Orwyn', 'Strand',
    'Hollow', 'Bracken', 'Quarrel', 'Dunmore', 'Kettle', 'Frost', 'Marsh'
]

export function workerName(rng: Rng): string {
    return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`
}

/** Rarity roll for a new hire. Higher tiers pull from a better table. */
export function rollWorkerRarity(rng: Rng, tier: number): Rarity {
    // Every tier shifts the odds up without ever guaranteeing anything.
    const weights = RARITIES.map((r, i) => r.weight * Math.pow(1 + i * 0.35, tier - 1))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = rng.next() * total
    for (let i = 0; i < RARITIES.length; i++) {
        roll -= weights[i]!
        if (roll <= 0) return RARITIES[i]!.id
    }
    return 'common'
}

/**
 * Every tier is worth a flat 25% on base stats, and the roll on top spans only
 * 1.00x to 1.25x. That is a deliberately narrow band: it means a tier is always
 * worth roughly one lucky roll, so a well-rolled worker stays competitive one or
 * two tiers past its own, and a fresh hire is never strictly obsolete on arrival.
 */
export const TIER_STAT_STEP = 1.25
export const MAX_STAT_ROLL = 1.25

export function tierStatMultiplier(tier: number): number {
    return Math.pow(TIER_STAT_STEP, tier - 1)
}

/**
 * How far past its starting stats a worker of this rarity can grow. This is what
 * rarity actually buys: a Common worker with a perfect roll starts ahead of a
 * badly-rolled Epic, but the Epic keeps climbing long after the Common has
 * topped out. Rarity is a ceiling, not a head start.
 */
export function rarityGrowth(rarity: Rarity): number {
    switch (rarity) {
        case 'legendary': return 2.8
        case 'epic': return 2.2
        case 'rare': return 1.8
        case 'uncommon': return 1.5
        default: return 1.3
    }
}

/** How many categories a worker of this rarity is good at. */
export function specialtyCount(rarity: Rarity): number {
    switch (rarity) {
        case 'legendary': return 3
        case 'epic':
        case 'rare': return 2
        default: return 1
    }
}

function rollSpecialties(rng: Rng, rarity: Rarity): Category[] {
    const pool = [...CATEGORIES]
    const out: Category[] = []
    for (let i = 0; i < specialtyCount(rarity) && pool.length; i++) {
        out.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]!)
    }
    return out
}

export function createWorker(rng: Rng, tier: number, now: number): Worker {
    const rarity = rollWorkerRarity(rng, tier)
    const tierMult = tierStatMultiplier(tier)
    // One roll for the whole worker, so stats read as a single quality rather
    // than five independent lotteries that always average out to the middle.
    const quality = 1 + rng.next() * (MAX_STAT_ROLL - 1)
    const scale = tierMult * quality

    return {
        id: `wk_${now.toString(36)}_${rng.int(0, 0xffffff).toString(36)}`,
        name: workerName(rng),
        tier,
        rarity,
        level: 1,
        xp: 0,
        specialties: rollSpecialties(rng, rarity),
        growth: rarityGrowth(rarity),
        base: {
            speed: Number((0.9 * scale).toFixed(3)),
            carry: Math.round(20 * scale),
            strength: Number((0.9 * scale).toFixed(3)),
            // Lower is better, so a good roll cuts the drain instead of raising it.
            hunger: Number((1.1 / quality).toFixed(3))
        },
        equipment: {},
        food: 100,
        assignment: null,
        at: 0,
        route: [],
        routeIndex: 0,
        cargo: {},
        activity: { type: 'idle' }
    }
}

/**
 * A single 0-1 number for how well a worker rolled, independent of its tier.
 * Used to price recruits and to sort a roster by raw quality.
 */
export function workerQuality(worker: Worker): number {
    const expected = 20 * tierStatMultiplier(worker.tier)
    return Math.max(0, Math.min(1, (worker.base.carry / expected - 1) / (MAX_STAT_ROLL - 1)))
}

export const MAX_WORKER_LEVEL = 50

/**
 * XP to go from `level` to `level + 1`.
 *
 * The curve is exponential on purpose: the first handful of levels land inside
 * an evening, and the last few take days. A worker in constant use banks roughly
 * fifty thousand experience a day, and the whole track sums to a bit over a
 * million -- about twenty days of steady work to reach its ceiling.
 */
export function xpForLevel(level: number): number {
    return Math.round(140 * Math.pow(1.16, level - 1))
}

/** Total experience from level 1 to `level`. */
export function xpToReach(level: number): number {
    let total = 0
    for (let i = 1; i < level; i++) total += xpForLevel(i)
    return total
}

/**
 * How far along its growth a worker is, 0 at level 1 and 1 at max. Stats are
 * interpolated across this, so levelling visibly walks a worker toward the
 * ceiling its rarity set.
 */
export function levelProgress(level: number): number {
    return Math.max(0, Math.min(1, (level - 1) / (MAX_WORKER_LEVEL - 1)))
}

/** The multiplier a worker's current level applies to its base stats. */
export function levelMultiplier(worker: Worker): number {
    const growth = worker.growth ?? rarityGrowth(worker.rarity)
    return 1 + (growth - 1) * levelProgress(worker.level)
}

export interface DerivedStats {
    speed: number
    carry: number
    /** Drives both harvest rate and combat. */
    strength: number
    /** Multiplier on food drain. Lower is better. */
    hunger: number
    coinFind: number
    xpGain: number
    /** Extra yield multiplier per category, from `yield_*` affixes. */
    categoryYield: Record<Category, number>
}

/**
 * Fold base stats, level, equipment affixes and research into the numbers the
 * simulation actually reads. Client and server both call this, so a worker card
 * in the UI can never disagree with what the sim does.
 */
export function derivedStats(worker: Worker, items: Item[], bonuses: Bonuses): DerivedStats {
    const equipped = Object.values(worker.equipment)
        .map(id => items.find(i => i.id === id))
        .filter((i): i is Item => Boolean(i))
    const affix = equipped.length ? sumAffixes(equipped) : emptyTotals()
    const lvl = levelMultiplier(worker)

    const speedPct = 1 + (affix.speed + bonuses.speed) / 100
    const carryPct = 1 + (affix.carryCapacity + bonuses.carry) / 100
    const strengthPct = 1 + (affix.strength + bonuses.strength) / 100
    // Rations saved and the research bonus both cut drain; clamp so it can never
    // go negative and start refilling food for free.
    const hungerPct = Math.max(0.05, 1 - (affix.hungerReduction - bonuses.hungerRate) / 100)

    const categoryYield = {} as Record<Category, number>
    for (const category of CATEGORIES) {
        categoryYield[category] = 1 + affix[`yield_${category}`] / 100
    }

    return {
        speed: worker.base.speed * lvl * speedPct,
        carry: Math.max(1, Math.round(worker.base.carry * lvl * carryPct)),
        strength: worker.base.strength * lvl * strengthPct,
        hunger: worker.base.hunger * hungerPct,
        coinFind: affix.coinFind / 100,
        xpGain: 1 + affix.xpGain / 100,
        categoryYield
    }
}

/** Combat power: strength expressed on the scale camps are rated against. */
export function combatPower(stats: DerivedStats): number {
    return Math.round(stats.strength * 16)
}

/** Does this worker specialise in the category a resource belongs to? */
export function isSpecialist(worker: Worker, resource: ResourceId | undefined): boolean {
    const category = resource ? RESOURCES[resource]?.category : undefined
    return category !== undefined && (worker.specialties ?? []).includes(category)
}

/**
 * The multiplier on what a worker actually pulls out of a given seam: its
 * category gear plus the specialty bonus. Kept separate from `harvest` because
 * one changes how fast they fill a pack and the other changes how much comes out.
 */
export function yieldMultiplier(worker: Worker, stats: DerivedStats, resource: ResourceId | undefined): number {
    const category = resource ? RESOURCES[resource]?.category : undefined
    if (!category) return 1
    const specialty = isSpecialist(worker, resource) ? 1 + SPECIALTY_HARVEST_BONUS : 1
    return stats.categoryYield[category] * specialty
}

export function rarityColor(rarity: Rarity): string {
    return RARITY_BY_ID[rarity].color
}
