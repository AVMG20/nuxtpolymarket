import { requireUserId } from '#server/utils/auth'
import { upgradeBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return upgradeBuilding(userId, String(body?.buildingId ?? ''))
})
