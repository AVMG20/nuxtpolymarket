import type { AffixStat, Category, ItemSlot, Make, Rarity, ResourceId } from './types'

/**
 * Static game data. Everything the balance of the game depends on lives here so
 * it can be tuned in one place, and so client and server never disagree about
 * what a thing costs.
 */

export const MAX_TIER = 8

export interface TierDef {
    tier: number
    name: string
    /** Node/worker colour, deliberately dull at tier 1 and vivid at tier 8. */
    color: string
    /** Secondary colour used for glows and road highlights. */
    glow: string
    raw: ResourceId[]
    refined: ResourceId[]
    /** Which of `refined` is the provision that feeds workers. */
    provision: ResourceId
}

export const TIERS: TierDef[] = [
    {
        tier: 1,
        name: 'Wayside',
        color: '#8b8f96',
        glow: '#b9bec6',
        raw: ['lumber', 'rough_stone', 'plant_fiber'],
        refined: ['planks', 'bread'],
        provision: 'bread'
    },
    {
        tier: 2,
        name: 'Ironvale',
        color: '#a9713f',
        glow: '#d99a5e',
        raw: ['copper_ore', 'iron_ore', 'clay'],
        refined: ['bronze_ingot', 'dried_meat'],
        provision: 'dried_meat'
    },
    {
        tier: 3,
        name: 'Silverreach',
        color: '#6f9fc4',
        glow: '#a8d4f0',
        raw: ['silver_ore', 'gem_shard', 'hardwood'],
        refined: ['steel', 'hearty_stew'],
        provision: 'hearty_stew'
    },
    {
        tier: 4,
        name: 'Gemhold',
        color: '#9a63d4',
        glow: '#c79bf5',
        raw: ['amethyst', 'dark_iron', 'ash_salt'],
        refined: ['ghost_iron', 'spiced_elixir'],
        provision: 'spiced_elixir'
    },
    {
        tier: 5,
        name: 'Emberwaste',
        color: '#e0682c',
        glow: '#ffa15c',
        raw: ['blood_quartz', 'ember_core', 'scorch_hide'],
        refined: ['soul_glass', 'ember_feast'],
        provision: 'ember_feast'
    },
    {
        tier: 6,
        name: 'Rimehold',
        color: '#2fc9c0',
        glow: '#7ff5ee',
        raw: ['rime_crystal', 'star_flax', 'glacier_ore'],
        refined: ['starsteel', 'ambrosia'],
        provision: 'ambrosia'
    },
    {
        tier: 7,
        name: 'Dragonmarch',
        color: '#e8305f',
        glow: '#ff7ea0',
        raw: ['dragon_bone', 'aether_dust', 'obsidian'],
        refined: ['aetherium', 'dragon_broth'],
        provision: 'dragon_broth'
    },
    {
        tier: 8,
        name: 'Voidreach',
        color: '#c9f04a',
        glow: '#f2ffa8',
        raw: ['singularity_shard', 'world_root', 'echo_silk'],
        refined: ['worldsteel', 'ichor'],
        provision: 'ichor'
    }
]

/**
 * Workers specialise by category rather than by individual resource, so a timber
 * specialist stays a timber specialist all the way from Lumber at tier 1 to
 * World Root at tier 8.
 */
export const CATEGORIES: Category[] = ['wood', 'stone', 'ore', 'fiber', 'gem']

export const CATEGORY_NAMES: Record<Category, string> = {
    wood: 'Timber',
    stone: 'Stonework',
    ore: 'Mining',
    fiber: 'Foraging',
    gem: 'Gemcutting'
}

export const CATEGORY_ICONS: Record<Category, string> = {
    wood: 'i-lucide-trees',
    stone: 'i-lucide-mountain',
    ore: 'i-lucide-pickaxe',
    fiber: 'i-lucide-wheat',
    gem: 'i-lucide-gem'
}

export const CATEGORY_COLORS: Record<Category, string> = {
    wood: '#6aa84f',
    stone: '#9aa0a6',
    ore: '#c58b3c',
    fiber: '#7fbf7f',
    gem: '#a978d8'
}

/** Every raw resource's category, in tier order. */
const RAW_CATEGORIES: Record<ResourceId, Category> = {
    lumber: 'wood', rough_stone: 'stone', plant_fiber: 'fiber',
    copper_ore: 'ore', iron_ore: 'ore', clay: 'stone',
    silver_ore: 'ore', gem_shard: 'gem', hardwood: 'wood',
    amethyst: 'gem', dark_iron: 'ore', ash_salt: 'stone',
    blood_quartz: 'gem', ember_core: 'ore', scorch_hide: 'fiber',
    rime_crystal: 'gem', star_flax: 'fiber', glacier_ore: 'ore',
    dragon_bone: 'stone', aether_dust: 'gem', obsidian: 'stone',
    singularity_shard: 'gem', world_root: 'wood', echo_silk: 'fiber'
}

export interface ResourceDef {
    id: ResourceId
    name: string
    tier: number
    kind: 'raw' | 'refined' | 'provision'
    /** Base coin value of one unit, used for auto-sell and camp loot. */
    value: number
    /** Raw resources only: which specialty works this seam. */
    category?: Category
}

const RESOURCE_NAMES: Record<string, string> = {
    lumber: 'Lumber',
    rough_stone: 'Rough Stone',
    plant_fiber: 'Plant Fiber',
    planks: 'Planks',
    bread: 'Bread',
    copper_ore: 'Copper Ore',
    iron_ore: 'Iron Ore',
    clay: 'Clay',
    bronze_ingot: 'Bronze Ingot',
    dried_meat: 'Dried Meat',
    silver_ore: 'Silver Ore',
    gem_shard: 'Gem Shard',
    hardwood: 'Hardwood',
    steel: 'Reinforced Steel',
    hearty_stew: 'Hearty Stew',
    amethyst: 'Amethyst',
    dark_iron: 'Dark Iron',
    ash_salt: 'Ash Salt',
    ghost_iron: 'Ghost Iron',
    spiced_elixir: 'Spiced Elixir',
    blood_quartz: 'Blood Quartz',
    ember_core: 'Ember Core',
    scorch_hide: 'Scorch Hide',
    soul_glass: 'Soul Glass',
    ember_feast: 'Ember Feast',
    rime_crystal: 'Rime Crystal',
    star_flax: 'Star Flax',
    glacier_ore: 'Glacier Ore',
    starsteel: 'Starsteel',
    ambrosia: 'Ambrosia',
    dragon_bone: 'Dragon Bone',
    aether_dust: 'Aether Dust',
    obsidian: 'Obsidian',
    aetherium: 'Aetherium',
    dragon_broth: 'Dragon Broth',
    singularity_shard: 'Singularity Shard',
    world_root: 'World Root',
    echo_silk: 'Echo Silk',
    worldsteel: 'Worldsteel',
    ichor: 'Ichor'
}

/** Every resource in the game, keyed by id. */
export const RESOURCES: Record<ResourceId, ResourceDef> = (() => {
    const out: Record<ResourceId, ResourceDef> = {}
    for (const t of TIERS) {
        // Raw value climbs ~2.2x per tier. Workers now carry and harvest 25%
        // more per tier of their own, so the resource curve carries less of the
        // progression than it used to -- together they land near 2.6x an hour.
        const rawValue = Math.round(220 * Math.pow(2.2, t.tier - 1))
        for (const id of t.raw) {
            out[id] = {
                id,
                name: RESOURCE_NAMES[id] ?? id,
                tier: t.tier,
                kind: 'raw',
                value: rawValue,
                category: RAW_CATEGORIES[id]
            }
        }
        for (const id of t.refined) {
            out[id] = {
                id,
                name: RESOURCE_NAMES[id] ?? id,
                tier: t.tier,
                kind: id === t.provision ? 'provision' : 'refined',
                value: rawValue * 5
            }
        }
    }
    return out
})()

export const ALL_RESOURCE_IDS = Object.keys(RESOURCES)

/**
 * A resource's icon and colour. The game is dense with numbers, so anywhere a
 * cost or a stock is shown it gets a glyph too -- reading "three ore, two
 * timber" off shapes is far faster than reading it off names.
 */
export function resourceIcon(id: ResourceId): string {
    const def = RESOURCES[id]
    if (!def) return 'i-lucide-box'
    if (def.kind === 'provision') return 'i-lucide-drumstick'
    if (def.kind === 'refined') return 'i-lucide-boxes'
    return def.category ? CATEGORY_ICONS[def.category] : 'i-lucide-box'
}

export function resourceColor(id: ResourceId): string {
    const def = RESOURCES[id]
    if (!def) return '#9ca3af'
    if (def.kind === 'provision') return '#f0a14b'
    if (def.kind === 'refined') return TIERS[def.tier - 1]?.glow ?? '#e5e7eb'
    return def.category ? CATEGORY_COLORS[def.category] : '#9ca3af'
}

// ---------------------------------------------------------------------------
// Refining
// ---------------------------------------------------------------------------

export interface Recipe {
    id: string
    output: ResourceId
    outputCount: number
    inputs: Record<ResourceId, number>
    /** Seconds of refinery time per batch. Refining is instant for now but the
     *  field is here so a queue can be layered on without a data migration. */
    seconds: number
    tier: number
}

export const RECIPES: Recipe[] = TIERS.flatMap((t) => {
    const [a, b, c] = t.raw as [ResourceId, ResourceId, ResourceId]
    const [refined, provision] = t.refined as [ResourceId, ResourceId]
    const prevProvision = t.tier > 1 ? TIERS[t.tier - 2]!.provision : null
    return [
        {
            id: `refine_${refined}`,
            output: refined,
            outputCount: 1,
            inputs: { [a]: 4, [b]: 4 } as Record<ResourceId, number>,
            seconds: 5 * t.tier,
            tier: t.tier
        },
        {
            id: `refine_${provision}`,
            output: provision,
            outputCount: 4,
            inputs: prevProvision
                ? ({ [c]: 3, [prevProvision]: 1 } as Record<ResourceId, number>)
                : ({ [c]: 3 } as Record<ResourceId, number>),
            seconds: 4 * t.tier,
            tier: t.tier
        }
    ]
})

// ---------------------------------------------------------------------------
// Refining and research timing
// ---------------------------------------------------------------------------

/**
 * Refining is a queue, not a button. Every batch takes real time, which turns
 * the refinery into a second idle loop: you come back to collect, and the
 * decision of what to queue matters because the line is the bottleneck.
 */
export const BASE_REFINERY_LINES = 1
export const MAX_REFINERY_LINES = 5

/** How many batches may be waiting at once. Generous; it only bounds the save. */
export const MAX_REFINERY_QUEUE = 40

/**
 * Re-lay the whole queue onto the lines from `now`, preserving order and each
 * batch's remaining work. Needed whenever the queue changes shape -- a cancelled
 * batch should hand its line time to whatever was waiting behind it.
 */
export function rescheduleRefineJobs<T extends { line: number, startedAt: number, doneAt: number }>(
    jobs: T[],
    lines: number,
    now: number
): T[] {
    const freeAt = new Array(Math.max(1, lines)).fill(now)
    return jobs
        .slice()
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((job) => {
            // Work already done is not repeated; only what is left gets rescheduled.
            const remaining = Math.max(0, job.doneAt - Math.max(now, job.startedAt))
            let line = 0
            for (let i = 1; i < freeAt.length; i++) {
                if (freeAt[i]! < freeAt[line]!) line = i
            }
            const startedAt = freeAt[line]!
            const doneAt = startedAt + remaining
            freeAt[line] = doneAt
            return { ...job, line, startedAt, doneAt }
        })
}

/**
 * Schedule a batch onto the line that frees up first. Queueing is never blocked
 * -- lines decide how fast the backlog clears, not whether you may add to it.
 */
export function scheduleRefineJob(
    existing: { line: number, doneAt: number }[],
    lines: number,
    now: number,
    seconds: number
): { line: number, startedAt: number, doneAt: number } {
    let bestLine = 0
    let bestFree = Infinity
    for (let line = 0; line < lines; line++) {
        const free = existing
            .filter(job => job.line === line)
            .reduce((latest, job) => Math.max(latest, job.doneAt), now)
        if (free < bestFree) {
            bestFree = free
            bestLine = line
        }
    }
    const startedAt = Math.max(now, bestFree)
    return { line: bestLine, startedAt, doneAt: startedAt + seconds * 1000 }
}

/** Seconds one batch of a recipe takes on a single line, before research. */
export function refineSeconds(recipeTier: number): number {
    return 12 * Math.pow(1.35, recipeTier - 1)
}

/** Research is a job too, so a tier's board is paced rather than bought out. */
export function researchSeconds(tier: number): number {
    return Math.round(900 * Math.pow(1.55, tier - 1))
}

/** How long a queued batch actually takes once research is applied. */
export function effectiveRefineSeconds(recipeTier: number, speedBonus: number): number {
    return refineSeconds(recipeTier) / (1 + speedBonus / 100)
}

// ---------------------------------------------------------------------------
// Economy curves
// ---------------------------------------------------------------------------

/** Coin cost of the next node purchase, given how many the player already owns. */
/**
 * Node price. The curve is deliberately gentler than it was: past a dozen nodes
 * a steeper base turned every purchase into a wall, and expansion is meant to be
 * the thing you always want more of. The late sinks are tier gates, research
 * time and refining throughput, not the twentieth node costing a quarter billion.
 */
export function nodeCost(ownedCount: number): number {
    return Math.round(100_000 * Math.pow(1.35, ownedCount))
}

/** Coin cost of upgrading a road from `level` to `level + 1`. */
export function roadCost(level: number): number {
    return Math.round(60_000 * Math.pow(2.6, level))
}

export const MAX_ROAD_LEVEL = 4

/** Movement multiplier granted by a road level. Level 4 is a bit over 2x. */
export function roadSpeedMultiplier(level: number): number {
    return 1 + level * 0.28
}

/** What each stage of road is called, so an upgrade reads as a real change. */
export const ROAD_NAMES = ['Dirt track', 'Gravel road', 'Cobbled road', 'Paved highway', 'Imperial causeway'] as const

/**
 * Roads are coloured by their own stage and nothing else -- a causeway looks
 * like a causeway wherever it is. Tinting them by the tier of the nodes they
 * joined made two identical roads look different for no reason a player could see.
 */
export const ROAD_COLORS = ['#4f4b44', '#7d7568', '#a49a89', '#d2d6dd', '#f2d089'] as const

/**
 * Paving costs the refined goods of the tier matching the stage, so a highway is
 * something you build once your caravan has actually reached that far.
 */
export function roadUpgradeTier(level: number): number {
    return Math.min(MAX_TIER, level + 1)
}

export function roadResourceCost(level: number): Record<ResourceId, number> {
    const tier = roadUpgradeTier(level)
    const def = TIERS[tier - 1]!
    const [refined, provision] = def.refined as [ResourceId, ResourceId]
    const amount = Math.round(80 * Math.pow(1.5, level))
    return { [refined]: amount, [provision]: Math.round(amount / 2) }
}

// ---------------------------------------------------------------------------
// Node priority and capacity
// ---------------------------------------------------------------------------

/**
 * Workers are never assigned to a node by hand. Instead every node carries a
 * priority, and the caravan fills the highest-priority node that still has room
 * before looking at anything below it. Priority is a per-node setting, so the
 * amount of management a player does stops growing once the map settles --
 * twenty-five workers is exactly as much work to steer as five.
 *
 * Off (0) takes a node out of rotation entirely. When everything is on Low, the
 * tie-break is round-trip time, so an unmanaged caravan simply works whatever is
 * closest to home.
 */
export const PRIORITY_LABELS = ['Off', 'Low', 'Normal', 'High', 'Urgent', 'Critical'] as const
export const MAX_PRIORITY = 5
export const DEFAULT_PRIORITY = 1

export const PRIORITY_COLORS = ['#6b7280', '#64748b', '#38bdf8', '#4ade80', '#fbbf24', '#f87171'] as const

/**
 * A specialist reads a matching node as one priority step higher than it is.
 * One step, deliberately: a miner will pick Normal ore over Normal timber and
 * over High timber, but Urgent timber still outranks them -- so raising a
 * priority two steps is always an order nobody argues with.
 */
export const SPECIALTY_PRIORITY_BONUS = 1

/** Bonus harvest rate a worker gets on a seam in one of its specialties. */
export const SPECIALTY_HARVEST_BONUS = 0.3

export const BASE_NODE_CAPACITY = 3
export const MAX_NODE_CAPACITY = 8

/**
 * Widening a seam costs the refined goods of ever higher tiers, so a node you
 * claimed at tier 1 keeps giving you a reason to come back with tier 5 material.
 */
export function capacityUpgradeTier(current: number): number {
    return Math.min(MAX_TIER, Math.max(1, current))
}

export function capacityCoinCost(current: number, nodeTier: number): number {
    return Math.round(150_000 * Math.pow(2.1, current - BASE_NODE_CAPACITY) * Math.pow(2.6, nodeTier - 1))
}

export function capacityResourceCost(current: number): Record<ResourceId, number> {
    const tier = capacityUpgradeTier(current)
    const def = TIERS[tier - 1]!
    const [refined, provision] = def.refined as [ResourceId, ResourceId]
    const amount = Math.round(60 * Math.pow(1.45, current - BASE_NODE_CAPACITY))
    return { [refined]: amount, [provision]: Math.round(amount / 2) }
}

// ---------------------------------------------------------------------------
// Recruitment market
// ---------------------------------------------------------------------------

/** The slate turns over twice a day; there is no cron, the window is derived. */
export const MARKET_WINDOW_MS = 12 * 3600 * 1000
export const BASE_MARKET_SLOTS = 3
/** Chance a recruit is drawn a tier above the player's own. */
export const MARKET_OVERTIER_CHANCE = 0.15

/**
 * Gems to reseed the slate without waiting out the twelve hours. Priced against
 * a player earning roughly twenty gems a day, so it is a real decision rather
 * than something you spam when the slate looks dull.
 */
export const MARKET_REFRESH_GEMS = 25

/** What a recruit asks for, from its tier, rarity and how well it rolled. */
export function recruitPrice(tier: number, rarityIndex: number, quality: number): number {
    return Math.round(60_000 * Math.pow(3.2, tier - 1) * (1 + rarityIndex * 0.7) * (0.85 + quality * 0.5))
}

/** Base caps before research. Research is the only way to raise them. */
export const BASE_MAX_WORKERS = 3
export const BASE_MAX_CAPITALS = 1

// ---------------------------------------------------------------------------
// Gem grants
// ---------------------------------------------------------------------------

/**
 * Gems are the site's scarce currency -- a player earns roughly 20 a day at the
 * very best -- so they buy only a handful of things here, and none of them are
 * on the critical path. Everything below is a shortcut or a luxury: a slot you
 * could otherwise have researched, a hire you could otherwise have rerolled by
 * hand, a reroll that protects the one affix you care about. Coins and refined
 * goods still buy the game.
 */

export const MAX_CHARTERS = 6
export const MAX_DEEDS = 2

/** Gem cost of the next Caravan Charter, a permanent +1 worker slot. */
export function charterGemCost(owned: number): number {
    return 40 + owned * 20
}

/** Gem cost of the next Royal Deed, a permanent +1 capital slot. */
export function deedGemCost(owned: number): number {
    return owned === 0 ? 100 : 175
}

/** Gems to hire a veteran: same coin price, but the rarity floor is Epic. */
export const VETERAN_GEM_COST = 30

/** Gems to reroll an item while protecting its single strongest affix. */
export const MASTER_REROLL_GEM_COST = 15

// ---------------------------------------------------------------------------
// Tier advancement
// ---------------------------------------------------------------------------

export interface TierRequirement {
    coins: number
    resources: Record<ResourceId, number>
    nodes: number
}

/** What it takes to advance from `tier` to `tier + 1`. */
export function tierRequirement(tier: number): TierRequirement | null {
    const def = TIERS[tier - 1]
    if (!def || tier >= MAX_TIER) return null
    const [refined, provision] = def.refined as [ResourceId, ResourceId]
    // Coins scale hard because income does. Material counts barely scale at all,
    // because a caravan hauls roughly the same number of units per hour at every
    // tier -- what changes is what those units are worth.
    const scale = Math.pow(1.35, tier - 1)
    return {
        coins: Math.round(3_000_000 * Math.pow(3.3, tier - 1)),
        resources: {
            [refined]: Math.round(500 * scale),
            [provision]: Math.round(250 * scale)
        },
        nodes: 2 + tier * 2
    }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Every item is forged in one of five traditions. Two pieces of a make on one
 * worker unlocks its lesser bonus and all three unlock the greater one -- a
 * second axis to chase that has nothing to do with raw affix rolls, and a reason
 * to keep an otherwise mediocre item. The thresholds are two and three because
 * that is how many slots a worker has.
 */
export interface MakeDef {
    id: Make
    name: string
    color: string
    /** Applied at three pieces, and again (on top) at five. */
    three: { label: string, stat: AffixStat, value: number }
    five: { label: string, stat: AffixStat, value: number }
}

export const MAKES: MakeDef[] = [
    {
        id: 'dwarven',
        name: 'Dwarven',
        color: '#d99a5e',
        three: { label: '+60% carry capacity', stat: 'carryCapacity', value: 60 },
        five: { label: '+35% strength', stat: 'strength', value: 35 }
    },
    {
        id: 'sylvan',
        name: 'Sylvan',
        color: '#7fbf7f',
        three: { label: '+55% movement speed', stat: 'speed', value: 55 },
        five: { label: '+40% rations saved', stat: 'hungerReduction', value: 40 }
    },
    {
        id: 'ashen',
        name: 'Ashen',
        color: '#f87171',
        three: { label: '+90% strength', stat: 'strength', value: 90 },
        five: { label: '+45% carry capacity', stat: 'carryCapacity', value: 45 }
    },
    {
        id: 'gilded',
        name: 'Gilded',
        color: '#fbbf24',
        three: { label: '+70% coin find', stat: 'coinFind', value: 70 },
        five: { label: '+60% experience gain', stat: 'xpGain', value: 60 }
    },
    {
        id: 'runed',
        name: 'Runed',
        color: '#a78bfa',
        three: { label: '+65% strength', stat: 'strength', value: 65 },
        five: { label: '+50% rations saved', stat: 'hungerReduction', value: 50 }
    }
]

export const MAKE_BY_ID: Record<Make, MakeDef> = Object.fromEntries(MAKES.map(m => [m.id, m])) as Record<Make, MakeDef>

export const SET_THRESHOLD_LESSER = 2
export const SET_THRESHOLD_GREATER = 3

export interface ItemBase {
    id: string
    name: string
    slot: ItemSlot
    /**
     * Stats this base can roll, most characteristic first. Rolls are drawn
     * without replacement and weighted toward the front, so a pickaxe almost
     * always leads with harvest speed but a five-affix legendary still has
     * enough distinct stats to fill every slot.
     */
    pool: AffixStat[]
}

export const ITEM_BASES: ItemBase[] = [
    { id: 'pickaxe', name: 'Pickaxe', slot: 'tool', pool: ['yield_ore', 'strength', 'yield_gem', 'yield_stone', 'xpGain', 'carryCapacity', 'coinFind'] },
    { id: 'axe', name: 'Felling Axe', slot: 'tool', pool: ['yield_wood', 'strength', 'carryCapacity', 'yield_fiber', 'xpGain', 'speed'] },
    { id: 'sickle', name: 'Harvest Sickle', slot: 'tool', pool: ['yield_fiber', 'strength', 'yield_wood', 'coinFind', 'speed', 'xpGain'] },
    { id: 'chisel', name: 'Mason Chisel', slot: 'tool', pool: ['yield_stone', 'strength', 'yield_gem', 'carryCapacity', 'xpGain', 'hungerReduction'] },
    { id: 'blade', name: 'Blade', slot: 'weapon', pool: ['strength', 'speed', 'xpGain', 'coinFind', 'carryCapacity'] },
    { id: 'maul', name: 'Maul', slot: 'weapon', pool: ['strength', 'carryCapacity', 'xpGain', 'hungerReduction', 'yield_stone'] },
    { id: 'crossbow', name: 'Crossbow', slot: 'weapon', pool: ['strength', 'coinFind', 'speed', 'xpGain', 'yield_ore'] },
    { id: 'satchel', name: 'Satchel', slot: 'pack', pool: ['carryCapacity', 'hungerReduction', 'coinFind', 'yield_fiber', 'speed', 'xpGain'] },
    { id: 'yoke', name: 'Yoke', slot: 'pack', pool: ['carryCapacity', 'strength', 'yield_wood', 'speed', 'hungerReduction', 'xpGain'] },
    { id: 'crate', name: 'Strapped Crate', slot: 'pack', pool: ['carryCapacity', 'yield_stone', 'hungerReduction', 'coinFind', 'strength'] },
    { id: 'harness', name: 'Trail Harness', slot: 'pack', pool: ['speed', 'hungerReduction', 'carryCapacity', 'xpGain', 'coinFind', 'yield_fiber'] }
]

/**
 * Three slots, not five. Five meant a hundred and twenty-five decisions across a
 * full roster and most of them were noise; three keeps every fit meaningful.
 */
export const ITEM_SLOTS: ItemSlot[] = ['tool', 'weapon', 'pack']

export const SLOT_NAMES: Record<ItemSlot, string> = {
    tool: 'Tool',
    weapon: 'Weapon',
    pack: 'Pack'
}

export const SLOT_ICONS: Record<ItemSlot, string> = {
    tool: 'i-lucide-pickaxe',
    weapon: 'i-lucide-swords',
    pack: 'i-lucide-backpack'
}

export interface RarityDef {
    id: Rarity
    name: string
    color: string
    affixes: number
    /** Multiplies the top of every affix's roll range. */
    power: number
    /** Relative weight when rolling a random rarity. */
    weight: number
}

export const RARITIES: RarityDef[] = [
    { id: 'common', name: 'Common', color: '#9ca3af', affixes: 1, power: 0.34, weight: 1000 },
    { id: 'uncommon', name: 'Uncommon', color: '#4ade80', affixes: 2, power: 0.52, weight: 420 },
    { id: 'rare', name: 'Rare', color: '#60a5fa', affixes: 3, power: 0.72, weight: 140 },
    { id: 'epic', name: 'Epic', color: '#c084fc', affixes: 4, power: 0.88, weight: 34 },
    { id: 'legendary', name: 'Legendary', color: '#fbbf24', affixes: 5, power: 1, weight: 6 }
]

export const RARITY_BY_ID: Record<Rarity, RarityDef> = Object.fromEntries(
    RARITIES.map(r => [r.id, r])
) as Record<Rarity, RarityDef>

export interface AffixDef {
    stat: AffixStat
    name: string
    /** Roll range at tier 1, before rarity and tier scaling. Percentages. */
    min: number
    max: number
    /** Additional percentage points added to `max` per tier above 1. */
    perTier: number
}

/**
 * Affix ranges are deliberately loud. A legendary tier-8 roll on the top end of
 * carryCapacity lands near +300%, which is the ceiling the design asks for --
 * an item should feel like it changes the game, not like a rounding error.
 */
/** Category yield affixes roll far higher than generic ones, because they only
 *  pay out on one kind of seam. A great ore roll is dead weight on a timber
 *  worker, which is what makes kitting out a specialist a real decision. */
const CATEGORY_AFFIXES: AffixDef[] = CATEGORIES.map(category => ({
    stat: `yield_${category}` as AffixStat,
    name: `${CATEGORY_NAMES[category]} Yield`,
    min: 14,
    max: 90,
    perTier: 44
}))

export const AFFIXES: AffixDef[] = [
    // Strength does double duty: it is how hard a worker swings at a seam and how
    // hard they hit a camp, so one number covers both jobs instead of two that
    // always moved together anyway.
    { stat: 'strength', name: 'Strength', min: 10, max: 70, perTier: 34 },
    { stat: 'carryCapacity', name: 'Carry Capacity', min: 10, max: 70, perTier: 33 },
    { stat: 'speed', name: 'Movement Speed', min: 6, max: 45, perTier: 22 },
    { stat: 'hungerReduction', name: 'Rations Saved', min: 5, max: 34, perTier: 12 },
    { stat: 'coinFind', name: 'Coin Find', min: 8, max: 55, perTier: 28 },
    { stat: 'xpGain', name: 'Experience Gain', min: 8, max: 50, perTier: 24 },
    ...CATEGORY_AFFIXES
]

export const AFFIX_BY_STAT: Record<AffixStat, AffixDef> = Object.fromEntries(
    AFFIXES.map(a => [a.stat, a])
) as Record<AffixStat, AffixDef>

/** Hard ceiling on any single affix roll, so tier 8 legendaries stay readable. */
export const AFFIX_CAP = 300

/** Coin cost to commission an item of the given tier at the workshop. */
export function craftCost(tier: number): number {
    return Math.round(80_000 * Math.pow(3.0, tier - 1))
}

/** Resource cost to commission an item, paid in that tier's refined goods. */
export function craftResourceCost(tier: number): Record<ResourceId, number> {
    const def = TIERS[tier - 1]
    if (!def) return {}
    const [a, b] = def.raw as [ResourceId, ResourceId]
    const refined = def.refined[0]!
    return { [a]: 25, [b]: 25, [refined]: 8 }
}

/** Shards recovered from salvaging an item. */
export function salvageValue(tier: number, rarity: Rarity): number {
    return Math.round((2 + tier * 3) * (1 + RARITIES.findIndex(r => r.id === rarity) * 0.9))
}

/** Shard cost to reroll every affix value on an item, keeping base and rarity. */
export function rerollCost(tier: number, rarity: Rarity): number {
    return Math.round((6 + tier * 6) * (1 + RARITIES.findIndex(r => r.id === rarity) * 1.1))
}

/**
 * Shards bought with gems. The rate climbs with your tier because everything a
 * shard buys climbs with it -- ten gems should be worth roughly the same amount
 * of rerolling at tier 8 as it is at tier 1.
 */
export function shardsPerGem(tier: number): number {
    return Math.round(15 * Math.pow(1.6, tier - 1))
}

/**
 * The reforge gamble. Most of the time nothing happens; occasionally the item
 * gains a slot it should not have; rarely it loses one for good. The odds are
 * fixed rather than tier-scaled so the decision reads the same at every tier.
 */
export const REFORGE_ODDS = {
    nothing: 0.45,
    reroll: 0.35,
    gain: 0.15,
    lose: 0.05
} as const

export const MAX_AFFIXES = 6

export function reforgeShardCost(tier: number, rarity: Rarity): number {
    return Math.round((90 + tier * 120) * (1 + RARITIES.findIndex(r => r.id === rarity) * 1.2))
}

/** Shard cost to guarantee a minimum rarity on a craft. */
export const GUARANTEE_COST: Record<Rarity, number> = {
    common: 0,
    uncommon: 20,
    rare: 90,
    epic: 400,
    legendary: 2200
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------

export interface ResearchDef {
    id: string
    name: string
    description: string
    /** Player tier required before this becomes visible. */
    tier: number
    coins: number
    resources: Record<ResourceId, number>
    requires?: string[]
    effect:
        | { kind: 'maxWorkers', amount: number }
        | { kind: 'maxCapitals', amount: number }
        | { kind: 'globalSpeed', amount: number }
        | { kind: 'globalCarry', amount: number }
        | { kind: 'globalStrength', amount: number }
        | { kind: 'refineryLines', amount: number }
        | { kind: 'refineSpeed', amount: number }
        | { kind: 'researchSpeed', amount: number }
        | { kind: 'hungerRate', amount: number }
        | { kind: 'regenRate', amount: number }
        | { kind: 'autoFeed' }
        | { kind: 'nodeCapacity', amount: number }
        | { kind: 'marketSlots', amount: number }
        | { kind: 'autoRefine' }
        | { kind: 'coinYield', amount: number }
}

function res(tier: number, mult: number): Record<ResourceId, number> {
    const def = TIERS[tier - 1]!
    const [refined, provision] = def.refined as [ResourceId, ResourceId]
    const scale = Math.pow(1.5, tier - 1)
    return { [refined]: Math.round(150 * mult * scale), [provision]: Math.round(70 * mult * scale) }
}

function coins(tier: number, mult: number): number {
    return Math.round(250_000 * mult * Math.pow(3.3, tier - 1))
}

export const RESEARCH: ResearchDef[] = [
    { id: 'market_2', name: 'Word Travels Fast', description: '+1 recruit on the market slate.', tier: 2, coins: coins(2, 0.6), resources: res(2, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_3', name: 'Word Travels Further', description: '+1 recruit on the market slate.', tier: 3, coins: coins(3, 0.6), resources: res(3, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_4', name: 'Word Travels Wide', description: '+1 recruit on the market slate.', tier: 4, coins: coins(4, 0.6), resources: res(4, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_5', name: 'Word Travels Far', description: '+1 recruit on the market slate.', tier: 5, coins: coins(5, 0.6), resources: res(5, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_6', name: 'Word Travels Overland', description: '+1 recruit on the market slate.', tier: 6, coins: coins(6, 0.6), resources: res(6, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_7', name: 'Word Travels Everywhere', description: '+1 recruit on the market slate.', tier: 7, coins: coins(7, 0.6), resources: res(7, 0.6), effect: { kind: 'marketSlots', amount: 1 } },
    { id: 'market_8', name: 'Word Travels Beyond', description: '+1 recruit on the market slate.', tier: 8, coins: coins(8, 0.6), resources: res(8, 0.6), effect: { kind: 'marketSlots', amount: 1 } },

    // Tier 2 unlocks the research board at all.
    { id: 'crew_1', name: 'Hiring Hall', description: '+2 maximum workers.', tier: 2, coins: coins(2, 1), resources: res(2, 1), effect: { kind: 'maxWorkers', amount: 2 } },
    { id: 'roads_1', name: 'Surveyed Trails', description: '+15% movement speed for every worker.', tier: 2, coins: coins(2, 1.2), resources: res(2, 1.2), effect: { kind: 'globalSpeed', amount: 15 } },
    { id: 'packs_1', name: 'Reinforced Packs', description: '+20% carry capacity for every worker.', tier: 2, coins: coins(2, 1.4), resources: res(2, 1.4), effect: { kind: 'globalCarry', amount: 20 } },

    { id: 'foreman', name: 'Wider Cuttings', description: '+1 worker can work every node at once, on top of whatever that node has been widened to.', tier: 2, coins: coins(2, 0.9), resources: res(2, 0.9), effect: { kind: 'nodeCapacity', amount: 1 } },

    { id: 'crew_2', name: 'Guild Charter', description: '+3 maximum workers.', tier: 3, coins: coins(3, 1), resources: res(3, 1), requires: ['crew_1'], effect: { kind: 'maxWorkers', amount: 3 } },
    { id: 'standing_orders', name: 'Kitchen Standing Orders', description: 'Unlocks a standing order: the refinery bakes provisions on demand so a caravan never stalls on an empty larder.', tier: 3, coins: coins(3, 0.8), resources: res(3, 0.8), effect: { kind: 'autoRefine' } },
    { id: 'capital_1', name: 'Second Seat', description: '+1 maximum capital node.', tier: 3, coins: coins(3, 1.8), resources: res(3, 1.8), effect: { kind: 'maxCapitals', amount: 1 } },
    { id: 'lines_1', name: 'Second Refinery Line', description: '+1 batch can be refined at the same time.', tier: 3, coins: coins(3, 1.1), resources: res(3, 1.1), effect: { kind: 'refineryLines', amount: 1 } },
    { id: 'refine_1', name: 'Bellows and Blast', description: 'Refining runs 60% faster.', tier: 3, coins: coins(3, 1.5), resources: res(3, 1.5), effect: { kind: 'refineSpeed', amount: 60 } },
    { id: 'tools_1', name: 'Tempered Tools', description: '+25% strength for every worker.', tier: 3, coins: coins(3, 1.3), resources: res(3, 1.3), effect: { kind: 'globalStrength', amount: 25 } },

    { id: 'rations_1', name: 'Preserved Rations', description: 'Workers eat 25% less on the road.', tier: 4, coins: coins(4, 1), resources: res(4, 1), effect: { kind: 'hungerRate', amount: -25 } },
    { id: 'crew_3', name: 'Caravan Company', description: '+4 maximum workers.', tier: 4, coins: coins(4, 1.4), resources: res(4, 1.4), requires: ['crew_2'], effect: { kind: 'maxWorkers', amount: 4 } },
    { id: 'lines_2', name: 'Third Refinery Line', description: '+1 batch can be refined at the same time.', tier: 4, coins: coins(4, 1.2), resources: res(4, 1.2), requires: ['lines_1'], effect: { kind: 'refineryLines', amount: 1 } },
    { id: 'scholars_1', name: 'Scholars Guild', description: 'Research completes 70% faster.', tier: 4, coins: coins(4, 1.3), resources: res(4, 1.3), effect: { kind: 'researchSpeed', amount: 70 } },
    { id: 'regen_1', name: 'Soil Enrichment', description: 'Depleted nodes recover 60% faster.', tier: 4, coins: coins(4, 1.6), resources: res(4, 1.6), effect: { kind: 'regenRate', amount: 60 } },

    { id: 'autofeed', name: 'Roadside Taverns', description: 'Workers refuel at any owned node instead of walking home to eat.', tier: 5, coins: coins(5, 2), resources: res(5, 2), effect: { kind: 'autoFeed' } },
    { id: 'capital_2', name: 'Twin Thrones', description: '+2 maximum capital nodes.', tier: 5, coins: coins(5, 2.2), resources: res(5, 2.2), requires: ['capital_1'], effect: { kind: 'maxCapitals', amount: 2 } },
    { id: 'lines_3', name: 'Fourth Refinery Line', description: '+1 batch can be refined at the same time.', tier: 5, coins: coins(5, 1.4), resources: res(5, 1.4), requires: ['lines_2'], effect: { kind: 'refineryLines', amount: 1 } },
    { id: 'refine_2', name: 'Continuous Casting', description: 'Refining runs a further 140% faster.', tier: 5, coins: coins(5, 1.7), resources: res(5, 1.7), requires: ['refine_1'], effect: { kind: 'refineSpeed', amount: 140 } },
    { id: 'roads_2', name: 'Imperial Highways', description: '+35% movement speed for every worker.', tier: 5, coins: coins(5, 1.8), resources: res(5, 1.8), requires: ['roads_1'], effect: { kind: 'globalSpeed', amount: 35 } },

    { id: 'crew_4', name: 'Overland Consortium', description: '+6 maximum workers.', tier: 6, coins: coins(6, 1.5), resources: res(6, 1.5), requires: ['crew_3'], effect: { kind: 'maxWorkers', amount: 6 } },
    { id: 'packs_2', name: 'Dimensional Crates', description: '+60% carry capacity for every worker.', tier: 6, coins: coins(6, 2), resources: res(6, 2), requires: ['packs_1'], effect: { kind: 'globalCarry', amount: 60 } },
    { id: 'lines_4', name: 'Fifth Refinery Line', description: '+1 batch can be refined at the same time. The line is full at five.', tier: 6, coins: coins(6, 1.6), resources: res(6, 1.6), requires: ['lines_3'], effect: { kind: 'refineryLines', amount: 1 } },
    { id: 'scholars_2', name: 'Astral Archive', description: 'Research completes a further 160% faster.', tier: 6, coins: coins(6, 1.8), resources: res(6, 1.8), requires: ['scholars_1'], effect: { kind: 'researchSpeed', amount: 160 } },
    { id: 'coins_1', name: 'Merchant Ledgers', description: '+40% coins when selling goods at the market.', tier: 6, coins: coins(6, 2.4), resources: res(6, 2.4), effect: { kind: 'coinYield', amount: 40 } },

    { id: 'tools_2', name: 'Resonant Instruments', description: '+70% strength for every worker.', tier: 7, coins: coins(7, 2), resources: res(7, 2), requires: ['tools_1'], effect: { kind: 'globalStrength', amount: 70 } },
    { id: 'capital_3', name: 'Continental Reach', description: '+3 maximum capital nodes.', tier: 7, coins: coins(7, 2.6), resources: res(7, 2.6), requires: ['capital_2'], effect: { kind: 'maxCapitals', amount: 3 } },

    { id: 'crew_5', name: 'The Endless Road', description: '+10 maximum workers.', tier: 8, coins: coins(8, 2), resources: res(8, 2), requires: ['crew_4'], effect: { kind: 'maxWorkers', amount: 10 } },
    { id: 'coins_2', name: 'Void Arbitrage', description: '+120% coins when selling goods at the market.', tier: 8, coins: coins(8, 3), resources: res(8, 3), requires: ['coins_1'], effect: { kind: 'coinYield', amount: 120 } }
]

export const RESEARCH_BY_ID: Record<string, ResearchDef> = Object.fromEntries(RESEARCH.map(r => [r.id, r]))

// ---------------------------------------------------------------------------
// Simulation constants
// ---------------------------------------------------------------------------

/** World-space units a base-speed worker covers per second. */
export const BASE_TRAVEL_SPEED = 26
/** Seconds a base worker takes to fill one carry slot at a tier-1 node. */
export const BASE_HARVEST_SECONDS = 2.4
/** Seconds spent unloading at a capital, regardless of cargo size. */
export const UNLOAD_SECONDS = 3
/** Food drained per world-space unit travelled, before reductions. */
export const HUNGER_PER_UNIT = 0.018
/** Fraction of a node's capacity that regenerates per hour. */
export const REGEN_PER_HOUR = 0.55
/** Food restored per unit of provisions eaten. */
export const FOOD_PER_PROVISION = 20
/**
 * What the market pays. Deliveries themselves earn nothing -- goods go into the
 * storehouse and coins come from selling them, which makes every hour of hauling
 * a decision about what to keep. Raw sells at a discount and refined at full
 * value, so refining is worth doing even when all you want is money.
 */
export const RAW_SALE_RATE = 0.6
export const REFINED_SALE_RATE = 1

export function salePrice(id: ResourceId): number {
    const def = RESOURCES[id]
    if (!def) return 0
    return Math.round(def.value * (def.kind === 'raw' ? RAW_SALE_RATE : REFINED_SALE_RATE))
}
/**
 * Offline progress is capped at a day. That is both a performance bound on the
 * catch-up simulation and the reason to open the game daily -- past 24 hours
 * your caravan is idling and you are leaving throughput on the table.
 */
export const MAX_CATCHUP_SECONDS = 24 * 3600
/** Seconds a camp assault takes to resolve once the party arrives. */
export const ASSAULT_SECONDS = 45
