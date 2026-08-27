import { requireUserId } from '#server/utils/auth'
import { sellItem } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    if (!runId) throw createError({ statusCode: 400, statusMessage: 'runId is required' })
    return await sellItem(userId, runId, {
        unitKey: typeof body?.unitKey === 'string' ? body.unitKey : undefined,
        stadium: body?.stadium === true
    })
})
