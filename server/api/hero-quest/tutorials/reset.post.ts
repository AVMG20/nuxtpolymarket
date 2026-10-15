import { requireUserId } from '#server/utils/auth'
import { resetTutorials } from '#server/utils/hero-quest-tutorials'
import type { HqTutorialsResetResponse } from '#server/utils/hero-quest-api'

/** Settings' "reset tutorials": see every tutorial again. Locks no feature. */
export default defineEventHandler(async (event): Promise<HqTutorialsResetResponse> => {
    const userId = await requireUserId(event)
    await resetTutorials(userId)
    return { reset: true }
})
