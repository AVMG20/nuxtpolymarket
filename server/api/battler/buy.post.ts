import { requireUserId } from '#server/utils/auth'
import { buyUnit } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    if (!runId) throw createError({ statusCode: 400, statusMessage: 'runId is required' })
    return await buyUnit(
        userId,
        runId,
        Number(body?.offerIndex),
        typeof body?.attackId === 'number' ? body.attackId : null,
        typeof body?.position === 'number' ? body.position : null
    )
})
