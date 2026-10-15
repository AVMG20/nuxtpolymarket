import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { quickClearRaid } from '#server/utils/hero-quest-raids'
import { RAID_BODY, readHqBody, type HqQuickClearResponse } from '#server/utils/hero-quest-api'

/** Spend a Key to take a raid's best reward again without playing it (`raid-system.md` §4). */
export default defineEventHandler(async (event): Promise<HqQuickClearResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'raids')
    const { raidId } = await readHqBody(event, RAID_BODY)
    return db.transaction(tx => quickClearRaid(tx, userId, raidId))
})
