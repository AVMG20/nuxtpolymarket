import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { autoRollTraits } from '#server/utils/hero-quest-traits'
import { TRAIT_AUTO_ROLL_BODY, readHqBody, type HqTraitAutoRollResponse } from '#server/utils/hero-quest-api'

/**
 * One batch of an Auto Roll: Roll until a rerolled slot lands at `minGrade` or better, the Trait
 * Gems run short, or the batch is done, and the client asks again until it stops or is stopped. Each Roll costs what a single Roll does. Lock-then-read on
 * `hq_state`, paid in one guarded decrement.
 */
export default defineEventHandler(async (event): Promise<HqTraitAutoRollResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    const { minGrade } = await readHqBody(event, TRAIT_AUTO_ROLL_BODY)
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    return db.transaction(tx => autoRollTraits(tx, userId, minGrade))
})
