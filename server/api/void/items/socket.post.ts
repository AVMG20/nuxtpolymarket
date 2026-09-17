import { requireUserId } from '#server/utils/auth'
import { voidSocketMod } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidSocketMod(userId, String(body?.itemId), String(body?.modId))
})
