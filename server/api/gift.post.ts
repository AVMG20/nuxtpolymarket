import { requireUserId } from '#server/utils/auth'
import { giftToUser } from '#server/utils/gift'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const toUserId = typeof body?.toUserId === 'string' ? body.toUserId : ''
    const sent = await giftToUser(userId, toUserId, { coins: body?.coins, gems: body?.gems })
    return { ok: true, ...sent }
})
