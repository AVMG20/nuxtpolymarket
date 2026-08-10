import { requireUserId } from '#server/utils/auth'
import { sellItem } from '#server/utils/battler/run'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return await sellItem(userId, body?.runId, {
        unitKey: typeof body?.unitKey === 'string' ? body.unitKey : undefined,
        stadium: body?.stadium === true
    })
})
