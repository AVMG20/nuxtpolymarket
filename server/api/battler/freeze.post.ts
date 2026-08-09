import { requireUserId } from '#server/utils/auth'
import { toggleFreeze } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    if (!runId) throw createError({ statusCode: 400, statusMessage: 'runId is required' })
    return await toggleFreeze(userId, runId, Number(body?.offerIndex))
})
