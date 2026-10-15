import { requireUserId } from '#server/utils/auth'
import { collectChest, settleHq } from '#server/utils/hero-quest'
import type { HqChestResponse } from '#server/utils/hero-quest-api'

/** Open the chest: settle so it holds everything up to now, then pay it into the shared balance. */
export default defineEventHandler(async (event): Promise<HqChestResponse> => {
    const userId = await requireUserId(event)
    await settleHq(userId)
    return collectChest(userId)
})
