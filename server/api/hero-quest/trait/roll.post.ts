import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { rollTraits } from '#server/utils/hero-quest-traits'

/**
 * Roll the Traits (`traits.md` §2): every unlocked slot rerolls at once, for `5 + locked × 5`
 * Trait Gems. Lock-then-read on `hq_state`, so a burst of rolls queues and each pays for its own.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    return db.transaction(tx => rollTraits(tx, userId))
})
