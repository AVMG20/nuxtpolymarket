import { requireUserId } from '#server/utils/auth'
import { placeBuildings, type TownPlacement } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const raw = Array.isArray(body?.items) ? body.items : []
    const items: TownPlacement[] = raw.map((i: Record<string, unknown>) => ({
        plotId: String(i?.plotId ?? ''),
        tileX: Number(i?.tileX),
        tileY: Number(i?.tileY),
        type: String(i?.type ?? ''),
        rotation: Number(i?.rotation ?? 0)
    }))
    return placeBuildings(userId, items)
})
