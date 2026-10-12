import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { purchaseBattleSpeed, settleHq } from '#server/utils/hero-quest'
import { isBattleSpeedDuration, isBattleSpeedTier } from '#shared/utils/hero-quest/battle-speed'

/**
 * Buy a block of Battle Speed (`idle-mechanics.md` §3) with Gems.
 *
 * Settles first, so the time before the purchase is paid at the speed it actually ran at: the
 * settle counts a block from the start of its window, so the window has to open at the purchase.
 * The purchase itself is lock-then-read; see `purchaseBattleSpeed`.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'speed')
    const body = await readBody<{ speed?: number, minutes?: number }>(event)
    const speed = body?.speed
    const minutes = body?.minutes
    if (!isBattleSpeedTier(speed) || !isBattleSpeedDuration(minutes)) {
        throw createError({ statusCode: 400, statusMessage: 'Unknown Battle Speed block' })
    }

    await settleHq(userId)
    return db.transaction(tx => purchaseBattleSpeed(tx, userId, speed, minutes))
})
