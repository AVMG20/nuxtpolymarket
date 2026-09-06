import { requireUserId } from '#server/utils/auth'
import { demolishBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return demolishBuilding(userId, String(body?.buildingId ?? ''))
})
