import { requireUserId } from '#server/utils/auth'
import { placeBuilding } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    return placeBuilding(userId, String(body?.plotId ?? ''), Number(body?.tileX), Number(body?.tileY), String(body?.type ?? ''), body?.rotation ?? 0)
})
