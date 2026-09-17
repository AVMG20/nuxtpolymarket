import { requireUserId } from '#server/utils/auth'
import { createOffer } from '#server/utils/tcg/trade'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const ids = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    return await createOffer(userId, {
        toUserId: typeof body?.toUserId === 'string' ? body.toUserId : '',
        senderCopyIds: ids(body?.senderCopyIds),
        receiverCopyIds: ids(body?.receiverCopyIds),
        senderCoins: Number(body?.senderCoins ?? 0),
        receiverCoins: Number(body?.receiverCoins ?? 0),
        note: typeof body?.note === 'string' && body.note ? body.note : null
    })
})
