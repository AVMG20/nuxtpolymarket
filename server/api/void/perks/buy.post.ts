import { requireUserId } from '#server/utils/auth'
import { voidBuyPerk } from '#server/utils/void'
import type { VoidPerkId } from '#shared/utils/gamelogic/void-pilot'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidBuyPerk(userId, String(body?.perkId) as VoidPerkId)
})
