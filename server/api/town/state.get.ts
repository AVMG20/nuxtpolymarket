import { requireUserId } from '#server/utils/auth'
import { getTownState, settleTownForRead, plotPurchaseInfo, getMyTownOrders, getTownLastPrices, serializeMilestones, getExpansions } from '#server/utils/town'
import {
    TOWN_BUILDINGS,
    TOWN_RESOURCES,
    TOWN_TICK_MS,
    TOWN_MAX_OFFLINE_MS,
    TOWN_MAX_BUILDING_LEVEL,
    TOWN_MAX_PLOTS,
    TOWN_RUSH_MS_PER_GEM,
    TOWN_WELCOME_BACK_MIN_MS,
    TOWN_HAPPINESS_PARK_NEARBY,
    TOWN_HAPPINESS_INDUSTRY_ADJACENT,
    TOWN_PARK_RADIUS,
    TOWN_INDUSTRY_RADIUS,
    TOWN_NEEDS,
    deriveTown,
    townFloorIncomePerDay,
    townNetPerTick,
    townTierUnlocked,
    townLevelCost,
    townLevelBuildMs,
    townCeilingPrice
} from '#shared/utils/gamelogic/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const now = Date.now()

    const catalog = TOWN_BUILDINGS.map(def => ({
        ...def,
        levelCost: townLevelCost(def, 1),
        levelBuildMs: townLevelBuildMs(def, 1)
    }))
    const resources = TOWN_RESOURCES.map(r => ({ ...r, ceilingPrice: townCeilingPrice(r.id) }))
    const constants = {
        tickMs: TOWN_TICK_MS,
        maxOfflineMs: TOWN_MAX_OFFLINE_MS,
        maxLevel: TOWN_MAX_BUILDING_LEVEL,
        maxPlots: TOWN_MAX_PLOTS,
        rushMsPerGem: TOWN_RUSH_MS_PER_GEM,
        parkAdjacent: TOWN_HAPPINESS_PARK_NEARBY,
        industryAdjacent: TOWN_HAPPINESS_INDUSTRY_ADJACENT,
        parkRadius: TOWN_PARK_RADIUS,
        industryRadius: TOWN_INDUSTRY_RADIUS
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
    const expansions = await getExpansions(userId, plots)

    const derived = deriveTown(sim, state.happiness, now, settled.satisfied)
    const unlockedTiers = [0, 1, 2, 3, 4, 5, 6].filter(t => townTierUnlocked(sim, t, now))

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
        speedMultiplier: derived.speedMultiplier,
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
            stock: inventory[n.resource] ?? 0
        })),
        floorIncomePerDay: townFloorIncomePerDay(sim, state.happiness, now),
        netPerTick: townNetPerTick(sim, derived, now),
        tickProgressMs: state.tickProgressMs,
        lastSettledAt: state.lastSettledAt.getTime(),
        coinsEarned: parseFloat(state.coinsEarned),
        unlockedTiers,
        plots: plots.map(p => ({ id: p.id, x: p.x, y: p.y })),
        plotPurchase: plotPurchaseInfo(state, now),
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
            staffing: derived.staffing.get(b.id) ?? null
        })),
        inventory,
        myOrders,
        lastPrices,
        milestones: serializeMilestones(settled, now),
        welcomeBack
    }
})
