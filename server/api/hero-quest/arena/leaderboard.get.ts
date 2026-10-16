import { requireUserId } from '#server/utils/auth'
import { arenaLeaderboard } from '#server/utils/hero-quest-arena'
import type { HqArenaBoardResponse } from '#server/utils/hero-quest-api'

/**
 * The Arena's own leaderboard (`arena.md` §9), ranked by this season's Rating: the top 50, and the
 * viewer's rank with the players either side. Distinct from the platform leaderboard.
 */
export default defineEventHandler(async (event): Promise<HqArenaBoardResponse> => {
    const userId = await requireUserId(event)
    return arenaLeaderboard(userId, Date.now())
})
