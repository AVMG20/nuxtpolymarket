import { requireUserId } from '#server/utils/auth'
import { placeStoredBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return placeStoredBuilding(userId, {
        buildingId: String(body?.buildingId ?? ''),
        plotId: String(body?.plotId ?? ''),
        tileX: Number(body?.tileX),
        tileY: Number(body?.tileY),
        rotation: Number(body?.rotation ?? 0)
    })
})
