import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { rollTraits } from '#server/utils/hero-quest-traits'

/**
 * Roll the Traits (`traits.md` §2): every unlocked slot rerolls at once, for `5 + locked × 5`
 * Trait Gems. Lock-then-read on `hq_state`, so a burst of rolls queues and each pays for its own.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    return db.transaction(tx => rollTraits(tx, userId))
})
