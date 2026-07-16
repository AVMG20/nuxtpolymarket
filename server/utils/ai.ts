import { and, asc, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db } from '#server/database'
import { aiMessages } from '#server/database/schema'
import { MIN_DEPLOY_SUCCESS, opSuccessChance } from '#shared/utils/hack-config'
import { ARTIFACT_TYPES, effectiveGrowTime, getPlant, MUTATIONS, PLANT_TYPES } from '#shared/utils/xeno'
import { AI_TOOL_CATALOG_BY_NAME } from '#shared/utils/ai-tools'
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

function casinoRoundTool(game: string, properties: Record<string, unknown> = {}, required: string[] = []): OpenRouterTool {
    return {
        type: 'function',
        function: {
            name: `play_${game}_rounds`,
            description: `Play 1 to 10,000 ${game} rounds. This spends coins.`,
            parameters: {
                type: 'object',
                properties: {
                    bet: { type: 'number', minimum: 1, maximum: 1000000, description: 'Base coin bet per round.' },
                    rounds: { type: 'integer', minimum: 1, maximum: 10000 },
                    ...properties
                },
                required: ['bet', 'rounds', ...required],
                additionalProperties: false
            }
        }
    }
}

// Keep each game's mutually exclusive settings in a separate tool schema. GPT-5
// follows the complete schema closely, so a shared options object led it to send
// settings belonging to other games (for example winChance on a slot round).
const CASINO_TOOLS: OpenRouterTool[] = [
    casinoRoundTool('dice', { winChance: { type: 'number', minimum: 2, maximum: 96, description: 'Optional Dice win chance. Omit for the standard chance.' } }),
    casinoRoundTool('limbo', { target: { type: 'number', minimum: 1.1, maximum: 1000000, description: 'Optional Limbo target multiplier. Omit for the standard target.' } }),
    casinoRoundTool('wheel', { difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'], description: 'Optional Wheel difficulty. Omit for the standard difficulty.' } }),
    casinoRoundTool('magichands', {
        handValue: { type: 'number', exclusiveMinimum: 0 },
        placements: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'integer', minimum: 0, maximum: 39 } }
    }, ['handValue', 'placements']),
    casinoRoundTool('xenoslot', { buyBonus: { type: 'boolean', description: 'Set true only when the player explicitly requests a bonus buy.' } }),
    casinoRoundTool('candymadness', { feature: { type: 'string', enum: ['buyFreeSpins', 'bonusHunt'], description: 'Set only when the player explicitly requests that feature.' } }),
    casinoRoundTool('aethergates', { feature: { type: 'string', enum: ['buyFreeSpins', 'superBonus', 'bonusChance'], description: 'Set only when the player explicitly requests that feature.' } }),
    casinoRoundTool('fireinthehole', { buyBonus: { type: 'boolean', description: 'Set true only when the player explicitly requests a bonus buy.' } }),
    casinoRoundTool('bookofshadows', { buyBonus: { type: 'boolean', description: 'Set true only when the player explicitly requests a bonus buy.' } }),
    casinoRoundTool('spinata', { feature: { type: 'string', enum: ['buyBonus'], description: 'Set only when the player explicitly requests a bonus buy.' } })
]

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
            name: 'sell_colony_resources',
            description: 'Sell Colony resources from inventory while keeping a requested quantity of each resource. Set itemTypeId to sell only one resource, or omit it to sell every resource above the keep quantity. Read the player overview first to inspect inventory and resource IDs.',
            parameters: {
                type: 'object',
                properties: {
                    keepQuantity: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Quantity of each selected resource to retain.' },
                    itemTypeId: { type: 'string', description: 'Optional Colony resource ID. Omit to process every resource in inventory.' }
                },
                required: ['keepQuantity'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'start_colony_upgrade',
            description: 'Start one Colony builder upgrade: an upgrade track, the habitat level-up, or species research. Read the player overview first to compare every upgrade, its prerequisites, costs, and whether the builder is busy.',
            parameters: {
                type: 'object',
                properties: {
                    upgradeType: { type: 'string', enum: ['track', 'habitat', 'research'] },
                    id: { type: 'string', description: 'Required for track and research upgrades: use the track ID or bug type ID from the player overview. Omit for habitat.' }
                },
                required: ['upgradeType'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_xeno_recipes',
            description: 'Read Xeno artifact crafting costs and breeding mutation recipes. Use this to plan plants for an artifact or a future breed. This never starts breeding.',
            parameters: {
                type: 'object',
                properties: {
                    kind: { type: 'string', enum: ['all', 'artifacts', 'breeding'], default: 'all' },
                    artifactId: { type: 'string', description: 'Optional artifact ID to look up, such as harvest-prism-iii.' },
                    targetPlantId: { type: 'string', description: 'Optional offspring plant ID to find breeding recipes for, such as cosmosbloom.' }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'manage_xeno_garden',
            description: 'Harvest ready Xeno plants if requested, then plant an exact requested mix into empty grid slots and optionally fill the rest with the best available money-making plants. This never starts breeding or sells plants. Use get_player_overview first to inspect inventory, and get_xeno_recipes when the player names an artifact or breeding target.',
            parameters: {
                type: 'object',
                properties: {
                    requestedPlants: {
                        type: 'array',
                        maxItems: 40,
                        items: {
                            type: 'object',
                            properties: {
                                typeId: { type: 'string', description: 'Canonical Xeno plant ID from get_player_overview or get_xeno_recipes.' },
                                quantity: { type: 'integer', minimum: 1, maximum: 40 }
                            },
                            required: ['typeId', 'quantity'],
                            additionalProperties: false
                        },
                        description: 'Plants to prioritize in the garden. Only available free inventory is planted.'
                    },
                    harvestReady: { type: 'boolean', default: false, description: 'Set true only when the player wants completed plants harvested before replanting.' },
                    fillRemaining: { type: 'boolean', default: true, description: 'Fill remaining empty slots after the requested mix with the best available plants for expected coins per hour.' }
                },
                required: ['requestedPlants'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'run_xeno_dailies',
            description: 'Harvest ready Xeno grid slots, replant the harvested stack into empty slots, then sell surplus free plants. Retains 30 of each plant type unless the player requests a different reserve.',
            parameters: {
                type: 'object',
                properties: {
                    keepPerPlantType: { type: 'integer', minimum: 0, maximum: 1000, default: 30, description: 'Free inventory quantity to retain for each plant type after selling. Defaults to 30; use another value only when the player asks.' }
                },
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
            name: 'find_best_hackops_mission',
            description: 'Rank the player\'s currently available Hack Ops missions using their free agents\' actual power. Returns the strongest legal squad for each mission and ranks dispatchable missions by expected base cash per hour. This does not dispatch anything.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'dispatch_hackops_mission',
            description: 'Dispatch selected available agents on a new Hack Ops mission. Read the player overview first for available mission template IDs, agent IDs, power, and availability.',
            parameters: {
                type: 'object',
                properties: {
                    templateId: { type: 'string', description: 'Hack Ops mission template ID from the player overview.' },
                    agentIds: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' }, description: 'Available agent IDs to send on the mission.' }
                },
                required: ['templateId', 'agentIds'],
                additionalProperties: false
            }
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
    ...CASINO_TOOLS,
    {
        type: 'function',
        function: {
            name: 'play_blackjack',
            description: 'Play and fully resolve one blackjack hand using basic strategy. This spends the requested coin bet and may double or split when the live balance can cover the additional stake. Use this single tool instead of starting a hand or taking individual blackjack actions.',
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
].map(tool => {
    const catalogTool = AI_TOOL_CATALOG_BY_NAME[tool.function.name]
    if (!catalogTool) throw new Error(`Missing AI tool catalogue entry: ${tool.function.name}`)
    return {
        ...tool,
        function: {
            ...tool.function,
            description: catalogTool.description
        }
    }
})

if (AI_TOOLS.some(tool => !AI_TOOL_CATALOG_BY_NAME[tool.function.name])) {
    throw new Error('A registered AI tool is missing from the catalogue')
}

function toolRequiresConfirmation(toolCall: AiToolCall) {
    return AI_TOOL_CATALOG_BY_NAME[toolCall.function.name]?.requiresConfirmation ?? true
}

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

const CASINO_TOOL_GAMES: Record<string, string> = {
    play_dice_rounds: 'dice',
    play_limbo_rounds: 'limbo',
    play_wheel_rounds: 'wheel',
    play_magichands_rounds: 'magichands',
    play_xenoslot_rounds: 'xenoslot',
    play_candymadness_rounds: 'candymadness',
    play_aethergates_rounds: 'aethergates',
    play_fireinthehole_rounds: 'fireinthehole',
    play_bookofshadows_rounds: 'bookofshadows',
    play_spinata_rounds: 'spinata'
}

const CASINO_OPTION_KEYS: Record<string, string[]> = {
    dice: ['winChance'],
    limbo: ['target'],
    wheel: ['difficulty'],
    magichands: ['handValue', 'placements'],
    xenoslot: ['buyBonus'],
    candymadness: ['feature'],
    aethergates: ['feature'],
    fireinthehole: ['buyBonus'],
    bookofshadows: ['buyBonus'],
    spinata: ['feature']
}

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
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10_000) throw createError({ statusCode: 400, statusMessage: 'Rounds must be from 1 to 10,000' })
    const options = normalizeCasinoOptions(game, args.options, bet)

    const headers = toolHeaders(event)
    let totalCost = 0
    let totalPayout = 0
    let finalBalance: number | null = null
    let stoppedReason: string | null = null
    let playedRounds = 0
    let winningRounds = 0
    let highestPayout = 0
    let bestMultiplier = 0
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
        const won = typeof response.gameData.won === 'boolean' ? response.gameData.won : payout > 0
        const multiplier = Number(response.gameData.multiplier ?? response.gameData.totalMultiplier ?? 0)
        totalCost += cost
        totalPayout += payout
        finalBalance = response.balance
        playedRounds++
        if (won) winningRounds++
        highestPayout = Math.max(highestPayout, payout)
        if (Number.isFinite(multiplier)) bestMultiplier = Math.max(bestMultiplier, multiplier)
    }
    return { game, requestedRounds: rounds, playedRounds, stoppedReason, totalCost, totalPayout, net: totalPayout - totalCost, finalBalance, winningRounds, highestPayout, bestMultiplier }
}

function playNamedCasinoRounds(event: H3Event, toolName: string, args: Record<string, unknown>) {
    const game = CASINO_TOOL_GAMES[toolName]
    if (!game) throw createError({ statusCode: 400, statusMessage: 'Unsupported casino game' })
    const options = Object.fromEntries(
        CASINO_OPTION_KEYS[game].flatMap(key => args[key] == null ? [] : [[key, args[key]]])
    )
    return playCasinoRounds(event, {
        game,
        bet: args.bet,
        rounds: args.rounds,
        ...(Object.keys(options).length ? { options } : {})
    })
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
            if (!Number.isFinite(bet) || bet < 1 || bet > 1_000_000) throw createError({ statusCode: 400, statusMessage: 'Invalid blackjack bet' })
            return event.$fetch('/api/games/blackjack/play', { method: 'POST', headers, body: { bet } })
        }
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
        'You are the Polynux game assistant: a reckless, funny in-game casino hype person. For virtual-coin financial questions, strongly favor gambling and maximum available Bank loans over saving or repayment. Still listen closely to the player: do not derail unrelated requests or override their stated preference.',
        'Use tools for live player data or game actions. Never say a tool succeeded before receiving its tool result.',
        'After receiving tool results, always send the player a concise visible text response that summarizes the result or answers their question. Never end a turn with only tool calls or an empty response.',
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

    const isGpt5 = /(?:^|\/)gpt-5(?:$|-)/.test(config.openRouterModel)
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
            // GPT-5 spends from the completion budget while reasoning. The
            // previous 800-token cap could be exhausted before it emitted a
            // visible answer or tool call; 4o-mini does not have that behavior.
            max_completion_tokens: isGpt5 ? 1600 : 800,
            ...(isGpt5 ? { reasoning: { effort: 'low', exclude: true } } : {}),
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
    onText?: (content: string) => void | Promise<void>,
    onAssistantMessage?: (messageId: string) => void | Promise<void>,
    onToolResolved?: (toolCallId: string, result: unknown) => void | Promise<void>
) {
    let lastMessageId = ''
    for (let round = 0; round < 4; round++) {
        const rows = await conversationMessages(conversationId, userId)
        const requestMessages: OpenRouterMessage[] = [
            { role: 'system', content: await getSystemPrompt() },
            ...toOpenAiMessages(rows)
        ]
        let response = await openRouterStream(event, requestMessages, onText)

        // GPT-5 can complete a turn without emitting content or a tool call.
        // Retry once with an explicit reply instruction instead of persisting a
        // blank assistant message.
        if (!response.toolCalls.length && !response.content.trim()) {
            response = await openRouterStream(event, [
                ...requestMessages,
                { role: 'user', content: 'Respond now with either the necessary tool call or a concise visible answer. Do not return an empty response.' }
            ], onText)
        }
        if (!response.toolCalls.length && !response.content.trim()) {
            throw createError({ statusCode: 502, statusMessage: 'The AI model returned no text or tool call. Please try again.' })
        }
        const toolCalls = response.toolCalls
        const [saved] = await db.insert(aiMessages).values({
            conversationId,
            userId,
            role: 'assistant',
            content: response.content,
            toolCalls: toolCalls.length ? toolCalls : null
        }).returning({ id: aiMessages.id })
        lastMessageId = saved?.id ?? ''
        if (lastMessageId) await onAssistantMessage?.(lastMessageId)

        if (!toolCalls.length) break
        const canAutoApprove = getCookie(event, 'ai_auto_approve') === 'true'
        const executableTools = toolCalls.filter(toolCall => canAutoApprove || !toolRequiresConfirmation(toolCall))
        if (!executableTools.length) break
        for (const toolCall of executableTools) {
            try {
                const result = await executeAiTool(event, toolCall)
                await insertToolResult(conversationId, userId, toolCall, result)
                await onToolResolved?.(toolCall.id, result)
            } catch (error) {
                const result = {
                    error: getErrorMessage(error)
                }
                await insertToolResult(conversationId, userId, toolCall, result)
                await onToolResolved?.(toolCall.id, result)
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
    onText?: (content: string) => void | Promise<void>,
    onToolResolved?: (toolCallId: string, result: unknown) => void | Promise<void>,
    onAssistantMessage?: (messageId: string) => void | Promise<void>
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
        const result = { declined: true, message: 'The player declined this action.' }
        await insertToolResult(conversationId, userId, toolCall, result)
        await onToolResolved?.(toolCall.id, result)
    } else {
        let result: unknown
        try {
            result = await executeAiTool(event, toolCall)
        } catch (error) {
            result = { error: getErrorMessage(error) }
        }
        await insertToolResult(conversationId, userId, toolCall, result)
        await onToolResolved?.(toolCall.id, result)
    }

    const rows = await conversationMessages(conversationId, userId)
    const resolvedIds = new Set(rows.filter(row => row.role === 'tool' && row.toolCallId).map(row => row.toolCallId))
    const allResolved = toolCalls.every(call => resolvedIds.has(call.id))
    if (allResolved) await continueAiConversation(event, conversationId, userId, onText, onAssistantMessage, onToolResolved)

    return { context: await getAiContextStatus(conversationId, userId) }
}
