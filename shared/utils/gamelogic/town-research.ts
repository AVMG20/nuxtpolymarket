// Polytown research.
//
// A slow side track that runs while the town does. One project at a time, so
// research never competes with the builders for attention — it is the thing
// still ticking over when every crew is busy and there is nothing to click.
//
// Five branches of six, each branch a straight line: a project needs the one
// before it. Times climb from half a day to three days, so finishing the whole
// board takes roughly two months of always having something running, which is
// the same order as growing a town to the top tiers. Effects are deliberately
// small on their own and worth having in aggregate; nothing here doubles
// anything, because research that outweighs a building would make the town
// itself beside the point.

import type { TownResourceBag } from './town'

export const TOWN_RESEARCH_BRANCHES = ['yield', 'logistics', 'construction', 'civics', 'trade'] as const
export type TownResearchBranchId = typeof TOWN_RESEARCH_BRANCHES[number]

export interface TownResearchBranchDef {
    id: TownResearchBranchId
    name: string
    emoji: string
    description: string
}

export const TOWN_RESEARCH_BRANCH_DEFS: readonly TownResearchBranchDef[] = [
    { id: 'yield', name: 'Yield', emoji: '🌾', description: 'Every workshop makes more of what it makes.' },
    { id: 'logistics', name: 'Logistics', emoji: '🚚', description: 'Suppliers reach further down the road.' },
    { id: 'construction', name: 'Construction', emoji: '🔨', description: 'Builds and upgrades finish sooner.' },
    { id: 'civics', name: 'Civics', emoji: '🏘️', description: 'Homes hold more people and the town is happier.' },
    { id: 'trade', name: 'Trade', emoji: '⚖️', description: 'Better prices at the town hall, and room to store more.' }
]

/**
 * What a finished project changes. Every field is additive across projects and
 * applied once, so the order they are researched in never matters.
 */
export interface TownResearchEffect {
    /** Extra share of output from every workshop, e.g. 0.04 for +4%. */
    output?: number
    /** Extra road tiles a supplier can cover at full rate. */
    supplyTiles?: number
    /** Share taken off every build and upgrade timer. */
    buildTime?: number
    /** Extra residents per house level. */
    popPerHouseLevel?: number
    /** Flat points added to the happiness target. */
    happiness?: number
    /** Extra share of the per-resource storage cap. */
    storage?: number
    /** Extra share on top of the town hall's floor price. */
    floorPrice?: number
}

export interface TownResearchDef {
    id: string
    branch: TownResearchBranchId
    /** 1-based position in its branch. Project N needs project N-1 finished. */
    step: number
    name: string
    description: string
    durationMs: number
    coins: number
    resources: TownResourceBag
    effect: TownResearchEffect
}

const HOUR = 60 * 60_000

/**
 * Hours per step, shared by every branch so the board reads the same left to
 * right. Half a day to start, three days at the end — the same wall a tier-6
 * upgrade hits, because by then a project should feel like a tier-6 decision.
 */
export const TOWN_RESEARCH_STEP_HOURS = [12, 24, 40, 56, 68, 72] as const

/** Coins for step N. Priced to matter early and to be small change by the end. */
const STEP_COINS = [250_000, 2_000_000, 12_000_000, 60_000_000, 250_000_000, 900_000_000]

/** Goods for step N, the same shape for every branch so the board stays legible. */
const STEP_RESOURCES: TownResourceBag[] = [
    { planks: 150, bricks: 100 },
    { planks: 600, bricks: 400, tools: 80 },
    { tools: 400, bricks: 1_200, steel: 60 },
    { steel: 500, tools: 900, machines: 20 },
    { machines: 120, steel: 2_000, tools: 1_500 },
    { machines: 400, luxuries: 25, steel: 5_000 }
]

interface BranchStep {
    name: string
    description: string
    effect: TownResearchEffect
}

const BRANCH_STEPS: Record<TownResearchBranchId, BranchStep[]> = {
    yield: [
        { name: 'Sharper Tools', description: 'Every workshop makes 4% more.', effect: { output: 0.04 } },
        { name: 'Shift Work', description: 'Another 5% out of every workshop.', effect: { output: 0.05 } },
        { name: 'Standard Parts', description: 'Another 5% out of every workshop.', effect: { output: 0.05 } },
        { name: 'Line Production', description: 'Another 6% out of every workshop.', effect: { output: 0.06 } },
        { name: 'Quality Control', description: 'Another 6% out of every workshop.', effect: { output: 0.06 } },
        { name: 'Automation', description: 'Another 8% out of every workshop.', effect: { output: 0.08 } }
    ],
    logistics: [
        { name: 'Cart Tracks', description: 'Suppliers reach one tile further at full rate.', effect: { supplyTiles: 1 } },
        { name: 'Cobbled Roads', description: 'Another tile of full-rate reach.', effect: { supplyTiles: 1 } },
        { name: 'Freight Wagons', description: 'Another tile, and 3% more out of every workshop.', effect: { supplyTiles: 1, output: 0.03 } },
        { name: 'Depots', description: 'Another tile of full-rate reach.', effect: { supplyTiles: 1 } },
        { name: 'Paved Highways', description: 'Another tile, and 3% more out of every workshop.', effect: { supplyTiles: 1, output: 0.03 } },
        { name: 'Dispatch Office', description: 'Two more tiles of full-rate reach.', effect: { supplyTiles: 2 } }
    ],
    construction: [
        { name: 'Scaffolding', description: 'Builds and upgrades finish 4% sooner.', effect: { buildTime: 0.04 } },
        { name: 'Crane Yards', description: 'Another 5% off every timer.', effect: { buildTime: 0.05 } },
        { name: 'Prefab Frames', description: 'Another 5% off every timer.', effect: { buildTime: 0.05 } },
        { name: 'Site Rail', description: 'Another 6% off every timer.', effect: { buildTime: 0.06 } },
        { name: 'Night Shifts', description: 'Another 6% off every timer.', effect: { buildTime: 0.06 } },
        { name: 'Master Guild', description: 'Another 8% off every timer.', effect: { buildTime: 0.08 } }
    ],
    civics: [
        { name: 'Town Charter', description: 'Two points of happiness, for good.', effect: { happiness: 2 } },
        { name: 'Sanitation', description: 'Three more points of happiness.', effect: { happiness: 3 } },
        { name: 'Terraced Housing', description: 'Every house level holds one more resident.', effect: { popPerHouseLevel: 1 } },
        { name: 'Public Schools', description: 'Three more points of happiness.', effect: { happiness: 3 } },
        { name: 'Civic Pride', description: 'Four more points of happiness.', effect: { happiness: 4 } },
        { name: 'Grand Boulevards', description: 'The last four points of happiness the board has to give.', effect: { happiness: 4 } }
    ],
    trade: [
        { name: 'Weights & Measures', description: 'The town hall pays 2% over the floor.', effect: { floorPrice: 0.02 } },
        { name: 'Granaries', description: 'Store 15% more of every good.', effect: { storage: 0.15 } },
        { name: 'Guild Ledgers', description: 'Another 3% over the floor.', effect: { floorPrice: 0.03 } },
        { name: 'Bonded Stores', description: 'Store another 20% of every good.', effect: { storage: 0.2 } },
        { name: 'Trade Charter', description: 'Another 3% over the floor.', effect: { floorPrice: 0.03 } },
        { name: 'Merchant Fleet', description: 'Another 4% over the floor, and 25% more storage.', effect: { floorPrice: 0.04, storage: 0.25 } }
    ]
}

export const TOWN_RESEARCH: readonly TownResearchDef[] = TOWN_RESEARCH_BRANCHES.flatMap(branch =>
    BRANCH_STEPS[branch].map((step, i) => ({
        id: `${branch}-${i + 1}`,
        branch,
        step: i + 1,
        name: step.name,
        description: step.description,
        durationMs: TOWN_RESEARCH_STEP_HOURS[i]! * HOUR,
        coins: STEP_COINS[i]!,
        resources: STEP_RESOURCES[i]!,
        effect: step.effect
    }))
)

const RESEARCH_BY_ID = new Map(TOWN_RESEARCH.map(r => [r.id, r]))

export function getTownResearch(id: string): TownResearchDef | undefined {
    return RESEARCH_BY_ID.get(id)
}

/** The project immediately before `def` in its branch, or null for the first. */
export function townResearchPrerequisite(def: TownResearchDef): TownResearchDef | null {
    return def.step === 1 ? null : RESEARCH_BY_ID.get(`${def.branch}-${def.step - 1}`) ?? null
}

/** Whether `def` can be started given what is already finished. */
export function townResearchUnlocked(def: TownResearchDef, done: readonly string[]): boolean {
    const prev = townResearchPrerequisite(def)
    return prev === null || done.includes(prev.id)
}

/** Everything the finished projects add up to. */
export function townResearchEffects(done: readonly string[]): Required<TownResearchEffect> {
    const total: Required<TownResearchEffect> = {
        output: 0,
        supplyTiles: 0,
        buildTime: 0,
        popPerHouseLevel: 0,
        happiness: 0,
        storage: 0,
        floorPrice: 0
    }
    for (const id of done) {
        const def = RESEARCH_BY_ID.get(id)
        if (!def) continue
        for (const [key, value] of Object.entries(def.effect) as [keyof TownResearchEffect, number][]) {
            total[key] += value
        }
    }
    // Percentages are summed as floats and end up as 0.39999999999999997,
    // which is both ugly on screen and enough to make two orderings of the
    // same set compare unequal. Round once, here, so callers never see it.
    for (const key of Object.keys(total) as (keyof TownResearchEffect)[]) {
        total[key] = Math.round(total[key] * 10_000) / 10_000
    }
    return total
}

/** Real time to finish every project, back to back. */
export function townResearchTotalMs(): number {
    return TOWN_RESEARCH.reduce((ms, r) => ms + r.durationMs, 0)
}
