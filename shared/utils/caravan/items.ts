import {
    AFFIX_BY_STAT,
    AFFIX_CAP,
    CATEGORIES,
    ITEM_BASES,
    MAKES,
    MAKE_BY_ID,
    RARITIES,
    RARITY_BY_ID,
    SET_THRESHOLD_GREATER,
    SET_THRESHOLD_LESSER,
    type ItemBase
} from './config'
import type { Rng } from './rng'
import type { Affix, AffixStat, Category, Item, Make, Rarity } from './types'

/**
 * Item rolling. The design goal is that two commons of the same base are still
 * different items: the affix set is drawn from the base's pool, and each value
 * is rolled independently inside a tier- and rarity-scaled range. A high roll on
 * a low rarity can beat a bad roll one rarity up, which is what makes the
 * workshop worth visiting more than once.
 */

export function rollRarity(rng: Rng, minimum: Rarity = 'common'): Rarity {
    const floor = RARITIES.findIndex(r => r.id === minimum)
    const pool = RARITIES.slice(Math.max(0, floor))
    const total = pool.reduce((sum, r) => sum + r.weight, 0)
    let roll = rng.next() * total
    for (const r of pool) {
        roll -= r.weight
        if (roll <= 0) return r.id
    }
    return pool[pool.length - 1]!.id
}

/** The [min, max] an affix can roll at a given tier and rarity. */
export function affixRange(stat: AffixStat, tier: number, rarity: Rarity): [number, number] {
    const def = AFFIX_BY_STAT[stat]
    const power = RARITY_BY_ID[rarity].power
    const ceiling = Math.min(AFFIX_CAP, (def.max + def.perTier * (tier - 1)) * power)
    const floor = Math.min(ceiling, (def.min + def.perTier * (tier - 1) * 0.25) * power)
    return [Math.round(floor), Math.round(ceiling)]
}

function rollAffixes(rng: Rng, base: ItemBase, tier: number, rarity: Rarity): Affix[] {
    const slots = RARITY_BY_ID[rarity].affixes
    const pool = [...base.pool]
    const affixes: Affix[] = []
    for (let i = 0; i < slots; i++) {
        if (pool.length === 0) break
        // Weight toward the front of the pool so the base keeps its identity:
        // a pickaxe leads with harvest speed far more often than with coin find.
        const idx = Math.min(pool.length - 1, Math.floor(Math.pow(rng.next(), 1.8) * pool.length))
        const stat = pool.splice(idx, 1)[0]!
        affixes.push(rollAffixValue(rng, stat, tier, rarity))
    }
    return affixes
}

export function rollAffixValue(rng: Rng, stat: AffixStat, tier: number, rarity: Rarity): Affix {
    const [min, max] = affixRange(stat, tier, rarity)
    // Squaring the roll biases toward the low end, so a near-max roll is a real event.
    const quality = Math.pow(rng.next(), 1.55)
    return { stat, value: Math.round(min + (max - min) * quality), quality }
}

export function rollItem(rng: Rng, tier: number, opts: { rarity?: Rarity, baseId?: string, make?: Make, now: number }): Item {
    const base = opts.baseId
        ? ITEM_BASES.find(b => b.id === opts.baseId) ?? rng.pick(ITEM_BASES)
        : rng.pick(ITEM_BASES)
    const rarity = opts.rarity ?? rollRarity(rng)
    return {
        id: `it_${opts.now.toString(36)}_${rng.int(0, 0xffffff).toString(36)}`,
        base: base.id,
        slot: base.slot,
        tier,
        rarity,
        make: opts.make ?? rng.pick(MAKES).id,
        affixes: rollAffixes(rng, base, tier, rarity),
        rolledAt: opts.now
    }
}

/** Reroll every affix value, keeping the base, tier, rarity and affix set. */
export function rerollItem(rng: Rng, item: Item): Item {
    return {
        ...item,
        affixes: item.affixes.map(a => rollAffixValue(rng, a.stat, item.tier, item.rarity))
    }
}

export function itemBase(item: Item): ItemBase {
    return ITEM_BASES.find(b => b.id === item.base) ?? ITEM_BASES[0]!
}

export function itemName(item: Item): string {
    return `${RARITY_BY_ID[item.rarity].name} ${itemBase(item).name}`
}

/**
 * A single number for sorting and for "is this an upgrade" hints. Weighted so a
 * huge combat roll does not outrank a huge harvest roll for a mining worker --
 * the UI shows the affixes anyway, this is only a tiebreak.
 */
export function itemScore(item: Item): number {
    return item.affixes.reduce((sum, a) => sum + a.value, 0) * (1 + item.tier * 0.15)
}

export type StatTotals = Record<AffixStat, number>

export function emptyTotals(): StatTotals {
    const totals = {
        strength: 0,
        carryCapacity: 0,
        speed: 0,
        hungerReduction: 0,
        coinFind: 0,
        xpGain: 0
    } as StatTotals
    for (const category of CATEGORIES) totals[`yield_${category}`] = 0
    return totals
}

/**
 * Sum equipped affixes into flat percentage totals, then fold in whatever set
 * bonuses the loadout has earned. Sets are counted per make: three matching
 * pieces grant the lesser bonus, five grant the greater one on top.
 */
export function sumAffixes(items: Item[]): StatTotals {
    const totals = emptyTotals()
    for (const item of items) {
        for (const affix of item.affixes) totals[affix.stat] += affix.value
    }
    for (const set of activeSets(items)) {
        const def = MAKE_BY_ID[set.make]
        totals[def.three.stat] += def.three.value
        if (set.count >= SET_THRESHOLD_GREATER) totals[def.five.stat] += def.five.value
    }
    return totals
}

export interface ActiveSet {
    make: Make
    count: number
    /** True once the five-piece bonus is also live. */
    greater: boolean
}

/** Which makes a loadout has enough pieces of to matter. */
export function activeSets(items: Item[]): ActiveSet[] {
    const counts = new Map<Make, number>()
    for (const item of items) counts.set(item.make, (counts.get(item.make) ?? 0) + 1)
    return [...counts.entries()]
        .filter(([, count]) => count >= SET_THRESHOLD_LESSER)
        .map(([make, count]) => ({ make, count, greater: count >= SET_THRESHOLD_GREATER }))
        .sort((a, b) => b.count - a.count)
}

/** Every make in a loadout with its count, for the worker card's set readout. */
export function makeCounts(items: Item[]): { make: Make, count: number }[] {
    const counts = new Map<Make, number>()
    for (const item of items) counts.set(item.make, (counts.get(item.make) ?? 0) + 1)
    return [...counts.entries()].map(([make, count]) => ({ make, count })).sort((a, b) => b.count - a.count)
}

/** The category a `yield_*` affix pays out on, or null for a generic affix. */
export function affixCategory(stat: AffixStat): Category | null {
    return stat.startsWith('yield_') ? (stat.slice(6) as Category) : null
}
