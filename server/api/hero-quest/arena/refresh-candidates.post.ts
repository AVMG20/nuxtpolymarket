import { requireUserId } from '#server/utils/auth'
import { settleHq } from '#server/utils/hero-quest'
import { refreshCandidates } from '#server/utils/hero-quest-arena'

/** Draw a fresh opponent list for `ARENA_REFRESH_GEMS` (`arena.md` §2). Gems leave the shared balance under the row lock. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await settleHq(userId)
    return refreshCandidates(userId, Date.now())
})
