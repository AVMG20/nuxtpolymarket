import { requireUserId } from '#server/utils/auth'
import { voidSetFit } from '#server/utils/void'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return voidSetFit(userId, String(body?.shipId), body?.fit)
})
