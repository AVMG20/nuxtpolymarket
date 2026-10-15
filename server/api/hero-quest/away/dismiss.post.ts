import { requireUserId } from '#server/utils/auth'
import { dismissAwayReport } from '#server/utils/hero-quest'
import { AWAY_DISMISS_BODY, readHqBody, type HqAwayDismissResponse } from '#server/utils/hero-quest-api'

/** The welcome-back card `id` was put away. Pays nothing, so a repeat or a stale id is harmless. */
export default defineEventHandler(async (event): Promise<HqAwayDismissResponse> => {
    const userId = await requireUserId(event)
    const { id } = await readHqBody(event, AWAY_DISMISS_BODY)
    await dismissAwayReport(userId, id)
    return { id }
})
