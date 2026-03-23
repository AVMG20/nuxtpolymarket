import { auth } from '../../utils/auth'
import { debit, credit, getBalance } from '../../utils/balance'
import { GAMES_REGISTRY, isValidGame } from '#shared/utils/games-registry'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const { bet: rawBet, game } = await readBody<{ bet: number; game: string }>(event)
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
  if (parseFloat(balance) < bet) {
    throw createError({ statusCode: 400, statusMessage: 'Insufficient balance' })
  }

  if (!GAMES_REGISTRY[game]) throw new Error('Invalid GAMES_REGISTRY')
  const gameData = GAMES_REGISTRY[game].play(bet)

  const net = gameData.totalSessionWin - bet

  if (net > 0) {
    await credit(session.user.id, net.toFixed(4), game)
  } else if (net < 0) {
    await debit(session.user.id, Math.abs(net).toFixed(4), game)
  }

  return {
    gameData,
    balance: parseFloat(await getBalance(session.user.id)),
  }
})
