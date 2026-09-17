import { requireUserId } from '#server/utils/auth'
import { voidUpgradeItem } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidUpgradeItem(userId, String(body?.itemId))
})
