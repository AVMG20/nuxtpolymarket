import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { quickClearRaid } from '#server/utils/hero-quest-raids'
import { QUICK_CLEAR_BODY, readHqBody, type HqQuickClearResponse } from '#server/utils/hero-quest-api'

/** Spend a Key per clear to take a raid's best reward again without playing it, 1, 5 or 10 at once (`raid-system.md` §4). */
export default defineEventHandler(async (event): Promise<HqQuickClearResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'raids')
    const { raidId, count = 1 } = await readHqBody(event, QUICK_CLEAR_BODY)
    return db.transaction(tx => quickClearRaid(tx, userId, raidId, count))
})
