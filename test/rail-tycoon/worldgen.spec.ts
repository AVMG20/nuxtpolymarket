import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS } from '#shared/utils/rail-tycoon/catalog'
import { RT_DIRS, RT_ROAD_DIR_BIT, RtMap, RtTileKind, rtReverseDir } from '#shared/utils/rail-tycoon/map'
import { SeededRandom } from '#shared/utils/random'
import { RT_OWNER_NONE } from '#shared/utils/rail-tycoon/types'
import {
    RT_INDUSTRY_SPACING,
    RT_TERRAIN_DEFAULTS,
    RT_TOWN_SPACING,
    generateTerrain,
    generateWorld,
    placeTowns,
    rtDefaultWorldOptions,
    type RtWorldLayout
} from '#shared/utils/rail-tycoon/worldgen'

function layoutHash(layout: RtWorldLayout): string {
    const hash = createHash('sha1')
    const { map } = layout
    hash.update(map.heights)
    hash.update(map.kind)
    hash.update(map.owner)
    hash.update(new Uint8Array(map.payload.buffer))
    hash.update(JSON.stringify(layout.towns))
    hash.update(JSON.stringify(layout.industries))
    return hash.digest('hex')
}

function chebyshev(map: RtMap, a: number, b: number): number {
    return Math.max(Math.abs(map.tileX(a) - map.tileX(b)), Math.abs(map.tileY(a) - map.tileY(b)))
}

function footprint(map: RtMap, origin: number, type: number): number[] {
    const spec = RT_CATALOG.industries[RT_INDUSTRY_TYPE_IDS[type]!]
    const tiles: number[] = []
    for (let dy = 0; dy < spec.height; dy++) {
        for (let dx = 0; dx < spec.width; dx++) tiles.push(map.idx(map.tileX(origin) + dx, map.tileY(origin) + dy))
    }
    return tiles
}

const worlds = new Map<string, RtWorldLayout>()
/** Generate once per (seed, side) with default options; the tests below only read. */
function world(seed: number, side = 128): RtWorldLayout {
    const key = `${seed}:${side}`
    if (!worlds.has(key)) worlds.set(key, generateWorld(seed, rtDefaultWorldOptions(side)))
    return worlds.get(key)!
}

const SAMPLES: [number, number][] = [[1, 64], [2, 64], [42, 128], [7, 128], [99, 128], [3, 256]]

describe('rail tycoon world generation', () => {
    it('gives an identical world for the same seed and a different one for another seed', () => {
        const a = generateWorld(42, rtDefaultWorldOptions())
        const b = generateWorld(42, rtDefaultWorldOptions())
        expect(layoutHash(a)).toBe(layoutHash(b))
        expect(a.seed).toBe(42)
        expect(layoutHash(generateWorld(43, rtDefaultWorldOptions()))).not.toBe(layoutHash(a))
        expect(generateWorld(42)).toEqual(a)
    })

    it('generates byte-identical terrain from the same seed and options', () => {
        const run = () => {
            const map = new RtMap(64)
            generateTerrain(map, new SeededRandom(5), RT_TERRAIN_DEFAULTS)
            return map
        }
        const a = run()
        const b = run()
        expect(Buffer.from(a.heights).equals(Buffer.from(b.heights))).toBe(true)
        expect(Buffer.from(a.kind).equals(Buffer.from(b.kind))).toBe(true)
        expect(Buffer.from(a.payload.buffer).equals(Buffer.from(b.payload.buffer))).toBe(true)
    })

    it('keeps every pair of adjacent corners within one level and heights within 0 to 15', () => {
        for (const [seed, side] of SAMPLES) {
            const { map } = world(seed, side)
            const c = side + 1
            let worst = 0
            for (let cy = 0; cy < c; cy++) {
                for (let cx = 0; cx < c; cx++) {
                    const h = map.cornerHeight(cx, cy)
                    if (cx + 1 < c) worst = Math.max(worst, Math.abs(h - map.cornerHeight(cx + 1, cy)))
                    if (cy + 1 < c) worst = Math.max(worst, Math.abs(h - map.cornerHeight(cx, cy + 1)))
                }
            }
            expect(worst, `seed ${seed} side ${side}`).toBeLessThanOrEqual(1)
            expect(Math.max(...map.heights)).toBeLessThanOrEqual(15)
        }
    })

    it('covers 20 to 70 percent of the map with water on default options', () => {
        for (const [seed, side] of SAMPLES) {
            const { map } = world(seed, side)
            const water = map.kind.filter(k => k === RtTileKind.water).length
            const share = water / map.tileCount
            expect(share, `seed ${seed} side ${side}`).toBeGreaterThanOrEqual(0.2)
            expect(share, `seed ${seed} side ${side}`).toBeLessThanOrEqual(0.7)
        }
    })

    it('marks water at sea level, coast beside it, and grows trees only on dry inland tiles', () => {
        for (const [seed, side] of SAMPLES) {
            const { map } = world(seed, side)
            const wrong: string[] = []
            for (let i = 0; i < map.tileCount; i++) {
                const kind = map.kind[i]
                const x = map.tileX(i)
                const y = map.tileY(i)
                let touchesWater = false
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (map.inBounds(x + dx, y + dy) && map.kind[map.idx(x + dx, y + dy)] === RtTileKind.water) touchesWater = true
                    }
                }
                if ((kind === RtTileKind.water) !== (map.tileMaxHeight(i) === 0)) wrong.push(`${x},${y} water at height ${map.tileMaxHeight(i)}`)
                // coast is exactly the land touching water, so trees and towns never stand on it
                if (kind !== RtTileKind.water && (kind === RtTileKind.coast) !== touchesWater) wrong.push(`${x},${y} kind ${kind} beside water ${touchesWater}`)
            }
            expect(wrong, `seed ${seed} side ${side}`).toEqual([])
            expect(map.kind.some(k => k === RtTileKind.tree)).toBe(true)
            expect(map.kind.some(k => k === RtTileKind.coast)).toBe(true)
        }
    })

    it('founds towns on flat land, 12 tiles apart and from the edge, with unique names', () => {
        for (const [seed, side] of SAMPLES) {
            const { map, towns } = world(seed, side)
            expect(towns.length, `seed ${seed} side ${side}`).toBe(rtDefaultWorldOptions(side).towns)
            const names = new Set(towns.map(t => t.name))
            expect(names.size).toBe(towns.length)
            towns.forEach((town, k) => {
                expect(town.id).toBe(k)
                expect(town.name.length).toBeGreaterThan(0)
                expect(new TextEncoder().encode(town.name).length).toBeLessThanOrEqual(RT_CATALOG.caps.maxNameBytes)
                expect(map.kind[town.centre]).toBe(RtTileKind.road)
                expect(map.isFlat(town.centre)).toBe(true)
                expect(map.tileHeight(town.centre)).toBeGreaterThan(0)
                const x = map.tileX(town.centre)
                const y = map.tileY(town.centre)
                expect(Math.min(x, y, side - 1 - x, side - 1 - y)).toBeGreaterThanOrEqual(RT_TOWN_SPACING)
                for (const other of towns.slice(k + 1)) {
                    expect(chebyshev(map, town.centre, other.centre)).toBeGreaterThanOrEqual(RT_TOWN_SPACING)
                }
                expect(town.houseCount).toBeGreaterThan(0)
                expect(town.receivedThisMonth).toEqual([0, 0, 0, 0, 0])
                expect(town.growthCounter).toBe(RT_CATALOG.towns.initialGrowthTownTicks)
            })
        }
    })

    it('lays town roads and houses that agree with the town records', () => {
        for (const [seed, side] of SAMPLES) {
            const { map, towns } = world(seed, side)
            let houses = 0
            let population = 0
            for (let i = 0; i < map.tileCount; i++) {
                const kind = map.kind[i]
                if (kind === RtTileKind.house) {
                    houses++
                    population += RT_CATALOG.houses.classes[map.payload[i]!]!.population
                    expect(map.isFlat(i)).toBe(true)
                    expect(map.owner[i]).toBe(RT_OWNER_NONE)
                    expect(RT_DIRS.some(dir => map.kind[map.neighbour(i, dir)] === RtTileKind.road)).toBe(true)
                }
                if (kind === RtTileKind.road) {
                    expect(map.owner[i]).toBe(RT_OWNER_NONE)
                    expect(map.payload[i]).toBeGreaterThan(0)
                    // every road bit leads to a road that points back
                    for (const dir of RT_DIRS) {
                        if (!(map.payload[i]! & RT_ROAD_DIR_BIT[dir]!)) continue
                        const n = map.neighbour(i, dir)
                        expect(map.kind[n]).toBe(RtTileKind.road)
                        expect(map.payload[n]! & RT_ROAD_DIR_BIT[rtReverseDir(dir)]!).toBeTruthy()
                    }
                }
            }
            expect(houses).toBe(towns.reduce((sum, t) => sum + t.houseCount, 0))
            expect(population).toBe(towns.reduce((sum, t) => sum + t.population, 0))
        }
    })

    it('places every industry type on a 128 map', () => {
        for (const seed of [42, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
            const types = new Set(world(seed).industries.map(ind => ind.type))
            expect(types.size, `seed ${seed}`).toBe(RT_INDUSTRY_TYPE_IDS.length)
        }
    })

    it('keeps industry footprints flat, off water, roads and houses, and spaced from towns and each other', () => {
        for (const [seed, side] of SAMPLES) {
            const { map, industries } = world(seed, side)
            const claimed = new Map<number, number>()
            industries.forEach((industry, k) => {
                expect(industry.id).toBe(k)
                const tiles = footprint(map, industry.origin, industry.type)
                const height = map.tileHeight(industry.origin)
                for (const tile of tiles) {
                    expect(claimed.has(tile)).toBe(false)
                    claimed.set(tile, industry.id)
                    expect(map.kind[tile]).toBe(RtTileKind.industry)
                    expect(map.payload[tile]).toBe(industry.id)
                    expect(map.isFlat(tile)).toBe(true)
                    expect(map.tileHeight(tile)).toBe(height)
                    expect(height).toBeGreaterThan(0)
                }
            })
            // no road, house or other industry's tile within the spacing of any footprint tile
            const crowded: string[] = []
            for (const [tile, id] of claimed) {
                const x = map.tileX(tile)
                const y = map.tileY(tile)
                const reach = RT_INDUSTRY_SPACING - 1
                for (let dy = -reach; dy <= reach; dy++) {
                    for (let dx = -reach; dx <= reach; dx++) {
                        if (!map.inBounds(x + dx, y + dy)) continue
                        const n = map.idx(x + dx, y + dy)
                        const kind = map.kind[n]
                        if (kind === RtTileKind.road || kind === RtTileKind.house || (kind === RtTileKind.industry && claimed.get(n) !== id)) {
                            crowded.push(`industry ${id} near ${map.tileX(n)},${map.tileY(n)} kind ${kind}`)
                        }
                    }
                }
            }
            expect(crowded, `seed ${seed} side ${side}`).toEqual([])
            // every industry tile on the map belongs to a listed footprint
            expect(map.kind.filter(k => k === RtTileKind.industry).length).toBe(claimed.size)
        }
    })

    it('places fewer towns rather than crowding them when space runs out', () => {
        const map = new RtMap(64)
        generateTerrain(map, new SeededRandom(11), RT_TERRAIN_DEFAULTS)
        const towns = placeTowns(map, new SeededRandom(12), 64)
        expect(towns.length).toBeGreaterThan(0)
        expect(towns.length).toBeLessThan(64)
        for (const a of towns) {
            for (const b of towns) if (a !== b) expect(chebyshev(map, a.centre, b.centre)).toBeGreaterThanOrEqual(RT_TOWN_SPACING)
        }
    })

    it('rejects bad seeds and options with RangeError', () => {
        const bad: [number, Parameters<typeof generateWorld>[1]][] = [
            [-1, { side: 128 }],
            [2 ** 32, { side: 128 }],
            [1.5, { side: 128 }],
            [1, { side: 100 }],
            [1, { side: 512 }],
            [1, { side: 128, towns: -1 }],
            [1, { side: 128, towns: RT_CATALOG.caps.maxTowns + 1 }],
            [1, { side: 128, towns: 2.5 }],
            [1, { side: 128, industryDensity: 5 }],
            [1, { side: 128, industryDensity: -1 }]
        ]
        for (const [seed, options] of bad) expect(() => generateWorld(seed, options)).toThrow(RangeError)
        expect(generateWorld(1, { side: 64, towns: 0, industryDensity: 0 }).industries).toEqual([])
    })

    it('logs generation time per map side', () => {
        for (const side of [64, 128, 256]) {
            const start = performance.now()
            generateWorld(1000 + side, rtDefaultWorldOptions(side))
            console.log(`generateWorld side ${side}: ${(performance.now() - start).toFixed(1)} ms`)
        }
    })
})
