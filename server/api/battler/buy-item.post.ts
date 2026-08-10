import { requireUserId } from '#server/utils/auth'
import { buyItem } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return await buyItem(userId, body?.runId, body?.offerIndex, typeof body?.unitKey === 'string' ? body.unitKey : null)
})
