import { requireUserId } from '#server/utils/auth'
import { sellUnit } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    const unitKey = typeof body?.unitKey === 'string' ? body.unitKey : ''
    if (!runId || !unitKey) throw createError({ statusCode: 400, statusMessage: 'runId and unitKey are required' })
    return await sellUnit(userId, runId, unitKey)
})
