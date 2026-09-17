import { requireUserId } from '#server/utils/auth'
import { voidSalvageItem } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidSalvageItem(userId, String(body?.itemId))
})
