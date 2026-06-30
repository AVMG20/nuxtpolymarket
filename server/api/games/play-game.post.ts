import { auth } from '#server/utils/auth'
import { debit, credit, getBalance, accumulateRake } from '#server/utils/balance'
import { GAMES_REGISTRY, isValidGame } from '#shared/utils/games-registry'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { bet: rawBet, game, options } = await readBody<{ bet: number; game: string; options?: Record<string, unknown> }>(event)
  const bet = Number(rawBet)

  if (!isValidGame(game)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown game: "${game}". Valid games: ${Object.keys(GAMES_REGISTRY).join(', ')}`,
    })
  }

  if (!bet || bet < 1 || !Number.isFinite(bet) || bet > 1_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
  }

  const balance = await getBalance(session.user.id)
  const balanceNum = parseFloat(balance)
  if (balanceNum < bet) {
    throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
  }

  if (!GAMES_REGISTRY[game]) throw new Error('Invalid GAMES_REGISTRY')
  const gameData = GAMES_REGISTRY[game].play(bet, options)

  // The game may stake more than the raw bet (e.g. a feature buy reports its
  // own `cost`). No balance moves before this check, so it's exploit-safe.
  const cost = typeof gameData.cost === 'number' && gameData.cost > 0 ? gameData.cost : bet
  if (balanceNum < cost) {
    throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
  }

  const net = gameData.payout - cost

  if (net > 0) {
    await credit(session.user.id, net.toFixed(4), game)
  } else if (net < 0) {
    await debit(session.user.id, Math.abs(net).toFixed(4), game)
  }

  await accumulateRake(session.user.id, cost)

  return {
    gameData,
    balance: parseFloat(await getBalance(session.user.id)),
  }
})
