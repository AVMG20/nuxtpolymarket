import { requireUserId } from '#server/utils/auth'
import { collectChest, settleHq } from '#server/utils/hero-quest'

/** Open the chest: settle so it holds everything up to now, then pay it into the shared balance. */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    await settleHq(userId)
    return collectChest(userId)
})
