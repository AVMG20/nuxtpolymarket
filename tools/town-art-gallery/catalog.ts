import { TOWN_BUILDINGS, townBuildingMaxLevel } from '../../shared/utils/gamelogic/town'

/** Use the gameplay registry so new buildings and changed level caps appear automatically. */
export const artCatalog = TOWN_BUILDINGS.flatMap(building =>
    Array.from({ length: building.kind === 'road' ? 1 : townBuildingMaxLevel(building) }, (_, i) => ({
        id: `${building.id}:${i + 1}`,
        type: building.id,
        name: building.name,
        kind: building.kind,
        tier: building.tier,
        level: i + 1
    }))
)
