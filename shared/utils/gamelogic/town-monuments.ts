// Polytown monuments.
//
// Five wonders of the world, each built once and raised stage by stage. A
// monument is a building like any other — it stands on the map, needs a road
// at its front, and grows on a timer — but it is several tiles wide, it never
// makes anything, and what it gives is town-wide: every stage adds a perk the
// whole town feels. It is the long sink of the late game, so the stages climb
// from a first-week purchase to a price that makes a maxed Emporium look
// cheap, and the perks at the top are a little better than the old research
// board ever gave.
//
// Monuments are raised by their own crew, one stage at a time across all five,
// so they never take a builder away from the town itself.

import type { TownBonus, TownResourceBag } from './town'

export const TOWN_MONUMENT_IDS = ['pyramid', 'colosseum', 'lighthouse', 'arc', 'eiffel'] as const
export type TownMonumentId = typeof TOWN_MONUMENT_IDS[number]

/** Stages a monument has. The last one finishes it. */
export const TOWN_MONUMENT_STAGES = 8

const HOUR = 60 * 60_000

/** Hours per stage, the same for every monument. The last two sit at the three-day wall. */
export const TOWN_MONUMENT_STAGE_HOURS = [8, 16, 24, 36, 48, 60, 72, 72] as const

/** Coins per stage, the same for every monument. */
const STAGE_COINS = [1_000_000, 6_000_000, 30_000_000, 120_000_000, 400_000_000, 1_000_000_000, 2_500_000_000, 5_000_000_000]

/**
 * Goods every monument asks for at each stage, climbing the chain the way the
 * upgrade bands do: bricks first, then tools, steel, machines and luxuries.
 * Each monument adds its own building material on top (see `material`).
 */
const STAGE_GOODS: TownResourceBag[] = [
    { planks: 300, bricks: 200 },
    { planks: 1_200, bricks: 1_000, tools: 150 },
    { bricks: 3_000, tools: 800, steel: 150 },
    { steel: 1_200, tools: 2_000, machines: 40 },
    { machines: 250, steel: 4_000, tools: 3_500 },
    { machines: 700, steel: 9_000, luxuries: 20 },
    { machines: 1_500, steel: 15_000, luxuries: 80 },
    { machines: 3_000, steel: 25_000, luxuries: 250 }
]

/** How much more of its own material a monument wants per stage. */
const MATERIAL_GROWTH = 1.6

export interface TownMonumentDef {
    id: TownMonumentId
    name: string
    emoji: string
    /** Tiles per side. A monument is always square, so turning it only moves its door. */
    size: number
    /** Tier the town must have unlocked to break ground. */
    tier: number
    /** The research branch this monument replaced; see TOWN_MONUMENTS. */
    branch: 'yield' | 'logistics' | 'construction' | 'civics' | 'trade'
    /** One line on what the finished monument does. */
    perk: string
    /** The monument's own building material at stage 1, grown by MATERIAL_GROWTH per stage. */
    material: TownResourceBag
    /** What each stage adds, in order. Summed up to the stage the monument stands at. */
    stages: Partial<TownBonus>[]
}

/*
 * Each monument took over one branch of the old research board, and its first
 * six stages give exactly what that branch's six projects gave, in the same
 * order. A mayor who had researched three Civics projects is credited the
 * Colosseum at stage 3 (see town_state.monument_credit) and loses nothing:
 * the resident per house level that project three gave is stage three here.
 * Stages 7 and 8 are new, and are what makes a monument worth more than the
 * board ever was.
 */
export const TOWN_MONUMENTS: readonly TownMonumentDef[] = [
    {
        id: 'pyramid',
        name: 'Great Pyramid',
        emoji: '🔺',
        size: 3,
        tier: 2,
        branch: 'construction',
        perk: 'Builds and upgrades finish sooner.',
        material: { stone: 1_500 },
        stages: [0.04, 0.05, 0.05, 0.06, 0.06, 0.08, 0.02, 0.02].map(buildTime => ({ buildTime }))
    },
    {
        id: 'colosseum',
        name: 'Colosseum',
        emoji: '🏟️',
        size: 3,
        tier: 2,
        branch: 'civics',
        perk: 'The whole town is happier, and from stage 3 every house level holds one more resident.',
        material: { bricks: 500 },
        stages: [{ happiness: 2 }, { happiness: 3 }, { popPerHouseLevel: 1 }, { happiness: 3 }, { happiness: 4 }, { happiness: 4 }, { happiness: 1 }, { happiness: 1 }]
    },
    {
        id: 'lighthouse',
        name: 'Lighthouse of Alexandria',
        emoji: '⚓',
        size: 2,
        tier: 3,
        branch: 'trade',
        perk: 'Store more of every good, and workshops waste a little less.',
        material: { planks: 600 },
        stages: [{ storage: 0.15 }, { storage: 0.2 }, { storage: 0.25, output: 0.02 }, { storage: 0.3 }, { storage: 0.35, output: 0.03 }, { storage: 0.45 }, { storage: 0.1 }, { storage: 0.1 }]
    },
    {
        id: 'arc',
        name: 'Arc de Triomphe',
        emoji: '🏛️',
        size: 2,
        tier: 3,
        branch: 'logistics',
        perk: 'Suppliers reach further at full rate, and workshops make a little more.',
        material: { stone: 1_000 },
        stages: [{ supplyTiles: 1 }, { supplyTiles: 1 }, { supplyTiles: 1, output: 0.03 }, { supplyTiles: 1 }, { supplyTiles: 1, output: 0.03 }, { supplyTiles: 2 }, { supplyTiles: 1 }, { supplyTiles: 1 }]
    },
    {
        id: 'eiffel',
        name: 'Eiffel Tower',
        emoji: '🗼',
        size: 2,
        tier: 4,
        branch: 'yield',
        perk: 'Every workshop makes more.',
        material: { steel: 150 },
        stages: [0.04, 0.05, 0.05, 0.06, 0.06, 0.08, 0.02, 0.03].map(output => ({ output }))
    }
]

const MONUMENT_BY_ID = new Map(TOWN_MONUMENTS.map(m => [m.id, m]))

export function getTownMonument(id: string): TownMonumentDef | undefined {
    return MONUMENT_BY_ID.get(id as TownMonumentId)
}

export function isTownMonumentId(id: string): id is TownMonumentId {
    return MONUMENT_BY_ID.has(id as TownMonumentId)
}

/** Coins and goods to raise `def` to `stage` (1-based; stage 1 is breaking ground). */
export function townMonumentStageCost(def: TownMonumentDef, stage: number): { coins: number, resources: TownResourceBag } {
    const i = Math.max(1, Math.min(TOWN_MONUMENT_STAGES, stage)) - 1
    const resources: TownResourceBag = { ...STAGE_GOODS[i]! }
    const scale = Math.pow(MATERIAL_GROWTH, i)
    for (const [id, qty] of Object.entries(def.material) as [keyof TownResourceBag, number][]) {
        resources[id] = (resources[id] ?? 0) + Math.round(qty * scale)
    }
    return { coins: STAGE_COINS[i]!, resources }
}

/** Real time a stage takes before any perk shortens it. */
export function townMonumentStageMs(stage: number): number {
    const i = Math.max(1, Math.min(TOWN_MONUMENT_STAGES, stage)) - 1
    return TOWN_MONUMENT_STAGE_HOURS[i]! * HOUR
}

const BONUS_LABELS: Record<keyof TownBonus, string> = {
    output: 'workshop output',
    supplyTiles: 'full-rate supply tiles',
    buildTime: 'build time',
    popPerHouseLevel: 'residents per house level',
    happiness: 'happiness',
    storage: 'storage'
}

/** One perk's size as it reads on screen: "+12%", "−38%", "+3". */
export function townBonusValue(key: keyof TownBonus, n: number): string {
    const rounded = Math.round(n * 10_000) / 10_000
    if (key === 'buildTime') return `−${Math.round(rounded * 100)}%`
    if (key === 'output' || key === 'storage') return `+${Math.round(rounded * 100)}%`
    return `+${rounded}`
}

/** What a perk is called: "workshop output". */
export function townBonusLabel(key: keyof TownBonus): string {
    return BONUS_LABELS[key]
}

/** A bonus in words, one line per perk it carries: "+12% workshop output". */
export function townBonusLines(bonus: Partial<TownBonus>): string[] {
    return (Object.entries(bonus) as [keyof TownBonus, number][])
        .filter(([, n]) => n > 0)
        .map(([key, n]) => `${townBonusValue(key, n)} ${BONUS_LABELS[key]}`)
}

/** What `def` gives once `stage` stages stand. */
export function townMonumentEffect(def: TownMonumentDef, stage: number): Partial<TownBonus> {
    const total: Partial<TownBonus> = {}
    for (const step of def.stages.slice(0, Math.max(0, stage))) {
        for (const [key, value] of Object.entries(step) as [keyof TownBonus, number][]) {
            total[key] = (total[key] ?? 0) + value
        }
    }
    return total
}
