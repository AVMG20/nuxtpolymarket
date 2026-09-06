import { requireUserId } from '#server/utils/auth'
import { rushBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return rushBuilding(userId, String(body?.buildingId ?? ''))
})
