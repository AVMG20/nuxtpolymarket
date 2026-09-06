import { requireUserId } from '#server/utils/auth'
import { moveBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return moveBuilding(userId, String(body?.buildingId ?? ''), String(body?.plotId ?? ''), Number(body?.tileX), Number(body?.tileY), Number(body?.rotation ?? 0))
})
