import { requireUserId } from '#server/utils/auth'
import { buyItem } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    if (!runId) throw createError({ statusCode: 400, statusMessage: 'runId is required' })
    return await buyItem(userId, runId, Number(body?.offerIndex), typeof body?.unitKey === 'string' ? body.unitKey : null)
})
