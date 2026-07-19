import type { H3Event } from 'h3'
import { AI_CASINO_MAX_BET } from '#shared/utils/limits'
import { getErrorMessage, toolHeaders } from './helpers'

const CASINO_GAMES = new Set([
    'dice', 'limbo', 'wheel', 'magichands', 'xenoslot',
    'candymadness', 'aethergates', 'fireinthehole', 'bookofshadows', 'spinata'
])

const CASINO_TOOL_GAMES: Record<string, CasinoGame> = {
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

const CASINO_OPTION_KEYS = {
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
} satisfies Record<string, string[]>

type CasinoGame = keyof typeof CASINO_OPTION_KEYS

export function invalidCasinoOptions(message: string): never {
    throw createError({ statusCode: 400, statusMessage: message })
}

export function requireOnlyOptionKeys(options: Record<string, unknown>, allowed: string[]) {
    const unexpected = Object.keys(options).filter(key => !allowed.includes(key))
    if (unexpected.length) invalidCasinoOptions(`Unsupported ${unexpected.join(', ')} option for this game`)
}

export function normalizeCasinoOptions(game: string, raw: unknown, bet: number): Record<string, unknown> | undefined {
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

interface PlayGameResponse {
    gameData: Record<string, unknown>
    balance: number
}

export async function playCasinoRounds(event: H3Event, args: Record<string, unknown>) {
    const game = typeof args.game === 'string' ? args.game : ''
    const bet = Number(args.bet)
    const rounds = Number(args.rounds)
    if (!CASINO_GAMES.has(game)) throw createError({ statusCode: 400, statusMessage: 'Unsupported casino game' })
    if (!Number.isFinite(bet) || bet < 1 || bet > AI_CASINO_MAX_BET) throw createError({ statusCode: 400, statusMessage: 'Invalid bet' })
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
        let response: PlayGameResponse
        try {
            response = await event.$fetch<PlayGameResponse, string>('/api/games/play-game', {
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

export function playNamedCasinoRounds(event: H3Event, toolName: string, args: Record<string, unknown>) {
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
