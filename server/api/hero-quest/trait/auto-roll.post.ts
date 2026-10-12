import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { autoRollTraits } from '#server/utils/hero-quest-traits'
import { isTraitGrade } from '#shared/utils/hero-quest/content/traits'

/**
 * One batch of an Auto Roll: Roll until a rerolled slot lands at `minGrade` or better, the Trait
 * Gems run short, or the batch is done, and the client asks again until it stops or is stopped. Each Roll costs what a single Roll does. Lock-then-read on
 * `hq_state`, paid in one guarded decrement.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'traits')
    const body = await readBody<{ minGrade?: unknown }>(event)
    const minGrade = body?.minGrade
    if (!isTraitGrade(minGrade)) throw createError({ statusCode: 400, statusMessage: 'Pick a grade to stop at' })
    // settle first, so the window before this pays at the rate it ran at, not the new one
    await settleHq(userId)
    return db.transaction(tx => autoRollTraits(tx, userId, minGrade))
})
