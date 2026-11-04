import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtAxis, RtStationTile, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import { RT_OWNER_NONE, type RtIndustry, type RtStation } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'

/**
 * Inserts a hand-built station with its buildings: each of its tiles becomes a platform of its owner
 * naming it, as a save needs. Throws when a tile already holds another tile entity's building.
 */
export function insertStationWithTiles(world: RtWorld, station: RtStation): void {
    for (const tile of station.tiles) {
        if (world.map.kind[tile] === RtTileKind.station || world.map.kind[tile] === RtTileKind.industry) {
            throw new Error(`fixture station ${station.id} tile ${tile} is already a building`)
        }
        world.map.setTile(tile, RtTileKind.station, station.owner, rtStationPayload(station.id, RtStationTile.rail, RtAxis.x))
    }
    world.insertStation(station)
}

/** The first `count` tiles from `from` on, ascending, that hold no tile entity's building. */
export function freeTiles(world: RtWorld, from: number, count: number): number[] {
    const tiles: number[] = []
    for (let tile = from; tiles.length < count && tile < world.map.tileCount; tile++) {
        const kind = world.map.kind[tile]
        if (kind !== RtTileKind.station && kind !== RtTileKind.industry) tiles.push(tile)
    }
    return tiles
}

/** Gives a station other tiles, clearing its old buildings and placing the new ones. */
export function setStationTiles(world: RtWorld, id: number, tiles: number[]): void {
    const station = world.station(id)!
    for (const tile of station.tiles) world.map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
    world.removeStation(id)
    insertStationWithTiles(world, { ...station, tiles })
}

/** Removes a station and clears its buildings, as demolishing its last tile does. */
export function removeStationWithTiles(world: RtWorld, id: number): void {
    for (const tile of world.station(id)!.tiles) world.map.setTile(tile, RtTileKind.clear, RT_OWNER_NONE, 0)
    world.removeStation(id)
}

/** Puts a hand-built industry in the world with its buildings over its catalog footprint. */
export function insertIndustryWithTiles(world: RtWorld, industry: RtIndustry): void {
    const spec = RT_CATALOG.industries[RT_INDUSTRY_TYPE_IDS[industry.type]!]
    const map = world.map
    for (let y = 0; y < spec.height; y++) {
        for (let x = 0; x < spec.width; x++) {
            const tile = industry.origin + y * map.side + x
            if (map.kind[tile] === RtTileKind.station || map.kind[tile] === RtTileKind.industry) {
                throw new Error(`fixture industry ${industry.id} tile ${tile} is already a building`)
            }
            map.setTile(tile, RtTileKind.industry, RT_OWNER_NONE, industry.id)
        }
    }
    world.industries[industry.id] = industry
}
