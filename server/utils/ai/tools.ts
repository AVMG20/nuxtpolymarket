import { AI_TOOL_CATALOG_BY_NAME } from '#shared/utils/ai-tools'
import { AI_CASINO_MAX_BET } from '#shared/utils/limits'
import type { AiToolCall } from '#shared/utils/ai'

interface OpenRouterTool {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: Record<string, unknown>
    }
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
                    bet: { type: 'number', minimum: 1, maximum: AI_CASINO_MAX_BET, description: 'Base coin bet per round.' },
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

const AI_TOOL_DEFINITIONS: OpenRouterTool[] = [
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
                properties: { bet: { type: 'number', minimum: 1, maximum: AI_CASINO_MAX_BET } },
                required: ['bet'],
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'play_blackjack_rounds',
            description: 'Play and fully resolve 1 to 10,000 blackjack hands with basic strategy, entirely on the server, and return aggregate results. Each hand uses the same base bet and may double or split when the live balance can cover the extra stake. Prefer this over calling play_blackjack repeatedly when the player wants more than one hand.',
            parameters: {
                type: 'object',
                properties: {
                    bet: { type: 'number', minimum: 1, maximum: AI_CASINO_MAX_BET, description: 'Base coin bet per hand.' },
                    rounds: { type: 'integer', minimum: 1, maximum: 10000, description: 'Number of hands to play.' }
                },
                required: ['bet', 'rounds'],
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

export const AI_TOOLS: OpenRouterTool[] = AI_TOOL_DEFINITIONS.map(tool => {
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

export function toolRequiresConfirmation(toolCall: AiToolCall) {
    return AI_TOOL_CATALOG_BY_NAME[toolCall.function.name]?.requiresConfirmation ?? true
}
