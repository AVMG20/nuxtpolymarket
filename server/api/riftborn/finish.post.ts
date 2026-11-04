import { requireUserId } from '#server/utils/auth'
import { settleRiftbornRun } from '#server/utils/riftborn'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    if (!runId) throw createError({ statusCode: 400, statusMessage: 'Missing run' })
    return settleRiftbornRun(userId, runId, body?.report)
})
