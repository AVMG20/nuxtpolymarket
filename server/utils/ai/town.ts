import {
    getTownBuilding,
    getTownResource,
    isTownResourceId,
    TOWN_MAX_BUILDERS,
    TOWN_RESOURCES,
    townBuildingMaxLevel,
    townLevelCost,
    townResourceSoldByDefault,
    type TownResourceBag
} from '#shared/utils/gamelogic/town'

// Pure planning for the Polytown AI tools. The town endpoints stay the
// authority on what a builder can start and what a sale pays; these helpers
// only decide what to ask them for, so they can be unit-tested without a town.

/** The slice of /api/town/state a plan needs. */
export interface TownBuildingSnapshot {
    id: string
    type: string
    level: number
    upgradingTo: number | null
    connected: boolean
}

export interface TownUpgradeCandidate {
    buildingId: string
    type: string
    name: string
    level: number
    nextLevel: number
    cost: { coins: number, resources: TownResourceBag }
}

export interface TownUpgradeOptions {
    /** Building types to consider before every other type. */
    preferTypes?: string[]
    /** Upper bound on the candidates returned. Defaults to every idle builder the game allows. */
    limit?: number
}

/**
 * Buildings an idle builder could upgrade right now, cheapest-to-grow first:
 * lowest level, then lowest coin cost. A building that is still going up, mid-
 * upgrade, maxed, a road, or cut off from the road network is skipped, since
 * an upgrade there either fails or does nothing for the town.
 */
export function townUpgradeCandidates(buildings: TownBuildingSnapshot[], options: TownUpgradeOptions = {}): TownUpgradeCandidate[] {
    const preferred = new Map((options.preferTypes ?? []).map((type, index) => [type, index]))
    const candidates: TownUpgradeCandidate[] = []
    for (const building of buildings) {
        const def = getTownBuilding(building.type)
        if (!def || def.kind === 'road') continue
        if (building.level < 1 || building.upgradingTo !== null || !building.connected) continue
        if (building.level >= townBuildingMaxLevel(def)) continue
        const nextLevel = building.level + 1
        candidates.push({
            buildingId: building.id,
            type: def.id,
            name: def.name,
            level: building.level,
            nextLevel,
            cost: townLevelCost(def, nextLevel)
        })
    }
    const rank = (candidate: TownUpgradeCandidate) => preferred.get(candidate.type) ?? preferred.size
    candidates.sort((left, right) =>
        rank(left) - rank(right)
        || left.level - right.level
        || left.cost.coins - right.cost.coins
        || left.buildingId.localeCompare(right.buildingId)
    )
    return candidates.slice(0, options.limit ?? TOWN_MAX_BUILDERS)
}

export interface TownSaleOptions {
    /** Share of each resource's stock to sell, 1 to 100. */
    percent: number
    /** Resource ids to sell. Every stocked resource when omitted. */
    resources?: string[]
    /** Stock of each resource to keep after the sale. */
    keepQuantity?: number
}

export interface TownSaleLine {
    resource: string
    name: string
    stock: number
    quantity: number
    floorPrice: number
    floorValue: number
}

/**
 * Which units to put on the market. `percent` is applied per resource and
 * rounded down; `keepQuantity` then caps the sale so at least that much stays.
 * Resources with nothing to sell are left out.
 */
export function planTownSale(inventory: Record<string, number>, options: TownSaleOptions): TownSaleLine[] {
    const percent = Number(options.percent)
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
        throw createError({ statusCode: 400, statusMessage: 'percent must be from 1 to 100' })
    }
    const keep = options.keepQuantity == null ? 0 : Number(options.keepQuantity)
    if (!Number.isInteger(keep) || keep < 0) {
        throw createError({ statusCode: 400, statusMessage: 'keepQuantity must be a whole number of 0 or more' })
    }
    // Jewels are usually kept to convert into gems, so a blanket sale skips
    // them; naming them explicitly still sells them.
    const requested = options.resources ?? TOWN_RESOURCES.filter(resource => townResourceSoldByDefault(resource.id)).map(resource => resource.id)
    if (!Array.isArray(requested) || !requested.length) {
        throw createError({ statusCode: 400, statusMessage: 'Choose at least one Polytown resource' })
    }

    const lines: TownSaleLine[] = []
    for (const id of new Set(requested)) {
        if (typeof id !== 'string' || !isTownResourceId(id)) {
            throw createError({ statusCode: 400, statusMessage: `Unknown Polytown resource: ${String(id)}` })
        }
        const stock = Math.floor(inventory[id] ?? 0)
        const quantity = Math.min(Math.floor(stock * percent / 100), Math.max(0, stock - keep))
        if (quantity < 1) continue
        const resource = getTownResource(id)!
        lines.push({
            resource: id,
            name: resource.name,
            stock,
            quantity,
            floorPrice: resource.floorPrice,
            floorValue: quantity * resource.floorPrice
        })
    }
    return lines
}
