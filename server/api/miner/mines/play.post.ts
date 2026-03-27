import { eq } from 'drizzle-orm'
import { readBody } from 'h3'
import { db } from '#server/database'
import { minerState } from '#server/database/schema'
import { auth } from '#server/utils/auth'
import { credit } from '#server/utils/balance'
import { MINES_TILE_VALUES, minesValueMultiplier } from '~/shared/utils/miner-config'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({ headers: event.headers })
  if (!session?.user?.id) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const { tileIndex } = await readBody<{ tileIndex: number }>(event)
  if (typeof tileIndex !== 'number' || tileIndex < 0 || tileIndex > 8)
    throw createError({ statusCode: 400, statusMessage: 'Invalid tile index' })

  const userId = session.user.id
  const s = await db.query.minerState.findFirst({ where: eq(minerState.userId, userId) })
  if (!s) throw createError({ statusCode: 404, statusMessage: 'Miner not initialized' })

  const today = new Date().toISOString().slice(0, 10)
  const playsToday = s.minesPlaysDate === today ? s.minesTodayPlays : 0

  if (playsToday >= s.minesCount)
    throw createError({ statusCode: 400, statusMessage: 'No plays remaining today' })

  // Shuffle tile values server-side for fairness
  const multiplier = minesValueMultiplier(s.minesLevel)
  const tiles = MINES_TILE_VALUES.map(v => v * multiplier) as number[]
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!]
  }

  const reward = tiles[tileIndex]!
  const isBomb = reward === 0

  await db
    .update(minerState)
    .set({ minesTodayPlays: playsToday + 1, minesPlaysDate: today })
    .where(eq(minerState.userId, userId))

  if (!isBomb) {
    await credit(userId, reward.toFixed(4), 'mines')
  }

  return { tiles, revealed: tileIndex, reward, isBomb, playsRemaining: s.minesCount - playsToday - 1 }
})
