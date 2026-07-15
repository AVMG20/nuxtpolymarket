import { and, asc, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '#server/database'
import { aiMessages } from '#server/database/schema'
import {
    AI_CONTEXT_MAX_CHARS,
    AI_CONTEXT_MAX_MESSAGES,
    AI_CONTEXT_WARNING_CHARS,
    AI_CONTEXT_WARNING_MESSAGES,
    type AiContextStatus,
    type AiToolCall
} from '#shared/utils/ai'

interface OpenRouterTool {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
}

type OpenRouterMessage
    = { role: 'system' | 'user', content: string }
    | { role: 'assistant', content: string | null, tool_calls?: AiToolCall[] }
    | { role: 'tool', tool_call_id: string, content: string }

interface OpenRouterStreamChunk {
    error?: { message?: string }
    choices?: Array<{
        delta?: {
            content?: string | null
            tool_calls?: Array<{
                index: number
                id?: string
                type?: 'function'
                function?: { name?: string, arguments?: string }
            }>
        }
        finish_reason?: string | null
    }>
}

export const AI_TOOLS: OpenRouterTool[] = [
    {
        type: 'function',
        function: {
            name: 'get_player_overview',
            description: 'Read a compact live overview of the player\'s Xeno, Colony, Hack Ops, Miner, and Gem Market state. For bank balances, rates, debt, or loan room, use get_bank_status. This does not mutate game state.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_bank_status',
            description: 'Read the player\'s live bank balance, savings rate, debt rate, wallet-independent total deposited, and remaining loan room. Use this before advising on or making a bank transfer.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'deposit_to_bank',
            description: 'Move a positive amount of coins from the player\'s wallet into the bank. Deposits repay active bank debt first; any remainder becomes savings. The server checks the live wallet balance.',
            parameters: {
                type: 'object',
                properties: {
                    amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000000000000, description: 'Positive coin amount to deposit from the wallet.' }
                },
                required: ['amount'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'withdraw_from_bank',
            description: 'Move a positive amount of coins from the bank to the player\'s wallet. A withdrawal above available savings automatically uses remaining loan allowance and can make the bank balance negative. The server enforces all loan and debt limits.',
            parameters: {
                type: 'object',
                properties: {
                    amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000000000000, description: 'Positive coin amount to withdraw, including any desired loan amount.' }
                },
                required: ['amount'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'repay_bank_debt',
            description: 'Repay the exact current bank debt from the player\'s wallet and return the bank balance to zero. The server settles the debt immediately before calculating the exact repayment amount.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'collect_colony_loot',
            description: 'Collect all currently pending Colony loot into the player inventory.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_colony_dailies',
            description: 'Collect all pending Colony loot and refill nutrition. Feeding defaults to coins unless the player explicitly requests gems.',
            parameters: {
                type: 'object',
                properties: {
                    feedMethod: { type: 'string', enum: ['coins', 'gems'], default: 'coins', description: 'Currency used to refill nutrition. Defaults to coins.' }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'feed_colony',
            description: 'Refill Colony nutrition to its current maximum. Use coins unless the player explicitly requests gems.',
            parameters: {
                type: 'object',
                properties: {
                    method: { type: 'string', enum: ['coins', 'gems'], default: 'coins', description: 'Currency to spend. Defaults to coins.' }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_xeno_dailies',
            description: 'Harvest every ready Xeno grid slot, replant the harvested stack into empty slots, then sell surplus free plants while retaining the requested quantity per plant type.',
            parameters: {
                type: 'object',
                properties: {
                    keepPerPlantType: { type: 'integer', minimum: 0, maximum: 1000, description: 'Free inventory quantity to retain for each plant type after replanting.' }
                },
                required: ['keepPerPlantType'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_hackops_dailies',
            description: 'Collect all completed Hack Ops and redeploy the same agents on the same operation templates when still valid.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_miner_dailies',
            description: 'Collect available Miner cash, collect whole Factory gems, and open every remaining free Miner lootbox. This never buys paid lootbox opens.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'purchase_miner_upgrades',
            description: 'Purchase one or more levels of a Miner upgrade. This can spend coins or gems and stops safely at the first failed purchase. Read the player overview first so the player can be told the current level and next cost.',
            parameters: {
                type: 'object',
                properties: {
                    upgrade: {
                        type: 'string',
                        enum: ['rig', 'vault', 'factory', 'overclock', 'catalyst', 'lootbox_slot', 'rakeback_unlock'],
                        description: 'The Miner upgrade or shop unlock to purchase.'
                    },
                    levels: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of levels to attempt. Use 1 for rakeback_unlock.' }
                },
                required: ['upgrade', 'levels'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'trade_gems',
            description: 'Buy gems with coins or sell gems for coins on the live Gem Market. Each trade is server-authoritative and moves the market price.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['buy', 'sell'] },
                    gems: { type: 'integer', minimum: 1, maximum: 50, description: 'Number of gems to buy or sell.' }
                },
                required: ['action', 'gems'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_casino_rounds',
            description: 'Play between 1 and 100 sequential rounds of a supported non-blackjack casino game. Each round is server-authoritative and may stop early if the balance is insufficient. This spends coins.',
            parameters: {
                type: 'object',
                properties: {
                    game: {
                        type: 'string',
                        enum: ['dice', 'limbo', 'wheel', 'magichands', 'xenoslot', 'candymadness', 'aethergates', 'fireinthehole', 'bookofshadows', 'spinata']
                    },
                    bet: { type: 'number', minimum: 1, maximum: 1000000, description: 'Base coin bet per round.' },
                    rounds: { type: 'integer', minimum: 1, maximum: 100 },
                    options: {
                        type: 'object',
                        description: 'Validated game-specific options. Omit for a normal round when the game has defaults.',
                        properties: {
                            winChance: { type: 'number', minimum: 2, maximum: 96 },
                            target: { type: 'number', minimum: 1.1, maximum: 1000000 },
                            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
                            handValue: { type: 'number', exclusiveMinimum: 0 },
                            placements: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'integer', minimum: 0, maximum: 39 } },
                            buyBonus: { type: 'boolean' },
                            feature: { type: 'string', enum: ['buyFreeSpins', 'bonusHunt', 'superBonus', 'bonusChance', 'buyBonus'] }
                        },
                        additionalProperties: false
                    }
                },
                required: ['game', 'bet', 'rounds'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_blackjack_state',
            description: 'Read the current blackjack hand and available public state without changing it.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'start_blackjack',
            description: 'Start a new blackjack hand with the requested coin bet. This spends coins.',
            parameters: {
                type: 'object',
                properties: { bet: { type: 'number', minimum: 1, maximum: 1000000 } },
                required: ['bet'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'blackjack_action',
            description: 'Take one action in the active blackjack hand. Double, split, and insurance can spend additional coins.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['hit', 'stand', 'double', 'split', 'surrender', 'insurance', 'no-insurance'] }
                },
                required: ['action'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'call_game_api',
            description: 'Call any authenticated Polynux game API for the current player. Use this for game actions not covered by a purpose-built tool. The exact path and payload are shown to the player for approval. Account, auth, chat, analytics, leaderboard, and AI APIs are not allowed.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'A path beginning with /api/xeno, /api/colony, /api/hack, /api/miner, /api/pirates, /api/gem-market, or /api/games.' },
                    method: { type: 'string', enum: ['GET', 'POST'] },
                    body: { type: 'object', description: 'Request JSON for POST calls.', additionalProperties: true }
                },
                required: ['path', 'method'],
                additionalProperties: false
            }
        }
    }
]

interface XenoStack {
    typeId: string
    speed: number
    yield: number
    quantity: number
}

interface XenoSlot {
    id: string
    plant: null | (XenoStack & { completesAt: string, name: string })
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
}

interface ColonyState {
    initialized: boolean
    nutrition: number
    gemNutrition: number
    nutritionMax: number
    nutritionDrainPerHour: number
    feedCost: number
    gemFeedCost: number
    pendingLoot: Array<{ name: string, quantity: number }>
    bugs: Array<{ name: string, itemsPerHour: number, itemSellValue: number, feedPerHour: number }>
}

interface MinerState {
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
}

interface GemMarketState {
    livePrice: number
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

function toolHeaders(event: H3Event) {
    return { cookie: getHeader(event, 'cookie') ?? '' }
}

async function getOverview(event: H3Event) {
    const headers = toolHeaders(event)
    const [xeno, colony, hack, miner, gemMarket] = await Promise.all([
        event.$fetch<XenoState>('/api/xeno/state', { headers }),
        event.$fetch<ColonyState>('/api/colony/state', { headers }),
        event.$fetch<HackState>('/api/hack/state', { headers }),
        event.$fetch<MinerState>('/api/miner/state', { headers }),
        event.$fetch<GemMarketState>('/api/gem-market/state', { headers })
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
            inventory: xeno.inventory
        },
        colony: {
            initialized: colony.initialized,
            nutrition: colony.nutrition,
            gemNutrition: colony.gemNutrition,
            nutritionMax: colony.nutritionMax,
            feedCostCoins: colony.feedCost,
            feedCostGems: colony.gemFeedCost,
            estimatedCoinsPerHour: colonyCoinsPerHour,
            estimatedHoursUntilStarving: starvationHours,
            pendingLoot: colony.pendingLoot,
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
            freeAgents: hack.agents.filter(agent => !agent.onOp)
        },
        miner,
        gemMarket: {
            livePrice: gemMarket.livePrice,
            userGems: gemMarket.userGems
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
    if (!action || !Number.isInteger(gems) || gems < 1 || gems > 50) {
        throw createError({ statusCode: 400, statusMessage: 'Choose buy or sell and an integer from 1 to 50 gems' })
    }

    return event.$fetch(`/api/gem-market/${action}`, {
        method: 'POST',
        headers: toolHeaders(event),
        body: { gems }
    })
}

const CASINO_GAMES = new Set([
    'dice', 'limbo', 'wheel', 'magichands', 'xenoslot',
    'candymadness', 'aethergates', 'fireinthehole', 'bookofshadows', 'spinata'
])

function invalidCasinoOptions(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message })
}

function requireOnlyOptionKeys(options: Record<string, unknown>, allowed: string[]) {
    const unexpected = Object.keys(options).filter(key => !allowed.includes(key))
    if (unexpected.length) invalidCasinoOptions(`Unsupported ${unexpected.join(', ')} option for this game`)
}

function normalizeCasinoOptions(game: string, raw: unknown, bet: number): Record<string, unknown> | undefined {
    if (raw == null) return undefined
    if (typeof raw !== 'object' || Array.isArray(raw)) invalidCasinoOptions('Casino options must be an object')
    const options = raw as Record<string, unknown>

    switch (game) {
        case 'dice': {
            requireOnlyOptionKeys(options, ['winChance'])
            if (options.winChance == null) return undefined
            const winChance = Number(options.winChance)
            if (!Number.isFinite(winChance) || winChance < 2 || winChance > 96) invalidCasinoOptions('Dice winChance must be from 2 to 96')
            return { winChance }
        }
        case 'limbo': {
            requireOnlyOptionKeys(options, ['target'])
            if (options.target == null) return undefined
            const target = Number(options.target)
            if (!Number.isFinite(target) || target < 1.1 || target > 1_000_000) invalidCasinoOptions('Limbo target must be from 1.10 to 1,000,000')
            return { target }
        }
        case 'wheel': {
            requireOnlyOptionKeys(options, ['difficulty'])
            if (options.difficulty == null) return undefined
            if (!['easy', 'medium', 'hard'].includes(String(options.difficulty))) invalidCasinoOptions('Wheel difficulty must be easy, medium, or hard')
            return { difficulty: options.difficulty }
        }
        case 'magichands': {
            requireOnlyOptionKeys(options, ['handValue', 'placements'])
            const handValue = Number(options.handValue)
            const placements = Array.isArray(options.placements) ? options.placements.map(Number) : []
            if (!Number.isFinite(handValue) || handValue <= 0) invalidCasinoOptions('Magic Hands handValue must be greater than zero')
            if (placements.length < 1 || placements.length > 40 || placements.some(tile => !Number.isInteger(tile) || tile < 0 || tile > 39)) {
                invalidCasinoOptions('Magic Hands placements must contain 1 to 40 tile indexes from 0 to 39')
            }
            if (new Set(placements).size !== placements.length) invalidCasinoOptions('Magic Hands placements must be unique')
            if (Math.abs(handValue * placements.length - bet) > 0.01) invalidCasinoOptions('Magic Hands bet must equal handValue multiplied by the number of placements')
            return { handValue, placements }
        }
        case 'xenoslot':
        case 'fireinthehole':
        case 'bookofshadows': {
            requireOnlyOptionKeys(options, ['buyBonus'])
            if (options.buyBonus == null) return undefined
            if (typeof options.buyBonus !== 'boolean') invalidCasinoOptions('buyBonus must be true or false')
            return { buyBonus: options.buyBonus }
        }
        case 'candymadness': {
            requireOnlyOptionKeys(options, ['feature'])
            if (options.feature == null) return undefined
            if (!['buyFreeSpins', 'bonusHunt'].includes(String(options.feature))) invalidCasinoOptions('Candy Madness feature must be buyFreeSpins or bonusHunt')
            return { feature: options.feature }
        }
        case 'aethergates': {
            requireOnlyOptionKeys(options, ['feature'])
            if (options.feature == null) return undefined
            if (!['buyFreeSpins', 'superBonus', 'bonusChance'].includes(String(options.feature))) {
                invalidCasinoOptions('Aether Gates feature must be buyFreeSpins, superBonus, or bonusChance')
            }
            return { feature: options.feature }
        }
        case 'spinata': {
            requireOnlyOptionKeys(options, ['feature'])
            if (options.feature == null) return undefined
            if (options.feature !== 'buyBonus') invalidCasinoOptions('Spiñata feature must be buyBonus')
            return { feature: 'buyBonus' }
        }
        default:
            invalidCasinoOptions('Unsupported casino game')
    }
}

async function playCasinoRounds(event: H3Event, args: Record<string, unknown>) {
    const game = typeof args.game === 'string' ? args.game : ''
    const bet = Number(args.bet)
    const rounds = Number(args.rounds)
    if (!CASINO_GAMES.has(game)) throw createError({ statusCode: 400, statusMessage: 'Unsupported casino game' })
    if (!Number.isFinite(bet) || bet < 1 || bet > 1_000_000) throw createError({ statusCode: 400, statusMessage: 'Invalid bet' })
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw createError({ statusCode: 400, statusMessage: 'Rounds must be from 1 to 100' })
    const options = normalizeCasinoOptions(game, args.options, bet)

    const headers = toolHeaders(event)
    const results: Array<Record<string, unknown>> = []
    let totalCost = 0
    let totalPayout = 0
    let finalBalance: number | null = null
    let stoppedReason: string | null = null
    for (let round = 1; round <= rounds; round++) {
        let response: { gameData: Record<string, unknown>, balance: number }
        try {
            response = await event.$fetch('/api/games/play-game', {
                method: 'POST',
                headers,
                body: { game, bet, options }
            })
        } catch (error) {
            stoppedReason = getErrorMessage(error)
            break
        }
        const payout = Number(response.gameData.payout ?? 0)
        const cost = typeof response.gameData.cost === 'number' ? response.gameData.cost : bet
        totalCost += cost
        totalPayout += payout
        finalBalance = response.balance
        results.push({
            round,
            cost,
            payout,
            net: payout - cost,
            won: typeof response.gameData.won === 'boolean' ? response.gameData.won : payout > 0,
            multiplier: response.gameData.multiplier ?? response.gameData.totalMultiplier
        })
    }
    return { game, requestedRounds: rounds, playedRounds: results.length, stoppedReason, totalCost, totalPayout, net: totalPayout - totalCost, finalBalance, results }
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
            if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000_000_000) {
                throw createError({ statusCode: 400, statusMessage: 'Enter a valid positive bank deposit amount' })
            }
            return event.$fetch('/api/bank/deposit', { method: 'POST', headers, body: { amount } })
        }
        case 'withdraw_from_bank': {
            const amount = Number(args.amount)
            if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000_000_000) {
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
        case 'run_xeno_dailies': {
            const rawKeep = Number(args.keepPerPlantType)
            if (!Number.isInteger(rawKeep) || rawKeep < 0 || rawKeep > 1000) {
                throw createError({ statusCode: 400, statusMessage: 'keepPerPlantType must be an integer from 0 to 1000' })
            }
            return runXenoDailies(event, rawKeep)
        }
        case 'run_hackops_dailies':
            return runHackOpsDailies(event)
        case 'run_miner_dailies':
            return runMinerDailies(event)
        case 'purchase_miner_upgrades':
            return purchaseMinerUpgrades(event, args)
        case 'trade_gems':
            return tradeGems(event, args)
        case 'play_casino_rounds':
            return playCasinoRounds(event, args)
        case 'get_blackjack_state':
            return event.$fetch('/api/games/blackjack/resume', { headers })
        case 'start_blackjack': {
            const bet = Number(args.bet)
            if (!Number.isFinite(bet) || bet < 1 || bet > 1_000_000) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack bet' })
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
            const gamePath = /^\/api\/(xeno|colony|hack|miner|pirates|gem-market|games)(?:\/[a-z0-9-]+)*$/
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

async function getSystemPrompt() {
    const context = await useStorage('assets:ai-context').getItem<string>('context.md')
    return [
        'You are the Polynux game assistant. Be concise, accurate, and helpful.',
        'Use tools for live player data or game actions. Never say a tool succeeded before receiving its tool result.',
        'When proposing an action, clearly summarize costs, retained quantities, and mutations so the player can make an informed approval decision.',
        'Always render concrete currency amounts with the display tokens defined in the context. Do not write raw coin or gem amounts in assistant responses.',
        context ?? ''
    ].join('\n\n')
}

async function conversationMessages(conversationId: string, userId: string) {
    return db.query.aiMessages.findMany({
        where: and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.userId, userId)),
        orderBy: [asc(aiMessages.createdAt)]
    })
}

function toOpenAiMessages(rows: Awaited<ReturnType<typeof conversationMessages>>): OpenRouterMessage[] {
    return rows.map((row) => {
        if (row.role === 'tool') {
            return {
                role: 'tool',
                tool_call_id: row.toolCallId ?? '',
                content: row.content
            }
        }
        if (row.role === 'assistant') {
            const toolCalls = (row.toolCalls ?? []) as AiToolCall[]
            return {
                role: 'assistant',
                content: row.content || null,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {})
            }
        }
        return { role: 'user', content: row.content }
    })
}

export async function getAiContextStatus(conversationId: string, userId: string): Promise<AiContextStatus> {
    const rows = await conversationMessages(conversationId, userId)
    const characterCount = rows.reduce((sum, row) => sum + row.content.length + JSON.stringify(row.toolCalls ?? '').length, 0)
    return {
        messageCount: rows.length,
        characterCount,
        warning: rows.length >= AI_CONTEXT_WARNING_MESSAGES || characterCount >= AI_CONTEXT_WARNING_CHARS,
        blocked: rows.length >= AI_CONTEXT_MAX_MESSAGES || characterCount >= AI_CONTEXT_MAX_CHARS
    }
}

async function insertToolResult(conversationId: string, userId: string, toolCall: AiToolCall, result: unknown) {
    await db.insert(aiMessages).values({
        conversationId,
        userId,
        role: 'tool',
        content: JSON.stringify(result),
        toolCallId: toolCall.id,
        toolName: toolCall.function.name
    })
}

async function openRouterStream(
    event: H3Event,
    messages: OpenRouterMessage[],
    onText?: (content: string) => void | Promise<void>
) {
    const config = useRuntimeConfig(event)
    if (!config.openRouterApiKey) {
        throw createError({ statusCode: 503, statusMessage: 'The AI assistant is not configured' })
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': config.betterAuthUrl,
            'X-OpenRouter-Title': 'Polynux'
        },
        body: JSON.stringify({
            model: config.openRouterModel,
            max_completion_tokens: 800,
            messages,
            tools: AI_TOOLS,
            tool_choice: 'auto',
            stream: true
        })
    })
    if (!response.ok) {
        const body = await response.text()
        let message = `OpenRouter request failed (${response.status})`
        try {
            const parsed = JSON.parse(body) as { error?: { message?: string } }
            if (parsed.error?.message) message = parsed.error.message
        } catch {
            if (body.trim()) message = body.trim().slice(0, 300)
        }
        throw createError({ statusCode: 502, statusMessage: message })
    }
    if (!response.body) throw createError({ statusCode: 502, statusMessage: 'OpenRouter returned no response stream' })

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const streamedTools = new Map<number, AiToolCall>()
    let content = ''
    let buffer = ''

    async function processEvent(rawEvent: string) {
        const data = rawEvent
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
        if (!data || data === '[DONE]') return

        let chunk: OpenRouterStreamChunk
        try {
            chunk = JSON.parse(data) as OpenRouterStreamChunk
        } catch {
            throw createError({ statusCode: 502, statusMessage: 'OpenRouter returned an invalid stream event' })
        }
        if (chunk.error) throw createError({ statusCode: 502, statusMessage: chunk.error.message ?? 'OpenRouter stream failed' })

        const delta = chunk.choices?.[0]?.delta
        if (typeof delta?.content === 'string' && delta.content) {
            content += delta.content
            await onText?.(delta.content)
        }
        for (const fragment of delta?.tool_calls ?? []) {
            const current = streamedTools.get(fragment.index) ?? {
                id: '',
                type: 'function' as const,
                function: { name: '', arguments: '' }
            }
            if (fragment.id) current.id += fragment.id
            if (fragment.function?.name) current.function.name += fragment.function.name
            if (fragment.function?.arguments) current.function.arguments += fragment.function.arguments
            streamedTools.set(fragment.index, current)
        }
    }

    while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        for (const rawEvent of events) await processEvent(rawEvent)
        if (done) break
    }
    if (buffer.trim()) await processEvent(buffer)

    const toolCalls = [...streamedTools.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, toolCall]) => toolCall)
        .filter(toolCall => toolCall.id && toolCall.function.name)
    return { content, toolCalls }
}

export async function continueAiConversation(
    event: H3Event,
    conversationId: string,
    userId: string,
    onText?: (content: string) => void | Promise<void>
) {
    let lastMessageId = ''
    for (let round = 0; round < 4; round++) {
        const rows = await conversationMessages(conversationId, userId)
        const response = await openRouterStream(event, [
            { role: 'system', content: await getSystemPrompt() },
            ...toOpenAiMessages(rows)
        ], onText)
        const toolCalls = response.toolCalls
        const [saved] = await db.insert(aiMessages).values({
            conversationId,
            userId,
            role: 'assistant',
            content: response.content,
            toolCalls: toolCalls.length ? toolCalls : null
        }).returning({ id: aiMessages.id })
        lastMessageId = saved?.id ?? ''

        if (!toolCalls.length || getCookie(event, 'ai_auto_approve') !== 'true') break
        for (const toolCall of toolCalls) {
            try {
                await insertToolResult(conversationId, userId, toolCall, await executeAiTool(event, toolCall))
            } catch (error) {
                await insertToolResult(conversationId, userId, toolCall, {
                    error: getErrorMessage(error)
                })
            }
        }
    }

    return { lastMessageId, context: await getAiContextStatus(conversationId, userId) }
}

export function getErrorMessage(error: unknown) {
    if (error && typeof error === 'object') {
        const value = error as {
            statusMessage?: unknown
            message?: unknown
            data?: { statusMessage?: unknown, message?: unknown }
        }
        if (typeof value.data?.statusMessage === 'string') return value.data.statusMessage
        if (typeof value.data?.message === 'string') return value.data.message
        if (typeof value.statusMessage === 'string') return value.statusMessage
        if (typeof value.message === 'string') return value.message
    }
    return 'Unknown tool error'
}

export async function resolveAiToolCall(
    event: H3Event,
    conversationId: string,
    userId: string,
    assistantMessageId: string,
    toolCallId: string,
    approved: boolean,
    onText?: (content: string) => void | Promise<void>
) {
    const assistant = await db.query.aiMessages.findFirst({
        where: and(
            eq(aiMessages.id, assistantMessageId),
            eq(aiMessages.conversationId, conversationId),
            eq(aiMessages.userId, userId),
            eq(aiMessages.role, 'assistant')
        )
    })
    const toolCalls = (assistant?.toolCalls ?? []) as AiToolCall[]
    const toolCall = toolCalls.find(call => call.id === toolCallId)
    if (!assistant || !toolCall) throw createError({ statusCode: 404, statusMessage: 'Pending tool call not found' })

    const existing = await db.query.aiMessages.findFirst({
        where: and(
            eq(aiMessages.conversationId, conversationId),
            eq(aiMessages.userId, userId),
            eq(aiMessages.toolCallId, toolCallId)
        )
    })
    if (existing) throw createError({ statusCode: 409, statusMessage: 'This tool call was already resolved' })

    if (!approved) {
        await insertToolResult(conversationId, userId, toolCall, { declined: true, message: 'The player declined this action.' })
    } else {
        try {
            await insertToolResult(conversationId, userId, toolCall, await executeAiTool(event, toolCall))
        } catch (error) {
            await insertToolResult(conversationId, userId, toolCall, { error: getErrorMessage(error) })
        }
    }

    const rows = await conversationMessages(conversationId, userId)
    const resolvedIds = new Set(rows.filter(row => row.role === 'tool' && row.toolCallId).map(row => row.toolCallId))
    const allResolved = toolCalls.every(call => resolvedIds.has(call.id))
    if (allResolved) await continueAiConversation(event, conversationId, userId, onText)

    return { context: await getAiContextStatus(conversationId, userId) }
}
