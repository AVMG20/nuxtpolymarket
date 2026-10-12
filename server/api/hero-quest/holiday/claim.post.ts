import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { settleHq } from '#server/utils/hero-quest'
import { claimHoliday } from '#server/utils/hero-quest-holidays'

/**
 * Claim an open holiday's gift (`holiday-events.md` §2), once per holiday per year. Settles first,
 * so the gift's Gold is sized off the run as it stands. No feature gate: with no catch-up, a gate
 * would cost a new player the gift outright.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody<{ holidayId?: unknown }>(event)
    await settleHq(userId)
    return db.transaction(tx => claimHoliday(tx, userId, body?.holidayId))
})
