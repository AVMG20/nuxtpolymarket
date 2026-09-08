import { requireUserId } from '#server/utils/auth'
import { getTownState, settleTownForRead, plotPurchaseInfo, getMyTownOrders, getTownLastPrices, serializeMilestones, getExpansions, getWorldView } from '#server/utils/town'
import {
    TOWN_BUILDINGS,
    TOWN_RESOURCES,
    TOWN_TICK_MS,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MAX_BUILDING_LEVEL,
    townBuildingMaxLevel,
    getTownBuilding,
    TOWN_MAX_PLOTS,
    TOWN_RUSH_MS_PER_GEM,
    TOWN_WELCOME_BACK_MIN_MS,
    TOWN_PARK_RADIUS,
    TOWN_MAX_BUILDERS,
    townBuildersBusy,
    townBuilderGemCost,
    TOWN_PARK_MAX_BONUS,
    TOWN_SUPPLY_FULL_TILES,
    TOWN_SUPPLY_FALLOFF_TILES,
    TOWN_SUPPLY_MIN_EFFICIENCY,
    townSupplyNetwork,
    TOWN_PLOT_REFUND_SHARE,
    townPlotRefundFor,
    TOWN_INDUSTRY_MAX_PENALTY,
    townNeedExpected,
    TOWN_NEEDS,
    deriveTown,
    townFloorIncomePerDay,
    townNetPerTick,
    townTierUnlocked,
    townTierRequirement,
    townLevelCost,
    townLevelBuildMs,
    townPlaceCost,
    townCeilingPrice,
    townMood,
    townNextMood,
    townRoadAccess,
    getTownResource,
    type TownSatisfied
} from '#shared/utils/gamelogic/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const now = Date.now()

    const catalog = TOWN_BUILDINGS.map(def => ({
        ...def,
        levelCost: townLevelCost(def, 1),
        levelBuildMs: townLevelBuildMs(def, 1),
        maxLevel: townBuildingMaxLevel(def)
    }))
    const resources = TOWN_RESOURCES.map(r => ({ ...r, ceilingPrice: townCeilingPrice(r.id) }))
    const constants = {
        tickMs: TOWN_TICK_MS,
        maxOfflineMs: TOWN_MAX_OFFLINE_MS,
        maxLevel: TOWN_MAX_BUILDING_LEVEL,
        maxPlots: TOWN_MAX_PLOTS,
        rushMsPerGem: TOWN_RUSH_MS_PER_GEM,
        parkMaxBonus: TOWN_PARK_MAX_BONUS,
        supplyFullTiles: TOWN_SUPPLY_FULL_TILES,
        supplyFalloffTiles: TOWN_SUPPLY_FALLOFF_TILES,
        supplyMinEfficiency: TOWN_SUPPLY_MIN_EFFICIENCY,
        industryMaxPenalty: TOWN_INDUSTRY_MAX_PENALTY,
        parkRadius: TOWN_PARK_RADIUS,
        maxBuilders: TOWN_MAX_BUILDERS
    }

    const existing = await getTownState(userId)
    if (!existing) {
        return {
            initialized: false as const,
            serverNow: now,
            catalog,
            resources,
            constants
        }
    }

    const [settled, myOrders, lastPrices] = await Promise.all([
        settleTownForRead(userId),
        getMyTownOrders(userId),
        getTownLastPrices()
    ])
    const { state, buildings, plots, sim, inventory } = settled
    const [expansions, world] = await Promise.all([
        getExpansions(userId, plots),
        getWorldView(userId, plots)
    ])

    // One breadth-first pass over the roads serves both derives below.
    const network = townSupplyNetwork(sim, now)
    // Every rate below is derived with the same bonus the settle just paid.
    const derived = deriveTown(sim, state.happiness, now, settled.satisfied, network, settled.research)
    const unlockedTiers = [0, 1, 2, 3, 4, 5, 6].filter(t => townTierUnlocked(sim, t, now, state.produced, settled.research))
    const tierLocks = Object.fromEntries([2, 3, 4, 5, 6].map(t => [t, townTierRequirement(sim, t, now, state.produced, settled.research)]))
    const maxTier = Math.max(...unlockedTiers)

    // The bar's ceiling: what the town would score with every need it could
    // plausibly stock right now supplied, and nothing else changed.
    const reachable: TownSatisfied = {}
    for (const need of TOWN_NEEDS) {
        if (townNeedExpected(need, derived.popCap, derived.reachableTier)) reachable[need.resource] = true
    }
    const happinessPotential = deriveTown(sim, state.happiness, now, reachable, network, settled.research).happinessTarget

    const countsByType: Record<string, number> = {}
    for (const b of sim) countsByType[b.type] = (countsByType[b.type] ?? 0) + 1
    const nextCost = Object.fromEntries(TOWN_BUILDINGS.map(def => [def.id, townPlaceCost(def, countsByType[def.id] ?? 0)]))
    const mood = townMood(state.happiness)
    const nextMood = townNextMood(state.happiness)

    // Only surface the away-summary when the player was actually away and
    // something happened — a 30s poll refresh should not pop a modal.
    const positive = Object.values(settled.delta).some(v => v > 0)
    const welcomeBack = settled.elapsedMs >= TOWN_WELCOME_BACK_MIN_MS && positive
        ? { elapsedMs: settled.elapsedMs, delta: settled.delta }
        : null

    return {
        initialized: true as const,
        serverNow: now,
        catalog,
        resources,
        constants,
        happiness: state.happiness,
        happinessTarget: derived.happinessTarget,
        happinessPotential,
        happinessBreakdown: derived.happinessBreakdown,
        reachableTier: derived.reachableTier,
        mood: { id: mood.id, name: mood.name, emoji: mood.emoji, speed: mood.speed, buildTime: mood.buildTime, storage: mood.storage },
        nextMood: nextMood ? { id: nextMood.id, name: nextMood.name, emoji: nextMood.emoji, min: nextMood.min, speed: nextMood.speed, buildTime: nextMood.buildTime, storage: nextMood.storage } : null,
        speedMultiplier: derived.speedMultiplier,
        countsByType,
        nextCost,
        tierLocks,
        produced: state.produced,
        popCap: derived.popCap,
        workersDemanded: derived.workersDemanded,
        workersEmployed: derived.workersEmployed,
        storageCap: derived.storageCap,
        needs: TOWN_NEEDS.map(n => ({
            resource: n.resource,
            name: n.name,
            description: n.description,
            perTick: derived.needsPerTick[n.resource] ?? 0,
            minPop: n.minPop,
            active: derived.needsPerTick[n.resource] !== undefined,
            happiness: n.happiness,
            food: n.food,
            satisfied: settled.satisfied[n.resource] ?? false,
            stock: inventory[n.resource] ?? 0,
            resourceTier: getTownResource(n.resource)?.tier ?? 1,
            /** Counted on the scorecard: big enough town, and a tier that can stock it. */
            expected: townNeedExpected(n, derived.popCap, derived.reachableTier),
            producible: (getTownResource(n.resource)?.tier ?? 1) <= maxTier
        })),
        floorIncomePerDay: townFloorIncomePerDay(sim, state.happiness, now, settled.research),
        netPerTick: townNetPerTick(sim, derived, now),
        tickProgressMs: state.tickProgressMs,
        lastSettledAt: state.lastSettledAt.getTime(),
        coinsEarned: parseFloat(state.coinsEarned),
        unlockedTiers,
        plots: plots.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            listPrice: p.listPrice === null ? null : parseFloat(p.listPrice),
            refund: townPlotRefundFor(parseFloat(p.paidPrice))
        })),
        world,
        plotRefundShare: TOWN_PLOT_REFUND_SHARE,
        builders: {
            owned: state.builders,
            busy: townBuildersBusy(settled.sim, now),
            nextGemCost: townBuilderGemCost(state.builders)
        },
        plotPurchase: plotPurchaseInfo(state, now, plots.length),
        expansions,
        buildings: buildings.map(b => ({
            id: b.id,
            plotId: b.plotId,
            type: b.type,
            tileX: b.tileX,
            tileY: b.tileY,
            rotation: b.rotation,
            level: b.level,
            upgradingTo: b.upgradingTo,
            completesAt: b.completesAt.getTime(),
            createdAt: b.createdAt.getTime(),
            staffing: derived.staffing.get(b.id) ?? null,
            supply: derived.supply.get(b.id) ?? null,
            throughput: derived.throughput.get(b.id) ?? null,
            connected: townRoadAccess(sim, sim.find(x => x.id === b.id)!),
            // Durations come from the server, because only the server knows
            // this town's mood and research. A client that recomputed them
            // would draw a progress bar that disagrees with its own clock.
            jobMs: b.level === 0 || b.upgradingTo !== null
                ? townLevelBuildMs(getTownBuilding(b.type)!, b.upgradingTo ?? 1, state.happiness, settled.research)
                : null,
            nextUpgradeMs: b.level > 0 && b.level < townBuildingMaxLevel(getTownBuilding(b.type)!)
                ? townLevelBuildMs(getTownBuilding(b.type)!, b.level + 1, state.happiness, settled.research)
                : null
        })),
        inventory,
        myOrders,
        lastPrices,
        milestones: serializeMilestones(settled, now),
        welcomeBack
    }
})
