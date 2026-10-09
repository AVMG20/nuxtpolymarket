import { requireUserId } from '#server/utils/auth'
import { arenaLog } from '#server/utils/hero-quest-arena'

/** The battle log (`arena.md` §8): the last 20 matches, attacking and defending, newest first. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return arenaLog(userId)
})
