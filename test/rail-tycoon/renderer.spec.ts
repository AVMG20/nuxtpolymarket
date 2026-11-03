import { describe, expect, it } from 'vitest'
import { RtMap, RtTileKind, rtTreePayload } from '#shared/utils/rail-tycoon/map'
import { rtDepotPayload } from '#shared/utils/rail-tycoon/depots'
import { RT_RAIL_SIDING } from '#shared/utils/rail-tycoon/sidings'
import { RtAxis, RtStationTile, rtBayLane, rtBayPayload, rtStationPayload } from '#shared/utils/rail-tycoon/stations-build'
import { RT_BAY_STOP } from '#shared/utils/rail-tycoon/road-vehicle'
import {
    RT_SIGNAL_ASPECT_SHIFT,
    RT_SIGNAL_PATH,
    RT_SIGNAL_PRESENCE_SHIFT,
    RtTrack,
    RtTrackdir,
    rtCrossingPayload,
    rtRailPayload,
    rtWithSignalSlot
} from '#shared/utils/rail-tycoon/track'
import { RT_OWNER_NONE, RtVehicleKind, RtVehicleState, type RtCompany, type RtIndustry, type RtStation, type RtVehicle } from '#shared/utils/rail-tycoon/types'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RT_CAMERA_ZOOMS, rtForEachTileInRange, rtTileToWorld, type RtTileRange } from '../../app/utils/rail-tycoon/camera'
import {
    rtGroundDepth,
    rtGrowRange,
    rtObjectDepth,
    rtPartDepth,
    rtRangeArea,
    rtRangeContains,
    rtRenderResolution,
    rtSignalPoint,
    rtSurfaceHeight,
    rtTileInRange
} from '../../app/utils/rail-tycoon/render-space'
import { rtIsParkingSpot, rtTileDrawList, type RtDrawItem, type RtDrawWorld, type RtSpriteLookup } from '../../app/utils/rail-tycoon/tile-draw'
import {
    RT_FLOAT_MAX,
    RT_FLOAT_MS,
    RT_FLOAT_RISE,
    RtFloatTexts,
    rtFloatLook,
    rtFormatIncome,
    rtVehicleBadge,
    rtVehicleParts
} from '../../app/utils/rail-tycoon/vehicle-draw'

const lookup: RtSpriteLookup = {
    meta: { industryLayouts: { coalMine: [[1, 1, 0], [2, 2, 3]] } },
    has: () => true,
    variantCount: prefix => (prefix === 'house.small' ? 8 : 3),
    get: name => ({
        layer: /\.(front|b|c)$/.test(name) || name === 'depot.rail.ne.building'
            ? 'front'
            : /\.(rear|a)$/.test(name) || name === 'depot.rail.se.building' ? 'rear' : null
    })
}

interface Fixture {
    world: RtDrawWorld
    map: RtMap
    trains: Set<number>
    stations: Map<number, RtStation>
    industries: Map<number, RtIndustry>
}

function fixture(): Fixture {
    const map = new RtMap(64)
    const trains = new Set<number>()
    const stations = new Map<number, RtStation>()
    const industries = new Map<number, RtIndustry>()
    const company = { id: 0, colour: 3 } as RtCompany
    const world: RtDrawWorld = {
        map,
        company: id => (id === 0 ? company : undefined),
        industry: id => industries.get(id),
        station: id => stations.get(id),
        occupied: { trainOnPiece: (tile, piece) => trains.has(tile * 8 + piece) }
    }
    return { world, map, trains, stations, industries }
}

const names = (items: RtDrawItem[], ground: boolean) => items.filter(item => item.ground === ground).map(item => item.name)

function train(partial: Partial<RtVehicle>): RtVehicle {
    return {
        kind: RtVehicleKind.rail,
        owner: 0,
        model: 0,
        consist: [0],
        tiles: [],
        pieces: [],
        progress: 0,
        state: RtVehicleState.driving,
        stopped: false,
        cargo: [],
        ...partial
    } as RtVehicle
}

describe('resolution and ranges', () => {
    it('renders at the device pixel ratio, never below 1', () => {
        expect(rtRenderResolution(1)).toBe(1)
        expect(rtRenderResolution(0.5)).toBe(1)
        expect(rtRenderResolution(undefined)).toBe(1)
        expect(rtRenderResolution(Number.NaN)).toBe(1)
        expect(rtRenderResolution(2)).toBe(2)
        expect(rtRenderResolution(3)).toBe(3)
    })

    it('gives a world pixel a whole number of canvas pixels at every zoom (no seams at 0.5x)', () => {
        for (const dpr of [1, 1.25, 1.5, 2, 2.25, 3]) {
            for (const zoom of RT_CAMERA_ZOOMS) {
                const resolution = rtRenderResolution(dpr, zoom)
                expect(resolution).toBeGreaterThanOrEqual(dpr)
                expect(Number.isInteger(resolution * zoom)).toBe(true)
                // never more than one step above what the ratio needs
                expect(resolution * zoom - dpr * zoom).toBeLessThan(1)
            }
        }
        expect(rtRenderResolution(1, 0.5)).toBe(2)
        expect(rtRenderResolution(2, 0.5)).toBe(2)
        expect(rtRenderResolution(1, 4)).toBe(1)
        expect(rtRenderResolution(1.25)).toBe(2)
    })

    it('grows, contains and measures ranges as rtForEachTileInRange walks them', () => {
        const range: RtTileRange = { sMin: 10, sMax: 30, dMin: -6, dMax: 8 }
        const grown = rtGrowRange(range, 4)
        expect(grown).toEqual({ sMin: 6, sMax: 34, dMin: -10, dMax: 12 })
        expect(rtRangeContains(grown, range)).toBe(true)
        expect(rtRangeContains(range, grown)).toBe(false)
        let count = 0
        rtForEachTileInRange(range, 64, (x, y) => {
            count++
            expect(rtTileInRange(range, x, y)).toBe(true)
        })
        // well inside the map every other cell of the s by d box holds a tile
        expect(Math.abs(count - rtRangeArea(range))).toBeLessThanOrEqual(11)
        expect(rtTileInRange(range, 0, 0)).toBe(false)
    })
})

describe('depth', () => {
    it('sorts everything of a tile row after the row behind and before the row in front', () => {
        const x = 12
        const y = 9
        const rear = rtPartDepth(x, y, 'rear')
        const front = rtPartDepth(x, y, 'front')
        for (const [lx, ly] of [[0, 0], [1, 1], [0.5, 0.5], [0, 1], [1, 0]] as const) {
            const vehicle = rtObjectDepth(x, y, lx, ly)
            expect(vehicle).toBeGreaterThan(rear)
            expect(vehicle).toBeLessThan(front)
            expect(vehicle).toBeGreaterThan(rtPartDepth(x - 1, y, 'front'))
            expect(vehicle).toBeLessThan(rtPartDepth(x + 1, y, 'rear'))
            expect(vehicle).toBeLessThan(rtObjectDepth(x, y + 1, 0, 0))
        }
        expect(rtGroundDepth(x, y, 15)).toBeLessThan(rtGroundDepth(x + 1, y, 0))
        expect(rtGroundDepth(x, y, 0)).toBeLessThan(rtGroundDepth(x, y, 1))
    })

    it('interpolates the land over the two triangles of a tile', () => {
        const corners: [number, number, number, number] = [0, 1, 0, 1]
        expect(rtSurfaceHeight(corners, 0, 0)).toBe(0)
        expect(rtSurfaceHeight(corners, 1, 0)).toBe(1)
        expect(rtSurfaceHeight(corners, 0, 1)).toBe(0)
        expect(rtSurfaceHeight(corners, 1, 1)).toBe(1)
        expect(rtSurfaceHeight(corners, 0.5, 0.25)).toBeCloseTo(0.5)
    })
})

describe('rtTileDrawList', () => {
    it('draws clear land as one terrain sprite at the north corner', () => {
        const { world, map } = fixture()
        const tile = map.idx(5, 7)
        const items = rtTileDrawList(world, tile, lookup)
        expect(items).toHaveLength(1)
        const at = rtTileToWorld(5, 7, 0)
        expect(items[0]).toMatchObject({ name: 'terrain.grass.flat', ground: true, colour: -1, wx: at.x, wy: at.y })
    })

    it('draws water at the current frame and marks it animated', () => {
        const { world, map } = fixture()
        const tile = map.idx(3, 3)
        map.setTile(tile, RtTileKind.water, RT_OWNER_NONE, 0)
        const [item] = rtTileDrawList(world, tile, lookup, 5)
        expect(item).toMatchObject({ name: 'water.5', water: { coast: null } })
    })

    it('draws track and its signals with aspect, type and facing', () => {
        const { world, map } = fixture()
        const tile = map.idx(20, 20)
        const block = RtTrack.x | (1 << RT_SIGNAL_PRESENCE_SHIFT) | (1 << RT_SIGNAL_ASPECT_SHIFT)
        map.setTile(tile, RtTileKind.rail, 0, rtWithSignalSlot(rtRailPayload(1 << RtTrack.x), 0, block))
        let items = rtTileDrawList(world, tile, lookup)
        expect(names(items, true)).toEqual(['rail.flat.x'])
        expect(names(items, false)).toEqual(['signal.block.to-ne.green'])

        const twoWay = RtTrack.x | RT_SIGNAL_PATH | (3 << RT_SIGNAL_PRESENCE_SHIFT) | (2 << RT_SIGNAL_ASPECT_SHIFT)
        map.payload[tile] = rtWithSignalSlot(rtRailPayload(1 << RtTrack.x), 0, twoWay)
        items = rtTileDrawList(world, tile, lookup)
        expect(names(items, false)).toEqual(['signal.path.to-ne.red', 'signal.path.to-sw.green'])

        const oneWay = RtTrack.x | RT_SIGNAL_PATH | (2 << RT_SIGNAL_PRESENCE_SHIFT)
        map.payload[tile] = rtWithSignalSlot(rtRailPayload(1 << RtTrack.x), 0, oneWay)
        items = rtTileDrawList(world, tile, lookup)
        expect(names(items, false)).toEqual(['signal.path-oneway.to-sw.red'])
    })

    it('draws a junction as ground plus one overlay per piece', () => {
        const { world, map } = fixture()
        const tile = map.idx(9, 9)
        map.setTile(tile, RtTileKind.rail, 0, rtRailPayload((1 << RtTrack.x) | (1 << RtTrack.upper)))
        expect(names(rtTileDrawList(world, tile, lookup), true)).toEqual(['rail.junction.no-se', 'rail.overlay.x', 'rail.overlay.n'])
    })

    it('draws a straight on its ramp with the sloped track sprite', () => {
        const { world, map } = fixture()
        // north and east corners raised: the ne ramp, which the x piece climbs
        map.setCornerHeight(30, 30, 1)
        map.setCornerHeight(30, 31, 1)
        const tile = map.idx(30, 30)
        map.setTile(tile, RtTileKind.rail, 0, rtRailPayload(1 << RtTrack.x))
        const items = rtTileDrawList(world, tile, lookup)
        expect(names(items, true)).toEqual(['rail.slope.ne'])
    })

    it('closes a level crossing while a train holds it', () => {
        const { world, map, trains } = fixture()
        const tile = map.idx(14, 15)
        map.setTile(tile, RtTileKind.rail, 0, rtCrossingPayload(RtTrack.x, RT_OWNER_NONE))
        expect(names(rtTileDrawList(world, tile, lookup), true)).toEqual(['crossing.town.x'])
        trains.add(tile * 8 + RtTrack.x)
        expect(names(rtTileDrawList(world, tile, lookup), true)).toEqual(['crossing.town.x-closed'])
    })

    it('stands each tree of a forest tile inside the tile, in front of its ground', () => {
        const { world, map } = fixture()
        const tile = map.idx(40, 41)
        map.setTile(tile, RtTileKind.tree, RT_OWNER_NONE, rtTreePayload(4, 3, 3))
        const items = rtTileDrawList(world, tile, lookup)
        expect(names(items, true)).toEqual(['terrain.grass.flat'])
        const trees = items.filter(item => !item.ground)
        expect(trees.map(item => item.name)).toEqual(['tree.4.3', 'tree.4.3', 'tree.4.3'])
        for (const item of trees) {
            expect(item.z).toBeGreaterThan(rtPartDepth(40, 41, 'rear'))
            expect(item.z).toBeLessThan(rtPartDepth(40, 41, 'front'))
            expect(Number.isInteger(item.wx) && Number.isInteger(item.wy)).toBe(true)
        }
        expect(rtTileDrawList(world, tile, lookup)).toEqual(items)
    })

    it('picks a house variant from the tile, the same every time', () => {
        const { world, map } = fixture()
        const tile = map.idx(8, 50)
        map.setTile(tile, RtTileKind.house, RT_OWNER_NONE, 0)
        const items = rtTileDrawList(world, tile, lookup)
        expect(items).toHaveLength(1)
        expect(items[0]!.name).toMatch(/^house\.small\.[0-7]$/)
        expect(rtTileDrawList(world, tile, lookup)[0]!.name).toBe(items[0]!.name)
    })

    it('draws an industry tile from its place in the layout, and plain ground off it', () => {
        const { world, map, industries } = fixture()
        industries.set(2, { id: 2, type: 0, origin: map.idx(10, 10) } as RtIndustry)
        map.setTile(map.idx(11, 11), RtTileKind.industry, RT_OWNER_NONE, 2)
        map.setTile(map.idx(10, 11), RtTileKind.industry, RT_OWNER_NONE, 2)
        expect(names(rtTileDrawList(world, map.idx(11, 11), lookup), false)).toEqual(['industry.coalMine.0'])
        expect(names(rtTileDrawList(world, map.idx(10, 11), lookup), true)).toEqual(['terrain.grass.flat'])
    })

    it('draws platforms in the owner colour around the vehicles, with the building on the sign tile', () => {
        const { world, map, stations } = fixture()
        const sign = map.idx(20, 30)
        const other = map.idx(21, 30)
        stations.set(4, { id: 4, owner: 0, sign } as RtStation)
        for (const tile of [sign, other]) map.setTile(tile, RtTileKind.station, 0, rtStationPayload(4, RtStationTile.rail, RtAxis.x))
        const items = rtTileDrawList(world, sign, lookup)
        expect(items.filter(item => item.ground)).toMatchObject([{ name: 'rail.flat.x', colour: -1 }])
        expect(items.filter(item => !item.ground)).toMatchObject([
            { name: 'station.rail.x.building.rear', colour: 3, z: rtPartDepth(20, 30, 'rear') },
            { name: 'station.rail.x.building.front', colour: 3, z: rtPartDepth(20, 30, 'front') }
        ])
        expect(names(rtTileDrawList(world, other, lookup), false)).toEqual(['station.rail.x.plain.rear', 'station.rail.x.plain.front'])
    })

    it('draws a road stop and a depot from their parts', () => {
        const { world, map } = fixture()
        const stop = map.idx(2, 2)
        // a drive-through stop: its straight road under the nw bay's shelters
        map.setTile(stop, RtTileKind.station, 0, rtStationPayload(1, RtStationTile.bus, RtAxis.y))
        expect(names(rtTileDrawList(world, stop, lookup), true)).toEqual(['road.grass.se-nw'])
        expect(names(rtTileDrawList(world, stop, lookup), false)).toEqual(['roadstop.bus.nw.a', 'roadstop.bus.nw.b', 'roadstop.bus.nw.c'])
        map.setTile(stop, RtTileKind.station, 0, rtStationPayload(1, RtStationTile.truck, RtAxis.x, RT_OWNER_NONE))
        expect(names(rtTileDrawList(world, stop, lookup), true)).toEqual(['road.town.ne-sw'])
        expect(names(rtTileDrawList(world, stop, lookup), false)).toEqual(['roadstop.truck.ne.a', 'roadstop.truck.ne.c'])
        // a bay: its own ground and parts by its entrance, all three parts
        for (const [facing, side] of [[0, 'ne'], [1, 'se'], [2, 'sw'], [3, 'nw']] as const) {
            map.setTile(stop, RtTileKind.station, 0, rtBayPayload(1, RtStationTile.truck, facing, 0))
            expect(names(rtTileDrawList(world, stop, lookup), true)).toEqual([`roadstop.truck.${side}.ground`])
            expect(names(rtTileDrawList(world, stop, lookup), false)).toEqual(['a', 'b', 'c'].map(part => `roadstop.truck.${side}.${part}`))
        }
        const depot = map.idx(4, 2)
        map.setTile(depot, RtTileKind.depot, 0, rtDepotPayload(RtVehicleKind.rail, 1))
        const items = rtTileDrawList(world, depot, lookup)
        expect(names(items, true)).toEqual(['depot.rail.se.ground'])
        expect(items.filter(item => !item.ground)).toMatchObject([
            { name: 'depot.rail.se.building', colour: 3, z: rtPartDepth(4, 2, 'rear') },
            { name: 'depot.rail.se.front', colour: 3, z: rtPartDepth(4, 2, 'front') }
        ])
    })

    it('knows a parking spot by its dead-end flag', () => {
        const { map } = fixture()
        const tile = map.idx(6, 6)
        map.setTile(tile, RtTileKind.rail, 0, rtRailPayload(1 << RtTrack.y))
        expect(rtIsParkingSpot(map, tile)).toBe(false)
        map.payload[tile] = (map.payload[tile]! | RT_RAIL_SIDING) >>> 0
        expect(rtIsParkingSpot(map, tile)).toBe(true)
    })
})

describe('signal and vehicle positions', () => {
    it('stands a signal inside its tile, on the right of the trains it governs', () => {
        for (let td = 0; td < 14; td++) {
            if ((td & 7) >= 6) continue
            const p = rtSignalPoint(td)
            expect(p.x).toBeGreaterThan(0)
            expect(p.x).toBeLessThan(1)
            expect(p.y).toBeGreaterThan(0)
            expect(p.y).toBeLessThan(1)
        }
        // travelling +x (south-west, down-left on screen): its right is -y (up-left)
        expect(rtSignalPoint(RtTrackdir.xSw).y).toBeLessThan(0.5)
        expect(rtSignalPoint(RtTrackdir.xNe).y).toBeGreaterThan(0.5)
    })

    it('spaces a train\'s parts half a tile apart back along the tiles it holds', () => {
        const { map } = fixture()
        const head = map.idx(10, 10)
        const back = map.idx(9, 10)
        const half = RT_CATALOG.movement.subTileUnits / 2
        const vehicle = train({ consist: [0, 3, 3], tiles: [head, back], pieces: [RtTrackdir.xSw, RtTrackdir.xSw], progress: half })
        const parts = rtVehicleParts(map, vehicle)
        expect(parts.map(p => [p.index, p.tile, p.lx, p.ly, p.direction])).toEqual([
            [0, head, 0.25, 0.5, 5],
            [1, back, 0.75, 0.5, 5],
            [2, back, 0.25, 0.5, 5]
        ])
        const depth = parts.map(p => rtObjectDepth(map.tileX(p.tile), map.tileY(p.tile), p.lx, p.ly))
        expect(depth[0]).toBeGreaterThan(depth[1]!)
        expect(depth[1]).toBeGreaterThan(depth[2]!)
    })

    it('keeps the last parts at the start of the last tile it holds', () => {
        const { map } = fixture()
        const vehicle = train({ consist: [0, 3, 3, 3], tiles: [map.idx(10, 10)], pieces: [RtTrackdir.ySe], progress: 3000 })
        const parts = rtVehicleParts(map, vehicle)
        expect(parts).toHaveLength(4)
        expect(parts[3]!.ly).toBe(0)
    })

    it('drives a road vehicle in the right-hand lane at its progress', () => {
        const { map } = fixture()
        const tile = map.idx(5, 5)
        const bus = train({ kind: RtVehicleKind.road, consist: [7], tiles: [tile], pieces: [1], progress: RT_CATALOG.movement.subTileUnits / 2 })
        const [part] = rtVehicleParts(map, bus)
        // heading south-east (+y): the right-hand lane is +x
        expect(part).toMatchObject({ tile, ly: 0.5, direction: 3 })
        expect(part!.lx).toBeGreaterThan(0.5)
    })

    it('draws a road vehicle in a bay inside the bay: in towards the halt, beside the other bay, and back out', () => {
        const { map } = fixture()
        const tile = map.idx(5, 5)
        const TILE = RT_CATALOG.movement.subTileUnits
        // a bay whose entrance faces south-west (+x): bay 0 lies towards nw (-y), bay 1 towards se (+y)
        map.setTile(tile, RtTileKind.station, 0, rtBayPayload(1, RtStationTile.bus, 2, 0))
        const at = (slot: number, progress: number) => rtVehicleParts(map, train({
            kind: RtVehicleKind.road, consist: [7], tiles: [tile], pieces: [rtBayLane(2, slot)], progress
        }))[0]!
        const entering = at(0, 0)
        const halted = at(0, RT_BAY_STOP)
        const other = at(1, RT_BAY_STOP)
        const leaving = at(0, TILE - 1)
        expect(entering.tile).toBe(tile)
        // in from the entrance edge (x = 1) towards the back, facing in (north-east, -x), out facing south-west
        expect(entering.lx).toBeGreaterThan(0.9)
        expect(halted.lx).toBeLessThan(0.5)
        expect(halted.direction).toBe(1 + 2 * 0)
        expect(leaving.direction).toBe(1 + 2 * 2)
        expect(leaving.lx).toBeGreaterThan(0.9)
        // the two bays side by side, both inside the tile
        expect(halted.ly).toBeLessThan(0.5)
        expect(other.ly).toBeGreaterThan(0.5)
        expect(other.lx).toBe(halted.lx)
        for (const part of [entering, halted, other, leaving]) {
            expect(part.lx).toBeGreaterThanOrEqual(0)
            expect(part.lx).toBeLessThanOrEqual(1)
            expect(part.ly).toBeGreaterThan(0)
            expect(part.ly).toBeLessThan(1)
        }
    })

    it('badges a parked train and one still looking for a spot', () => {
        expect(rtVehicleBadge(train({ state: RtVehicleState.parked, stopped: true }))).toBe('parked')
        expect(rtVehicleBadge(train({ state: RtVehicleState.parking, stopped: true }))).toBe('parking')
        expect(rtVehicleBadge(train({ state: RtVehicleState.driving, stopped: true }))).toBe('parking')
        expect(rtVehicleBadge(train({ state: RtVehicleState.driving }))).toBeNull()
        expect(rtVehicleBadge(train({ state: RtVehicleState.inDepot, stopped: true }))).toBeNull()
        expect(rtVehicleBadge(train({ kind: RtVehicleKind.road, state: RtVehicleState.driving, stopped: true }))).toBeNull()
    })
})

describe('income floats', () => {
    it('rises and fades over 2 s, then goes', () => {
        expect(rtFloatLook(0)).toEqual({ rise: 0, alpha: 1 })
        expect(rtFloatLook(RT_FLOAT_MS / 2)).toEqual({ rise: RT_FLOAT_RISE / 2, alpha: 1 })
        const late = rtFloatLook(RT_FLOAT_MS * 0.75)!
        expect(late.alpha).toBeCloseTo(0.5)
        expect(late.rise).toBeCloseTo(RT_FLOAT_RISE * 0.75)
        expect(rtFloatLook(RT_FLOAT_MS)).toBeNull()
    })

    it('keeps a payment for its lifetime and drops it after', () => {
        const floats = new RtFloatTexts()
        expect(floats.add({ tile: 10, amount: 0, company: 0 }, 0)).toBeNull()
        const first = floats.add({ tile: 10, amount: 1234, company: 0 }, 100)
        floats.add({ tile: 11, amount: 50, company: 1 }, 1500)
        expect(floats.prune(2000)).toEqual([])
        expect(floats.prune(2100)).toEqual([first])
        expect(floats.items.map(f => f.tile)).toEqual([11])
        expect(floats.prune(3500)).toHaveLength(1)
        expect(floats.items).toEqual([])
    })

    it('holds at most RT_FLOAT_MAX at once, dropping the oldest', () => {
        const floats = new RtFloatTexts()
        for (let k = 0; k < RT_FLOAT_MAX + 5; k++) floats.add({ tile: k, amount: 10, company: 0 }, k)
        expect(floats.items).toHaveLength(RT_FLOAT_MAX)
        expect(floats.items[0]!.tile).toBe(5)
    })

    it('formats the amount in pounds', () => {
        expect(rtFormatIncome(1234)).toBe('+£1,234')
        expect(rtFormatIncome(7.6)).toBe('+£8')
    })
})
