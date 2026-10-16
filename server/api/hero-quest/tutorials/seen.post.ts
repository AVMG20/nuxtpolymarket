import { requireUserId } from '#server/utils/auth'
import { markTutorialSeen } from '#server/utils/hero-quest-tutorials'
import { TUTORIAL_SEEN_BODY, readHqBody, type HqTutorialSeenResponse } from '#server/utils/hero-quest-api'

/** The guide's tutorial `id` was read, or a silent mark like a boss lost was reached (`tutorials.ts`). */
export default defineEventHandler(async (event): Promise<HqTutorialSeenResponse> => {
    const userId = await requireUserId(event)
    const { id } = await readHqBody(event, TUTORIAL_SEEN_BODY)
    await markTutorialSeen(userId, id)
    return { id }
})
