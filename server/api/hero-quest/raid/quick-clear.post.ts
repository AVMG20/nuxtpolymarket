import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { quickClearRaid } from '#server/utils/hero-quest-raids'
import { isRaidId } from '#shared/utils/hero-quest/content/raids'

/** Spend a Key to take a raid's best reward again without playing it (`raid-system.md` §4). */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ raidId?: string }>(event)
    const raidId = body?.raidId
    if (!isRaidId(raidId)) throw createError({ statusCode: 400, statusMessage: 'Unknown raid' })
    return db.transaction(tx => quickClearRaid(tx, userId, raidId))
})
