import { getQuery, setHeader } from 'h3'
import { getPathwardenDebugExpansionMarkers } from '#server/utils/pathwarden-debug-map'
import {
    getPathwardenDebugMapPlan,
    type PathwardenDebugMapGeneration
} from '#server/utils/pathwarden-debug-map-plan'

export default defineEventHandler((event) => {
    if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    const query = getQuery(event)
    const seed = Number(query.seed ?? 1)
    const realm = Number(query.realm ?? 1)
    const generated = query.generated === 'cache' || query.generated === 'fresh'
        ? query.generated as PathwardenDebugMapGeneration
        : 'fresh'
    if (query.generated !== undefined && query.generated !== 'cache' && query.generated !== 'fresh') {
        throw createError({ statusCode: 400, statusMessage: 'generated must be cache or fresh' })
    }
    if (!Number.isFinite(seed) || !Number.isFinite(realm)) {
        throw createError({ statusCode: 400, statusMessage: 'seed and realm must be numeric' })
    }
    const result = getPathwardenDebugMapPlan(Math.floor(seed), Math.floor(realm), generated)
    const plan = result.plan
    setHeader(event, 'cache-control', 'no-store')
    return {
        seed: plan.seed,
        realm: plan.realm,
        generated: result.source,
        mapSize: plan.size,
        markers: getPathwardenDebugExpansionMarkers(plan),
        rooms: plan.rooms.map(room => ({
            id: room.id,
            depth: room.depth,
            archetype: room.archetype,
            origin: room.origin,
            terminalApproaches: room.terminalApproaches ?? []
        }))
    }
})
