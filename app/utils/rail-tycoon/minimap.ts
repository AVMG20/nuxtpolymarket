// Rail Tycoon — the minimap's projection and tile colours.

import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RT_OWNER_NONE } from '#shared/utils/rail-tycoon/types'
import type { RtWorld } from '#shared/utils/rail-tycoon/world'

/** Minimap width in CSS pixels; the height is half of it (the map is drawn as the main view's diamond). */
export const RT_MINIMAP_WIDTH = 512

/** CSS pixels per tile step along a map axis, so the whole map fills RT_MINIMAP_WIDTH. */
export function rtMinimapScale(side: number): number {
    return RT_MINIMAP_WIDTH / (2 * side)
}

/** World pixels per minimap pixel: the main view's tile is 64 wide, the minimap's 2 * scale. */
function worldPerPixel(side: number): number {
    return 32 / rtMinimapScale(side)
}

/** Where a main-view world point lies on the minimap (CSS pixels from its top-left). */
export function rtMinimapFromWorld(side: number, wx: number, wy: number): { x: number, y: number } {
    const k = worldPerPixel(side)
    return { x: wx / k + RT_MINIMAP_WIDTH / 2, y: wy / k }
}

/** The main-view world point under a minimap point (heights ignored). */
export function rtMinimapToWorld(side: number, mx: number, my: number): { x: number, y: number } {
    const k = worldPerPixel(side)
    return { x: (mx - RT_MINIMAP_WIDTH / 2) * k, y: my * k }
}

const GRASS_LOW = [0x4a, 0x7a, 0x2e]
const GRASS_HIGH = [0xa8, 0xc0, 0x6a]
const MINIMAP = {
    water: 0x2f5fa8,
    coast: 0xc8b878,
    tree: 0x2c5a1e,
    house: 0xb4a48c,
    townRoad: 0x9a9a9a,
    unknown: 0x6b6b6b
}
const INDUSTRY_COLOURS: Record<string, number> = {
    coalMine: 0x2a2a2a,
    powerStation: 0xc0392b,
    forest: 0x1e4d14,
    sawmill: 0xa0663a
}

function rgb(r: number, g: number, b: number): number {
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

/** A company's colour as 0xRRGGBB, grey for none. */
function ownerColour(world: RtWorld, owner: number): number {
    if (owner === RT_OWNER_NONE) return MINIMAP.townRoad
    const company = world.company(owner)
    return (company ? RT_CATALOG.companies.colours[company.colour] : undefined) ?? MINIMAP.unknown
}

/**
 * A tile's minimap colour (0xRRGGBB): grass shaded by height, water, coast, trees, houses,
 * industries by type, and rail, roads, stations and depots in their owner's colour (town roads grey).
 */
export function rtMinimapColour(world: RtWorld, tile: number): number {
    const map = world.map
    switch (map.kind[tile]) {
        case RtTileKind.water: return MINIMAP.water
        case RtTileKind.coast: return MINIMAP.coast
        case RtTileKind.tree: return MINIMAP.tree
        case RtTileKind.house: return MINIMAP.house
        case RtTileKind.industry: {
            const industry = world.industry(map.payload[tile]!)
            const type = industry ? RT_INDUSTRY_TYPE_IDS[industry.type] : undefined
            return (type ? INDUSTRY_COLOURS[type] : undefined) ?? MINIMAP.unknown
        }
        case RtTileKind.rail:
        case RtTileKind.road:
        case RtTileKind.station:
        case RtTileKind.depot:
            return ownerColour(world, map.owner[tile]!)
        default: {
            const t = Math.min(1, map.tileHeight(tile) / 10)
            return rgb(
                GRASS_LOW[0]! + (GRASS_HIGH[0]! - GRASS_LOW[0]!) * t,
                GRASS_LOW[1]! + (GRASS_HIGH[1]! - GRASS_LOW[1]!) * t,
                GRASS_LOW[2]! + (GRASS_HIGH[2]! - GRASS_LOW[2]!) * t
            )
        }
    }
}
