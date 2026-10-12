import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { claimCalendar } from '#server/utils/hero-quest-calendar'

/**
 * Claim a login calendar day: today's, or with `makeup` the oldest missed one (`calendar.ts`).
 * Settles first, so a day of Gold is sized off the run as it stands.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'calendar')
    const body = await readBody<{ makeup?: unknown }>(event)
    await settleHq(userId)
    return db.transaction(tx => claimCalendar(tx, userId, body?.makeup === true))
})
