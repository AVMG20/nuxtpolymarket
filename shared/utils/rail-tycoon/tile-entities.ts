/**
 * Tile entities: the non-rendered, non-moving entity linked to a building. The map holds the building,
 * whose tiles name the entity by id in their payload; the tile entity holds the building's location
 * and its own state (saved in the entity part) and does the building's ticking. A tile kind has a
 * tile entity when a kind in RT_TILE_ENTITY_KINDS claims it.
 *
 * To add a kind: describe it below and put it in RT_TILE_ENTITY_KINDS where its tick runs. Its saved
 * fields still get their own list in save.ts, under a format bump, because the save layout is written
 * out field by field.
 */

import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from './catalog'
import { industryTick, rtIndustryTiles } from './industries'
import { RtTileKind, type RtMap } from './map'
import type { SeededRandom } from '../random'
import { rtStationTick, type RtAcceptanceWorld } from './stations'
import { rtStationId } from './stations-build'
import { RT_OWNER_NONE, type RtIndustry, type RtStation } from './types'

/** What tile entities read from a world; RtWorld satisfies it. */
export type RtTileEntityWorld = RtAcceptanceWorld

/** One kind of tile entity. Methods, so a kind of any entity type fits RT_TILE_ENTITY_KINDS. */
export interface RtTileEntityKind<T extends { id: number }> {
    /** For messages: 'station', 'industry'. */
    readonly name: string
    /** The tile kind of its buildings. */
    readonly tileKind: RtTileKind
    /** This kind's tile entities in a world, indexed by id; a removed one leaves a hole. */
    entities(world: RtTileEntityWorld): readonly (T | null | undefined)[]
    /** The id of the tile entity a building tile's payload names. */
    idOf(payload: number): number
    /** Its building's tiles, ascending: the location it stores. Null when the building does not fit the map. */
    tiles(map: RtMap, entity: T): readonly number[] | null
    /** Owner of every tile of its building. */
    owner(entity: T): number
    /** One tick; rtTickTileEntities calls it for every live entity of the kind in ascending id. */
    tick(world: RtTileEntityWorld, entity: T, rng: SeededRandom, tick: number): void
}

/** An industry: its building is the catalog footprint from its origin, owned by nobody. */
export const RT_INDUSTRY_TILE_ENTITY: RtTileEntityKind<RtIndustry> = {
    name: 'industry',
    tileKind: RtTileKind.industry,
    entities: world => world.industries,
    idOf: payload => payload,
    tiles(map, industry) {
        const spec = RT_CATALOG.industries[RT_INDUSTRY_TYPE_IDS[industry.type]!]
        const tiles = rtIndustryTiles(map, industry)
        return spec && tiles.length === spec.width * spec.height ? tiles : null
    },
    owner: () => RT_OWNER_NONE,
    tick: industryTick
}

/** A station: its building is its tiles, owned by its owner. */
export const RT_STATION_TILE_ENTITY: RtTileEntityKind<RtStation> = {
    name: 'station',
    tileKind: RtTileKind.station,
    entities: world => world.stations,
    idOf: rtStationId,
    tiles: (_map, station) => station.tiles,
    owner: station => station.owner,
    tick: rtStationTick
}

/**
 * Every kind of tile entity, in the order RtWorld.step ticks them: industries, then stations. Every peer
 * steps in this order, so changing it changes every world's simulation.
 */
export const RT_TILE_ENTITY_KINDS: readonly RtTileEntityKind<{ id: number }>[] = Object.freeze([
    RT_INDUSTRY_TILE_ENTITY,
    RT_STATION_TILE_ENTITY
])

const HAS_TILE_ENTITY = new Set<number>(RT_TILE_ENTITY_KINDS.map(kind => kind.tileKind))

/** Whether a tile of this kind is a building with a tile entity. */
export function rtHasTileEntity(kind: number): boolean {
    return HAS_TILE_ENTITY.has(kind)
}

/** One tick of every tile entity: kind by kind in RT_TILE_ENTITY_KINDS order, each kind in ascending id. */
export function rtTickTileEntities(world: RtTileEntityWorld, rng: SeededRandom, tick: number): void {
    for (const kind of RT_TILE_ENTITY_KINDS) {
        for (const entity of kind.entities(world)) if (entity) kind.tick(world, entity, rng, tick)
    }
}

/**
 * Why a world's buildings and tile entities do not join by location, or null when they do: every tile
 * of each entity's building is a building of its kind and owner naming it, and no building with a tile
 * entity is left over. A payload names one entity, so no tile is held twice and the count of held
 * tiles settles the leftovers.
 */
export function rtTileEntityMismatch(world: RtTileEntityWorld): string | null {
    const map = world.map
    let held = 0
    for (const kind of RT_TILE_ENTITY_KINDS) {
        for (const entity of kind.entities(world)) {
            if (!entity) continue
            const tiles = kind.tiles(map, entity)
            if (!tiles) return `${kind.name} ${entity.id} does not fit the map`
            const owner = kind.owner(entity)
            for (const tile of tiles) {
                if (map.kind[tile] !== kind.tileKind || kind.idOf(map.payload[tile]!) !== entity.id || map.owner[tile] !== owner) {
                    return `${kind.name} ${entity.id} tile ${tile} is not its building`
                }
            }
            held += tiles.length
        }
    }
    let buildings = 0
    for (let i = 0; i < map.tileCount; i++) if (HAS_TILE_ENTITY.has(map.kind[i]!)) buildings++
    return buildings === held ? null : `${buildings - held} buildings have no tile entity`
}
