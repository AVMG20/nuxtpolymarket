import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { settleHq } from '#server/utils/hero-quest'
import { claimCalendar } from '#server/utils/hero-quest-calendar'
import { CALENDAR_CLAIM_BODY, readHqBody, type HqCalendarClaimResponse } from '#server/utils/hero-quest-api'

/**
 * Claim a login calendar day: today's, or with `makeup` the oldest missed one (`calendar.ts`).
 * Settles first, so a day of Gold is sized off the run as it stands.
 */
export default defineEventHandler(async (event): Promise<HqCalendarClaimResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'calendar')
    const { makeup = false } = await readHqBody(event, CALENDAR_CLAIM_BODY)
    await settleHq(userId)
    return db.transaction(tx => claimCalendar(tx, userId, makeup))
})
