import type { H3Event } from 'h3'
import { MIN_DEPLOY_SUCCESS, opSuccessChance } from '#shared/utils/hack-config'
import { ARTIFACT_TYPES, effectiveGrowTime, getPlant, MUTATIONS, PLANT_TYPES } from '#shared/utils/xeno'
import { AI_CASINO_MAX_BET, AI_MAX_ROUNDS, BANK_MAX_AMOUNT } from '#shared/utils/limits'
import type { AiToolCall } from '#shared/utils/ai'
import { playCasinoRounds, playNamedCasinoRounds } from './casino'
import { getErrorMessage, toolHeaders } from './helpers'

interface XenoStack {
    typeId: string
    speed: number
    yield: number
    quantity: number
}

interface XenoSlot {
    id: string
    plant: null | (XenoStack & { completesAt: string, name: string })
    artifact?: { typeId: string } | null
}

interface XenoState {
    initialized: boolean
    inventory: XenoStack[]
    highestTier: number
    grid: { slots: XenoSlot[], unlockedCount: number }
}

interface HackOp {
    id: string
    templateId: string
    agentIds: string[]
    completesAt: string
    done: boolean
}

interface HackState {
    totalPower: number
    activeOps: HackOp[]
    agents: Array<{ id: string, name: string, power: number, onOp: boolean }>
    opTemplates: Array<{
        id: string
        name: string
        minAgents: number
        maxAgents: number
        minPower: number
        durationMs: number
        baseCash: [number, number]
        effectiveSuccessChance: number
    }>
}

interface ColonyState {
    initialized: boolean
    nutrition: number
    gemNutrition: number
    nutritionMax: number
    nutritionDrainPerHour: number
    feedCost: number
    gemFeedCost: number
    habitatLevel: number
    habitatLevelUpCost: number | null
    habitatLevelUpGemCost: number | null
    pendingLoot: Array<{ name: string, quantity: number }>
    bugs: Array<{ name: string, itemsPerHour: number, itemSellValue: number, feedPerHour: number }>
    inventory: Array<{ id: string, name: string, quantity: number, sellValue: number }>
    upgrades: Array<{
        id: string
        name: string
        description: string
        level: number
        maxLevel: number
        atMax: boolean
        currentEffect: string
        nextEffect: string | null
        nextCost: { coins?: number, gems?: number } | null
        nextDurationMs: number | null
        requiredLevel: number
        meetsHabitatRequirement: boolean
    }>
    research: Array<{
        typeId: string
        name: string
        level: number
        maxLevel: number
        atMax: boolean
        nextSpeedRange: [number, number] | null
        nextYieldRange: [number, number] | null
        cost: unknown
    }>
    builder: { kind: 'track' | 'habitat', trackName: string, completesAt: string } | null
}

interface MinerState {
    walletBalance: number
    rigLevel: number
    rigMaxLevel: number
    rigUpgradeCost: number
    vaultLevel: number
    vaultMaxLevel: number
    vaultUpgradeCost: number
    factoryLevel: number
    factoryMaxLevel: number
    factoryUpgradeCost: number
    pendingCash: number
    pendingGems: number
    income: number
    cap: number
    rate: number
    gemCap: number
    gems: number
    lootboxSlots: number
    lootboxMaxSlots: number
    lootboxNextSlotCost: number
    lootboxFreeOpensRemaining: number
    overclockLevel: number
    overclockMaxLevel: number
    overclockNextCost: number | null
    catalystLevel: number
    catalystMaxLevel: number
    catalystNextCost: number | null
    incomeMultiplier: number
    gemRateMultiplier: number
    gemPrice: number
    lootboxAvgValue: number
    lootboxOpenPrice: number
}

interface GemExchangeState {
    guidePrice: number
    bestBid: number | null
    bestAsk: number | null
    userGems: number | null
}

function parseArguments(raw: string): Record<string, unknown> {
    try {
        const value = JSON.parse(raw) as unknown
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'The assistant produced invalid tool arguments' })
    }
}

async function getOverview(event: H3Event) {
    const headers = toolHeaders(event)
    const [xeno, colony, hack, miner, gemExchange] = await Promise.all([
        event.$fetch<XenoState>('/api/xeno/state', { headers }),
        event.$fetch<ColonyState>('/api/colony/state', { headers }),
        event.$fetch<HackState>('/api/hack/state', { headers }),
        event.$fetch<MinerState>('/api/miner/state', { headers }),
        event.$fetch<GemExchangeState>('/api/gem-exchange/state', { headers })
    ])

    const colonyCoinsPerHour = colony.bugs.reduce((sum, bug) => sum + bug.itemsPerHour * bug.itemSellValue, 0)
    const starvationHours = colony.nutritionDrainPerHour > 0
        ? (colony.nutrition + colony.gemNutrition) / colony.nutritionDrainPerHour
        : null

    return {
        xeno: {
            initialized: xeno.initialized,
            highestTier: xeno.highestTier,
            gridSlots: xeno.grid.unlockedCount,
            readySlots: xeno.grid.slots.filter(slot => slot.plant && Date.parse(slot.plant.completesAt) <= Date.now()).length,
            emptySlots: xeno.grid.slots.filter(slot => !slot.plant).length,
            inventory: xeno.inventory.map(stack => {
                const plant = getPlant(stack.typeId)
                return {
                    ...stack,
                    name: plant?.name ?? stack.typeId,
                    tier: plant?.tier ?? null,
                    sellValue: plant?.value ?? null,
                    expectedCoinsPerHour: plant
                        ? plant.value * (1 + stack.yield / 2) * 3600 / effectiveGrowTime({ baseTime: plant.baseTime, speed: stack.speed })
                        : null
                }
            })
        },
        colony: {
            initialized: colony.initialized,
            nutrition: colony.nutrition,
            gemNutrition: colony.gemNutrition,
            nutritionMax: colony.nutritionMax,
            feedCostCoins: colony.feedCost,
            feedCostGems: colony.gemFeedCost,
            habitat: {
                level: colony.habitatLevel,
                nextCoinCost: colony.habitatLevelUpCost,
                nextGemCost: colony.habitatLevelUpGemCost
            },
            estimatedCoinsPerHour: colonyCoinsPerHour,
            estimatedHoursUntilStarving: starvationHours,
            pendingLoot: colony.pendingLoot,
            inventory: colony.inventory,
            builder: colony.builder,
            upgrades: colony.upgrades,
            research: colony.research,
            placedBugs: colony.bugs.map(bug => ({
                name: bug.name,
                itemsPerHour: bug.itemsPerHour,
                itemSellValue: bug.itemSellValue,
                feedPerHour: bug.feedPerHour
            }))
        },
        hackOps: {
            totalPower: hack.totalPower,
            completedOps: hack.activeOps.filter(op => op.done).length,
            activeOps: hack.activeOps,
            freeAgents: hack.agents.filter(agent => !agent.onOp),
            missionTemplates: hack.opTemplates
        },
        miner: {
            walletCoins: miner.walletBalance,
            rig: {
                level: miner.rigLevel,
                maxLevel: miner.rigMaxLevel,
                incomePerDay: miner.income,
                pendingCoins: miner.pendingCash,
                storageCapCoins: miner.cap,
                nextUpgradeCostCoins: miner.rigUpgradeCost
            },
            vault: {
                level: miner.vaultLevel,
                maxLevel: miner.vaultMaxLevel,
                storageCapCoins: miner.cap,
                nextUpgradeCostCoins: miner.vaultUpgradeCost
            },
            factory: {
                level: miner.factoryLevel,
                maxLevel: miner.factoryMaxLevel,
                gemsPerDay: miner.rate,
                pendingGems: miner.pendingGems,
                storageCapGems: miner.gemCap,
                nextUpgradeCostCoins: miner.factoryUpgradeCost
            },
            overclock: {
                level: miner.overclockLevel,
                maxLevel: miner.overclockMaxLevel,
                rigAndLootboxCashMultiplier: miner.incomeMultiplier,
                nextUpgradeCostGems: miner.overclockNextCost
            },
            catalyst: {
                level: miner.catalystLevel,
                maxLevel: miner.catalystMaxLevel,
                factoryRateMultiplier: miner.gemRateMultiplier,
                nextUpgradeCostGems: miner.catalystNextCost
            },
            lootboxes: {
                slots: miner.lootboxSlots,
                maxSlots: miner.lootboxMaxSlots,
                freeOpensRemainingToday: miner.lootboxFreeOpensRemaining,
                nextSlotCostCoins: miner.lootboxNextSlotCost,
                expectedValueCoins: miner.lootboxAvgValue,
                paidOpenCostCoins: miner.lootboxOpenPrice,
                liveGemPriceCoins: miner.gemPrice
            },
            gems: miner.gems
        },
        gemExchange: {
            guidePrice: gemExchange.guidePrice,
            bestBuyOffer: gemExchange.bestBid,
            bestSellOffer: gemExchange.bestAsk,
            userGems: gemExchange.userGems
        }
    }
}

async function runXenoDailies(event: H3Event, keepPerPlantType: number) {
    const headers = toolHeaders(event)
    const initial = await event.$fetch<XenoState>('/api/xeno/state', { headers })
    const ready = initial.grid.slots.filter((slot): slot is XenoSlot & { plant: NonNullable<XenoSlot['plant']> } =>
        Boolean(slot.plant && Date.parse(slot.plant.completesAt) <= Date.now())
    )
    const harvested: Array<{ slotId: string, result: unknown }> = []

    for (const slot of ready) {
        const result = await event.$fetch('/api/xeno/grid/harvest', {
            method: 'POST',
            headers,
            body: { slotId: slot.id }
        })
        harvested.push({ slotId: slot.id, result })
    }

    const harvestedStacks = [...new Map(ready.map(slot => [
        `${slot.plant.typeId}:${slot.plant.speed}:${slot.plant.yield}`,
        { typeId: slot.plant.typeId, speed: slot.plant.speed, yield: slot.plant.yield }
    ])).values()]
    const replanted: unknown[] = []
    for (const stack of harvestedStacks) {
        replanted.push(await event.$fetch('/api/xeno/grid/plant-all', {
            method: 'POST',
            headers,
            body: stack
        }))
    }

    const afterPlanting = await event.$fetch<XenoState>('/api/xeno/state', { headers })
    const byType = new Map<string, XenoStack[]>()
    for (const stack of afterPlanting.inventory) {
        const entries = byType.get(stack.typeId) ?? []
        entries.push(stack)
        byType.set(stack.typeId, entries)
    }

    const sold: Array<{ typeId: string, speed: number, yield: number, quantity: number, result: unknown }> = []
    for (const [typeId, stacks] of byType) {
        let keepRemaining = keepPerPlantType
        stacks.sort((a, b) => (b.speed + b.yield) - (a.speed + a.yield))
        for (const stack of stacks) {
            const retained = Math.min(keepRemaining, stack.quantity)
            keepRemaining -= retained
            const quantity = stack.quantity - retained
            if (quantity <= 0) continue
            const result = await event.$fetch('/api/xeno/market/sell', {
                method: 'POST',
                headers,
                body: { typeId, speed: stack.speed, yield: stack.yield, quantity }
            })
            sold.push({ typeId, speed: stack.speed, yield: stack.yield, quantity, result })
        }
    }

    return { harvested, replanted, sold, keptPerPlantType: keepPerPlantType }
}

function getXenoRecipes(args: Record<string, unknown>) {
    const kind = args.kind === 'artifacts' || args.kind === 'breeding' ? args.kind : 'all'
    const artifactId = typeof args.artifactId === 'string' ? args.artifactId : null
    const targetPlantId = typeof args.targetPlantId === 'string' ? args.targetPlantId : null

    if (artifactId && !ARTIFACT_TYPES.some(artifact => artifact.id === artifactId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Xeno artifact' })
    }
    if (targetPlantId && !getPlant(targetPlantId)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Xeno plant' })
    }

    const artifacts = ARTIFACT_TYPES
        .filter(artifact => !artifactId || artifact.id === artifactId)
        .map(artifact => ({
            id: artifact.id,
            name: artifact.name,
            description: artifact.description,
            costs: artifact.cost.map(cost => ({
                typeId: cost.plantTypeId,
                name: getPlant(cost.plantTypeId)?.name ?? cost.plantTypeId,
                quantity: cost.quantity
            }))
        }))
    const breeding = MUTATIONS
        .filter(recipe => !targetPlantId || recipe.offspring === targetPlantId)
        .map(recipe => ({
            parent1: { typeId: recipe.parent1, name: getPlant(recipe.parent1)?.name ?? recipe.parent1 },
            parent2: { typeId: recipe.parent2, name: getPlant(recipe.parent2)?.name ?? recipe.parent2 },
            offspring: { typeId: recipe.offspring, name: getPlant(recipe.offspring)?.name ?? recipe.offspring },
            baseMutationChance: recipe.chance
        }))

    return {
        plants: artifactId || targetPlantId
            ? undefined
            : PLANT_TYPES.map(plant => ({
                typeId: plant.id, name: plant.name, tier: plant.tier, value: plant.value
            })),
        ...(kind !== 'breeding' ? { artifacts } : {}),
        ...(kind !== 'artifacts' ? { breeding, breedingAvailable: false } : {})
    }
}

function xenoStackValue(stack: XenoStack) {
    const plant = getPlant(stack.typeId)
    if (!plant) return -1
    return plant.value * (1 + stack.yield / 2) / effectiveGrowTime({ baseTime: plant.baseTime, speed: stack.speed })
}

async function manageXenoGarden(event: H3Event, args: Record<string, unknown>) {
    const requested = Array.isArray(args.requestedPlants) ? args.requestedPlants : []
    const requestedPlants = new Map<string, number>()
    for (const entry of requested) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw createError({ statusCode: 400, statusMessage: 'Each requested Xeno plant needs a typeId and quantity' })
        }
        const { typeId, quantity } = entry as Record<string, unknown>
        const amount = Number(quantity)
        if (typeof typeId !== 'string' || !getPlant(typeId) || !Number.isInteger(amount) || amount < 1 || amount > 40) {
            throw createError({ statusCode: 400, statusMessage: 'Requested Xeno plants must use a known type ID and a quantity from 1 to 40' })
        }
        requestedPlants.set(typeId, (requestedPlants.get(typeId) ?? 0) + amount)
    }
    if (!requestedPlants.size) throw createError({ statusCode: 400, statusMessage: 'Choose at least one Xeno plant to prioritize' })

    const headers = toolHeaders(event)
    let state = await event.$fetch<XenoState>('/api/xeno/state', { headers })
    const ready = state.grid.slots.filter((slot): slot is XenoSlot & { plant: NonNullable<XenoSlot['plant']> } =>
        Boolean(slot.plant && Date.parse(slot.plant.completesAt) <= Date.now())
    )
    if (args.harvestReady === true) {
        for (const slot of ready) {
            await event.$fetch('/api/xeno/grid/harvest', { method: 'POST', headers, body: { slotId: slot.id } })
        }
        state = await event.$fetch<XenoState>('/api/xeno/state', { headers })
    }

    const inventory = state.inventory.map(stack => ({ ...stack }))
    const slots = state.grid.slots.filter(slot => !slot.plant)
    const canPlantInSlot = (slot: XenoSlot, stack: XenoStack) => {
        const plant = getPlant(stack.typeId)
        if (!plant?.voidPlant) return true
        const artifact = slot.artifact ? ARTIFACT_TYPES.find(item => item.id === slot.artifact?.typeId) : null
        return (artifact?.level ?? 0) >= 2
    }
    const takeStack = (slot: XenoSlot, typeId?: string) => inventory
        .filter(stack => stack.quantity > 0 && (!typeId || stack.typeId === typeId) && canPlantInSlot(slot, stack))
        .sort((a, b) => xenoStackValue(b) - xenoStackValue(a))[0]
    const planted: Array<{ slotId: string, typeId: string }> = []
    const unavailableRequested: Array<{ typeId: string, requested: number, planted: number }> = []

    for (const [typeId, requestedQuantity] of requestedPlants) {
        let plantedCount = 0
        while (slots.length && plantedCount < requestedQuantity) {
            const slotIndex = slots.findIndex(slot => Boolean(takeStack(slot, typeId)))
            if (slotIndex < 0) break
            const slot = slots.splice(slotIndex, 1)[0]!
            const stack = takeStack(slot, typeId)!
            await event.$fetch('/api/xeno/grid/plant', {
                method: 'POST', headers, body: { slotId: slot.id, typeId: stack.typeId, speed: stack.speed, yield: stack.yield }
            })
            stack.quantity--
            plantedCount++
            planted.push({ slotId: slot.id, typeId })
        }
        if (plantedCount < requestedQuantity) unavailableRequested.push({ typeId, requested: requestedQuantity, planted: plantedCount })
    }

    let fillerPlanted = 0
    if (args.fillRemaining !== false) {
        while (slots.length) {
            let candidate: { slotIndex: number, stack: XenoStack } | null = null
            for (const [slotIndex, slot] of slots.entries()) {
                const stack = takeStack(slot)
                if (stack && (!candidate || xenoStackValue(stack) > xenoStackValue(candidate.stack))) {
                    candidate = { slotIndex, stack }
                }
            }
            if (!candidate) break
            const slot = slots.splice(candidate.slotIndex, 1)[0]!
            const { stack } = candidate
            await event.$fetch('/api/xeno/grid/plant', {
                method: 'POST', headers, body: { slotId: slot.id, typeId: stack.typeId, speed: stack.speed, yield: stack.yield }
            })
            stack.quantity--
            fillerPlanted++
            planted.push({ slotId: slot.id, typeId: stack.typeId })
        }
    }

    const plantedByType = Object.entries(planted.reduce<Record<string, number>>((counts, plant) => {
        counts[plant.typeId] = (counts[plant.typeId] ?? 0) + 1
        return counts
    }, {})).map(([typeId, quantity]) => ({ typeId, name: getPlant(typeId)?.name ?? typeId, quantity }))
    return {
        harvestedReadyPlants: args.harvestReady === true ? ready.length : 0,
        planted: plantedByType,
        fillerPlanted,
        fillerStrategy: 'money_first',
        unavailableRequested,
        emptySlotsRemaining: slots.length
    }
}

async function runHackOpsDailies(event: H3Event) {
    const headers = toolHeaders(event)
    const initial = await event.$fetch<HackState>('/api/hack/state', { headers })
    const completed = initial.activeOps.filter(op => op.done || Date.parse(op.completesAt) <= Date.now())
    const collected: Array<{ opId: string, result?: unknown, error?: string }> = []
    const redeployed: Array<{ previousOpId: string, result?: unknown, error?: string }> = []

    for (const op of completed) {
        try {
            const result = await event.$fetch('/api/hack/ops/collect', {
                method: 'POST',
                headers,
                body: { opId: op.id }
            })
            collected.push({ opId: op.id, result })
        } catch (error) {
            collected.push({ opId: op.id, error: getErrorMessage(error) })
            continue
        }

        try {
            const dispatch = await event.$fetch('/api/hack/ops/dispatch', {
                method: 'POST',
                headers,
                body: { templateId: op.templateId, agentIds: op.agentIds }
            })
            redeployed.push({ previousOpId: op.id, result: dispatch })
        } catch (error) {
            redeployed.push({ previousOpId: op.id, error: getErrorMessage(error) })
        }
    }

    return { completedOpsFound: completed.length, collected, redeployed }
}

async function runColonyDailies(event: H3Event, feedMethod: 'coins' | 'gems') {
    const headers = toolHeaders(event)
    const result: { collected: unknown | null, fed: unknown | null, errors: Array<{ action: string, error: string }> } = {
        collected: null,
        fed: null,
        errors: []
    }

    try {
        result.collected = await event.$fetch('/api/colony/loot/collect', { method: 'POST', headers })
    } catch (error) {
        result.errors.push({ action: 'collect_colony_loot', error: getErrorMessage(error) })
    }

    try {
        result.fed = await event.$fetch('/api/colony/feed', {
            method: 'POST',
            headers,
            body: { method: feedMethod }
        })
    } catch (error) {
        result.errors.push({ action: `feed_colony_with_${feedMethod}`, error: getErrorMessage(error) })
    }

    return { ...result, feedMethod }
}

async function sellColonyResources(event: H3Event, args: Record<string, unknown>) {
    const keepQuantity = Number(args.keepQuantity)
    if (!Number.isInteger(keepQuantity) || keepQuantity < 0 || keepQuantity > 1_000_000) {
        throw createError({ statusCode: 400, statusMessage: 'keepQuantity must be an integer from 0 to 1,000,000' })
    }
    const itemTypeId = typeof args.itemTypeId === 'string' ? args.itemTypeId : undefined
    const headers = toolHeaders(event)
    const colony = await event.$fetch<ColonyState>('/api/colony/state', { headers })
    const resources = itemTypeId
        ? colony.inventory.filter(item => item.id === itemTypeId)
        : colony.inventory

    if (itemTypeId && !resources.length) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Colony resource' })
    }

    const sold: Array<{ itemTypeId: string, quantity: number, result: unknown }> = []
    for (const resource of resources) {
        const quantity = resource.quantity - keepQuantity
        if (quantity <= 0) continue
        const result = await event.$fetch('/api/colony/market/sell', {
            method: 'POST',
            headers,
            body: { itemTypeId: resource.id, quantity }
        })
        sold.push({ itemTypeId: resource.id, quantity, result })
    }

    return { keepQuantity, itemTypeId: itemTypeId ?? null, sold }
}

async function startColonyUpgrade(event: H3Event, args: Record<string, unknown>) {
    const upgradeType = args.upgradeType
    const id = typeof args.id === 'string' ? args.id : ''
    const headers = toolHeaders(event)

    if (upgradeType === 'habitat') {
        return event.$fetch('/api/colony/habitat/upgrade', { method: 'POST', headers })
    }
    if (upgradeType === 'track' && id) {
        return event.$fetch('/api/colony/upgrades/start', { method: 'POST', headers, body: { trackId: id } })
    }
    if (upgradeType === 'research' && id) {
        return event.$fetch('/api/colony/research/sacrifice', { method: 'POST', headers, body: { typeId: id } })
    }

    throw createError({ statusCode: 400, statusMessage: 'Choose habitat, or provide an upgrade ID for a track or research upgrade' })
}

async function dispatchHackOpsMission(event: H3Event, args: Record<string, unknown>) {
    const templateId = typeof args.templateId === 'string' ? args.templateId : ''
    const agentIds = Array.isArray(args.agentIds) && args.agentIds.every(id => typeof id === 'string')
        ? args.agentIds as string[]
        : []
    if (!templateId || agentIds.length < 1 || agentIds.length > 4 || new Set(agentIds).size !== agentIds.length) {
        throw createError({ statusCode: 400, statusMessage: 'Choose one mission template and one to four unique agent IDs' })
    }

    return event.$fetch('/api/hack/ops/dispatch', {
        method: 'POST',
        headers: toolHeaders(event),
        body: { templateId, agentIds }
    })
}

async function findBestHackOpsMission(event: H3Event) {
    const hack = await event.$fetch<HackState>('/api/hack/state', { headers: toolHeaders(event) })
    const freeAgents = hack.agents
        .filter(agent => !agent.onOp)
        .sort((a, b) => b.power - a.power)

    const missions = hack.opTemplates
        .map(template => {
            const squad = freeAgents.slice(0, template.maxAgents)
            const power = squad.reduce((total, agent) => total + agent.power, 0)
            const successChance = squad.length >= template.minAgents
                ? opSuccessChance(power, template.minPower)
                : 0
            const averageCash = (template.baseCash[0] + template.baseCash[1]) / 2
            const expectedCashPerHour = template.durationMs > 0
                ? (successChance * averageCash) / (template.durationMs / 3_600_000)
                : 0

            return {
                templateId: template.id,
                name: template.name,
                squad: squad.map(agent => ({ id: agent.id, name: agent.name, power: agent.power })),
                squadPower: power,
                successChance,
                dispatchable: squad.length >= template.minAgents && successChance >= MIN_DEPLOY_SUCCESS,
                averageBaseCash: averageCash,
                baseDurationMs: template.durationMs,
                expectedBaseCashPerHour: expectedCashPerHour
            }
        })
        .sort((a, b) => b.expectedBaseCashPerHour - a.expectedBaseCashPerHour)

    return {
        freeAgentCount: freeAgents.length,
        recommended: missions.find(mission => mission.dispatchable) ?? null,
        missions
    }
}

async function runMinerDailies(event: H3Event) {
    const headers = toolHeaders(event)
    const initial = await event.$fetch<MinerState>('/api/miner/state', { headers })
    const result: {
        minerCash: unknown | null
        factoryGems: unknown | null
        freeLootboxes: unknown[]
        errors: Array<{ action: string, error: string }>
    } = {
        minerCash: null,
        factoryGems: null,
        freeLootboxes: [],
        errors: []
    }

    if (initial.pendingCash >= 0.01) {
        try {
            result.minerCash = await event.$fetch('/api/miner/collect', { method: 'POST', headers })
        } catch (error) {
            result.errors.push({ action: 'collect_miner_cash', error: getErrorMessage(error) })
        }
    }

    if (Math.floor(initial.pendingGems) >= 1) {
        try {
            result.factoryGems = await event.$fetch('/api/miner/collect-gems', { method: 'POST', headers })
        } catch (error) {
            result.errors.push({ action: 'collect_factory_gems', error: getErrorMessage(error) })
        }
    }

    for (let open = 0; open < initial.lootboxFreeOpensRemaining; open++) {
        try {
            result.freeLootboxes.push(await event.$fetch('/api/miner/lootbox/open', {
                method: 'POST',
                headers,
                body: { mode: 'free' }
            }))
        } catch (error) {
            result.errors.push({ action: `open_free_lootbox_${open + 1}`, error: getErrorMessage(error) })
            break
        }
    }

    return {
        ...result,
        requestedFreeLootboxes: initial.lootboxFreeOpensRemaining,
        openedFreeLootboxes: result.freeLootboxes.length
    }
}

const MINER_UPGRADE_ENDPOINTS = {
    rig: '/api/miner/upgrade-rig',
    vault: '/api/miner/upgrade-vault',
    factory: '/api/miner/upgrade-factory',
    overclock: '/api/miner/shop/overclock',
    catalyst: '/api/miner/shop/catalyst',
    lootbox_slot: '/api/miner/lootbox/buy-slot',
    rakeback_unlock: '/api/user/unlock-rakeback'
} as const

async function purchaseMinerUpgrades(event: H3Event, args: Record<string, unknown>) {
    const upgrade = typeof args.upgrade === 'string' ? args.upgrade : ''
    const levels = Number(args.levels)
    if (!(upgrade in MINER_UPGRADE_ENDPOINTS)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Miner upgrade' })
    }
    if (!Number.isInteger(levels) || levels < 1 || levels > 20) {
        throw createError({ statusCode: 400, statusMessage: 'levels must be an integer from 1 to 20' })
    }
    if (upgrade === 'rakeback_unlock' && levels !== 1) {
        throw createError({ statusCode: 400, statusMessage: 'Rakeback can only be unlocked once' })
    }

    const headers = toolHeaders(event)
    const endpoint = MINER_UPGRADE_ENDPOINTS[upgrade as keyof typeof MINER_UPGRADE_ENDPOINTS]
    const purchases: unknown[] = []
    let stoppedReason: string | null = null
    for (let level = 0; level < levels; level++) {
        try {
            purchases.push(await event.$fetch(endpoint, { method: 'POST', headers }))
        } catch (error) {
            stoppedReason = getErrorMessage(error)
            break
        }
    }

    return {
        upgrade,
        requestedLevels: levels,
        purchasedLevels: purchases.length,
        stoppedReason,
        purchases
    }
}

async function tradeGems(event: H3Event, args: Record<string, unknown>) {
    const action = args.action === 'buy' ? 'buy' : args.action === 'sell' ? 'sell' : ''
    const gems = Number(args.gems)
    if (!action || !Number.isInteger(gems) || gems < 1) {
        throw createError({ statusCode: 400, statusMessage: 'Choose buy or sell and a positive whole number of gems' })
    }

    const headers = toolHeaders(event)
    let price = args.price == null ? null : Number(args.price)
    if (price === null) {
        // Default to the price most likely to fill instantly: cross the spread
        // when the opposite side of the book has offers, otherwise the guide.
        const state = await event.$fetch<GemExchangeState>('/api/gem-exchange/state', { headers })
        price = (action === 'buy' ? state.bestAsk : state.bestBid) ?? state.guidePrice
        price = Math.round(price * 100) / 100
    }

    return event.$fetch('/api/gem-exchange/place', {
        method: 'POST',
        headers,
        body: { side: action, quantity: gems, price }
    })
}

interface BlackjackPlayResponse {
    totalWagered: number
    payout: number
    net: number
    balance: number
}

async function playBlackjackRounds(event: H3Event, args: Record<string, unknown>) {
    const bet = Number(args.bet)
    const rounds = Number(args.rounds)
    if (!Number.isFinite(bet) || bet < 1 || bet > AI_CASINO_MAX_BET) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack bet' })
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > AI_MAX_ROUNDS) throw createError({ statusCode: 400, statusMessage: `Rounds must be from 1 to ${AI_MAX_ROUNDS}` })

    const headers = toolHeaders(event)
    let totalWagered = 0
    let totalPayout = 0
    let net = 0
    let finalBalance: number | null = null
    let stoppedReason: string | null = null
    let playedRounds = 0
    let wins = 0
    let pushes = 0
    let losses = 0
    let biggestWin = 0
    let biggestLoss = 0

    // Each hand settles in its own locked transaction, so the row lock is released
    // between hands instead of being held for the whole batch.
    for (let round = 1; round <= rounds; round++) {
        let hand: BlackjackPlayResponse
        try {
            hand = await event.$fetch<BlackjackPlayResponse>('/api/games/blackjack/play', { method: 'POST', headers, body: { bet } })
        } catch (error) {
            stoppedReason = getErrorMessage(error)
            break
        }
        totalWagered += hand.totalWagered
        totalPayout += hand.payout
        net += hand.net
        finalBalance = hand.balance
        playedRounds++
        if (hand.net > 1e-9) wins++
        else if (hand.net < -1e-9) losses++
        else pushes++
        biggestWin = Math.max(biggestWin, hand.net)
        biggestLoss = Math.min(biggestLoss, hand.net)
    }

    return { game: 'blackjack', bet, requestedRounds: rounds, playedRounds, stoppedReason, totalWagered, totalPayout, net, finalBalance, wins, pushes, losses, biggestWin, biggestLoss }
}

export async function executeAiTool(event: H3Event, toolCall: AiToolCall): Promise<unknown> {
    const args = parseArguments(toolCall.function.arguments)
    const headers = toolHeaders(event)

    switch (toolCall.function.name) {
        case 'get_player_overview':
            return getOverview(event)
        case 'get_bank_status':
            return event.$fetch('/api/bank/state', { headers })
        case 'deposit_to_bank': {
            const amount = Number(args.amount)
            if (!Number.isFinite(amount) || amount <= 0 || amount > BANK_MAX_AMOUNT) {
                throw createError({ statusCode: 400, statusMessage: 'Enter a valid positive bank deposit amount' })
            }
            return event.$fetch('/api/bank/deposit', { method: 'POST', headers, body: { amount } })
        }
        case 'withdraw_from_bank': {
            const amount = Number(args.amount)
            if (!Number.isFinite(amount) || amount <= 0 || amount > BANK_MAX_AMOUNT) {
                throw createError({ statusCode: 400, statusMessage: 'Enter a valid positive bank withdrawal amount' })
            }
            return event.$fetch('/api/bank/withdraw', { method: 'POST', headers, body: { amount } })
        }
        case 'repay_bank_debt':
            return event.$fetch('/api/bank/deposit', { method: 'POST', headers, body: { repayDebt: true } })
        case 'collect_colony_loot':
            return event.$fetch('/api/colony/loot/collect', { method: 'POST', headers })
        case 'run_colony_dailies':
            return runColonyDailies(event, args.feedMethod === 'gems' ? 'gems' : 'coins')
        case 'feed_colony': {
            const method = args.method === 'gems' ? 'gems' : 'coins'
            return event.$fetch('/api/colony/feed', { method: 'POST', headers, body: { method } })
        }
        case 'sell_colony_resources':
            return sellColonyResources(event, args)
        case 'start_colony_upgrade':
            return startColonyUpgrade(event, args)
        case 'get_xeno_recipes':
            return getXenoRecipes(args)
        case 'manage_xeno_garden':
            return manageXenoGarden(event, args)
        case 'run_xeno_dailies': {
            const rawKeep = args.keepPerPlantType == null ? 30 : Number(args.keepPerPlantType)
            if (!Number.isInteger(rawKeep) || rawKeep < 0 || rawKeep > 1000) {
                throw createError({ statusCode: 400, statusMessage: 'keepPerPlantType must be an integer from 0 to 1000' })
            }
            return runXenoDailies(event, rawKeep)
        }
        case 'run_hackops_dailies':
            return runHackOpsDailies(event)
        case 'find_best_hackops_mission':
            return findBestHackOpsMission(event)
        case 'dispatch_hackops_mission':
            return dispatchHackOpsMission(event, args)
        case 'run_miner_dailies':
            return runMinerDailies(event)
        case 'purchase_miner_upgrades':
            return purchaseMinerUpgrades(event, args)
        case 'trade_gems':
            return tradeGems(event, args)
        case 'play_casino_rounds':
            return playCasinoRounds(event, args)
        case 'play_dice_rounds':
        case 'play_limbo_rounds':
        case 'play_wheel_rounds':
        case 'play_magichands_rounds':
        case 'play_xenoslot_rounds':
        case 'play_candymadness_rounds':
        case 'play_aethergates_rounds':
        case 'play_fireinthehole_rounds':
        case 'play_bookofshadows_rounds':
        case 'play_spinata_rounds':
            return playNamedCasinoRounds(event, toolCall.function.name, args)
        case 'play_blackjack': {
            const bet = Number(args.bet)
            if (!Number.isFinite(bet) || bet < 1 || bet > AI_CASINO_MAX_BET) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack bet' })
            return event.$fetch('/api/games/blackjack/play', { method: 'POST', headers, body: { bet } })
        }
        case 'play_blackjack_rounds':
            return playBlackjackRounds(event, args)
        case 'get_blackjack_state':
            return event.$fetch('/api/games/blackjack/resume', { headers })
        case 'start_blackjack': {
            const bet = Number(args.bet)
            if (!Number.isFinite(bet) || bet < 1 || bet > AI_CASINO_MAX_BET) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack bet' })
            return event.$fetch('/api/games/blackjack/start', { method: 'POST', headers, body: { bet } })
        }
        case 'blackjack_action': {
            const allowed = new Set(['hit', 'stand', 'double', 'split', 'surrender', 'insurance', 'no-insurance'])
            const action = typeof args.action === 'string' ? args.action : ''
            if (!allowed.has(action)) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack action' })
            return event.$fetch('/api/games/blackjack/action', { method: 'POST', headers, body: { action } })
        }
        case 'call_game_api': {
            const path = typeof args.path === 'string' ? args.path : ''
            const method = args.method === 'GET' ? 'GET' : args.method === 'POST' ? 'POST' : ''
            const gamePath = /^\/api\/(xeno|colony|hack|miner|pirates|gem-exchange|games)(?:\/[a-z0-9-]+)*$/
            if (!gamePath.test(path) || !method) {
                throw createError({ statusCode: 400, statusMessage: 'Only authenticated game API paths and GET/POST methods are allowed' })
            }
            const body = args.body && typeof args.body === 'object' && !Array.isArray(args.body)
                ? args.body as Record<string, unknown>
                : undefined
            return event.$fetch(path, { method, headers, ...(method === 'POST' ? { body } : {}) })
        }
        default:
            throw createError({ statusCode: 400, statusMessage: 'This AI tool is not allowlisted' })
    }
}
