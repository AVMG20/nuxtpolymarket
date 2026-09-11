import { requireUserId } from '#server/utils/auth'
import { moveBuildings, type TownRelocation } from '#server/utils/town'

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const raw = Array.isArray(body?.moves) ? body.moves : []
    const moves: TownRelocation[] = raw.map((m: Record<string, unknown>) => ({
        buildingId: String(m?.buildingId ?? ''),
        plotId: String(m?.plotId ?? ''),
        tileX: Number(m?.tileX),
        tileY: Number(m?.tileY),
        rotation: Number(m?.rotation ?? 0)
    }))
    return moveBuildings(userId, moves)
})
