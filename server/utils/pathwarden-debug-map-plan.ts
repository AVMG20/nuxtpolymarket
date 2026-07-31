import type { PathwardenMapPlan } from '#shared/types/pathwarden-save'
import { createPathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map'

export type PathwardenDebugMapGeneration = 'cache' | 'fresh'

const plans = new Map<string, PathwardenMapPlan>()

function cacheKey(seed: number, realm: number) {
    return `${seed}:${realm}`
}

export function getPathwardenDebugMapPlan(
    seed: number,
    realm: number,
    generated: PathwardenDebugMapGeneration
) {
    const key = cacheKey(seed, realm)
    if (generated === 'cache') {
        const cached = plans.get(key)
        if (cached) return { plan: cached, source: 'cache' as const }
    }
    const plan = createPathwardenMapPlan({ seed, realm, maxDepth: 13 })
    plans.set(key, plan)
    return { plan, source: 'fresh' as const }
}
