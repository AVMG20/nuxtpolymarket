import { requireUserId } from '#server/utils/auth'
import { redesignTown, type TownRelocation } from '#server/utils/town'

function toRelocation(m: Record<string, unknown>): TownRelocation {
    return {
        buildingId: String(m?.buildingId ?? ''),
        plotId: String(m?.plotId ?? ''),
        tileX: Number(m?.tileX),
        tileY: Number(m?.tileY),
        rotation: Number(m?.rotation ?? 0)
    }
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)
    const body = await readBody(event)
    const rawMoves = Array.isArray(body?.moves) ? body.moves : []
    const rawRoads = Array.isArray(body?.roads) ? body.roads : []
    const rawPlace = Array.isArray(body?.place) ? body.place : []
    const moves: TownRelocation[] = rawMoves.map(toRelocation)
    const place: TownRelocation[] = rawPlace.map(toRelocation)
    const store: string[] = Array.isArray(body?.store) ? body.store.map((id: unknown) => String(id)) : []
    const roads = rawRoads.map((r: Record<string, unknown>) => ({
        plotId: String(r?.plotId ?? ''),
        tileX: Number(r?.tileX),
        tileY: Number(r?.tileY)
    }))
    return redesignTown(userId, { moves, roads, store, place })
})
