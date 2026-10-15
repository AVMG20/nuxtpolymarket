import { requireUserId } from '#server/utils/auth'
import { arenaLog } from '#server/utils/hero-quest-arena'
import type { HqArenaLogResponse } from '#server/utils/hero-quest-api'

/** The battle log (`arena.md` §8): the last 20 matches, attacking and defending, newest first. */
export default defineEventHandler(async (event): Promise<HqArenaLogResponse> => {
    const userId = await requireUserId(event)
    return arenaLog(userId)
})
