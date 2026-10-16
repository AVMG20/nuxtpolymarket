import { db } from '#server/database'
import { requireUserId } from '#server/utils/auth'
import { requireFeature } from '#server/utils/hero-quest-tutorials'
import { purchaseBattleSpeed, settleHq } from '#server/utils/hero-quest'
import { SPEED_BUY_BODY, readHqBody, type HqSpeedBuyResponse } from '#server/utils/hero-quest-api'

/**
 * Buy a block of Battle Speed (`idle-mechanics.md` §3) with Gems.
 *
 * Settles first, so the time before the purchase is paid at the speed it actually ran at: the
 * settle counts a block from the start of its window, so the window has to open at the purchase.
 * The purchase itself is lock-then-read; see `purchaseBattleSpeed`.
 */
export default defineEventHandler(async (event): Promise<HqSpeedBuyResponse> => {
    const userId = await requireUserId(event)
    await requireFeature(userId, 'speed')
    const { speed, minutes } = await readHqBody(event, SPEED_BUY_BODY)

    await settleHq(userId)
    return db.transaction(tx => purchaseBattleSpeed(tx, userId, speed, minutes))
})
