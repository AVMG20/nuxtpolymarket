import { requireUserId } from '#server/utils/auth'
import { debit, credit, getBalance, accumulateRake } from '#server/utils/balance'
import { db } from '#server/database'
import { GAMES_REGISTRY, isValidGame } from '#shared/utils/games-registry'
import { CASINO_MAX_BET } from '#shared/utils/limits'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const { bet: rawBet, game, options } = await readBody<{ bet: number; game: string; options?: Record<string, unknown> }>(event)
  const bet = Number(rawBet)

  if (!isValidGame(game)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown game: "${game}". Valid games: ${Object.keys(GAMES_REGISTRY).join(', ')}`,
    })
  }

  if (!bet || bet < 1 || !Number.isFinite(bet) || bet > CASINO_MAX_BET) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
  }

  if (!GAMES_REGISTRY[game]) throw new Error('Invalid GAMES_REGISTRY')
  const gameData = GAMES_REGISTRY[game].play(bet, options)

  // The game may stake more than the raw bet (e.g. a feature buy reports its
  // own `cost`), or explicitly 0 (e.g. a bonus-resolution step that already
  // charged the bet on an earlier call and just wants to pay out). Only an
  // absent/non-numeric cost falls back to the raw bet.
  const cost = typeof gameData.cost === 'number' && gameData.cost >= 0 ? gameData.cost : bet

  // Stake first, pay out second: the atomic debit is what enforces affordability,
  // so a win can never be credited for a round the player could not cover.
  await db.transaction(async (tx) => {
    if (cost > 0) {
      await debit(userId, cost.toFixed(4), game, tx)
    }
    if (gameData.payout > 0) {
      await credit(userId, gameData.payout.toFixed(4), game, tx)
    }
    await accumulateRake(userId, cost, tx)
  })

  return {
    gameData,
    balance: parseFloat(await getBalance(userId)),
  }
})
