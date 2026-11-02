import { describe, expect, it } from 'vitest'
import { RT_CATALOG } from '#shared/utils/rail-tycoon/catalog'
import { RtCommandError, RtCommandKind, applyCommand, rtRailLineWalk, type RtCommand } from '#shared/utils/rail-tycoon/commands'
import { RtDir, RtMap, RtTileKind } from '#shared/utils/rail-tycoon/map'
import { RtSignalType, rtSignalTypeAt } from '#shared/utils/rail-tycoon/signals'
import { RtAxis, RtRoadStopShape, RtStationTile } from '#shared/utils/rail-tycoon/stations-build'
import { RT_ROAD_Y, RtTrack, rtRailTilePieces, rtTrackdirOf } from '#shared/utils/rail-tycoon/track'
import { RtVehicleKind } from '#shared/utils/rail-tycoon/types'
import { RtWorld, rtNewCompany, rtStartDate } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { RT_CAMERA_ZOOMS, RtCamera, rtTileCorners } from '../../app/utils/rail-tycoon/camera'
import { RtRailDirection, RtRoadDirection, RtToolKind, RtTools, rtPointerTile, rtRailDrag, type RtPicked, type RtToolPreview } from '../../app/utils/rail-tycoon/tools'

/** A flat world: company 0 is the player, company 1 a rival. */
function flatWorld(side = 128, sharing = false): RtWorld {
    const w = new RtWorld({
        settings: { side, maxCompanies: 8, sharing }, map: new RtMap(side), rngState: 3, tick: 0, date: rtStartDate(),
        pathfinderCursor: 0, companies: [rtNewCompany(0, 'Player', 0, 0), rtNewCompany(1, 'Rival', 1, 0)],
        towns: [], industries: [], stations: [], vehicles: []
    })
    w.company(0)!.money = 1e9
    w.company(1)!.money = 1e9
    return w
}

/** Tools on a world for company 0, recording what they emit. */
function rig(w: RtWorld, company = 0) {
    const tools = new RtTools({ world: () => w, company: () => company })
    const commands: RtCommand[] = []
    const queries: number[] = []
    const picks: RtPicked[] = []
    let pickEnds = 0
    let preview: RtToolPreview | null = null
    tools.on('command', c => commands.push(c))
    tools.on('query', t => queries.push(t))
    tools.on('picked', p => picks.push(p))
    tools.on('pickEnd', () => pickEnds++)
    tools.on('preview', p => (preview = p))
    return { tools, commands, queries, picks, pickEnds: () => pickEnds, preview: () => preview }
}

function drag(tools: RtTools, from: number, to: number): void {
    tools.pointerDown(from)
    tools.pointerMove(to)
    tools.pointerUp(to)
}

function must(w: RtWorld, company: number, command: RtCommand) {
    const result = applyCommand(w, company, command, true)
    if (!result.ok) throw new Error(`command ${command.kind} refused (${result.error})`)
    return result
}

describe('RtTools', () => {
    it('picks the tile under the pointer on a hilly map at every zoom', () => {
        const layout = generateWorld(7, { side: 64 })
        const map = layout.map
        for (const zoom of RT_CAMERA_ZOOMS) {
            const camera = new RtCamera({ width: 4000, height: 3000, zoom, mapSide: 64 })
            camera.centreOnTile(32, 32)
            let exact = 0
            let tried = 0
            for (let y = 20; y < 44; y += 3) {
                for (let x = 20; x < 44; x += 3) {
                    const [n, wc, e, s] = rtTileCorners(map, x, y)
                    const p = camera.tileToScreen(x + 0.5, y + 0.5, (n + wc + e + s) / 4)
                    const hit = rtPointerTile(camera, map, p.x, p.y)
                    expect(hit).not.toBeNull()
                    tried++
                    if (hit!.tile === map.idx(x, y)) {
                        exact++
                        expect(hit!.at.fx).toBeGreaterThan(0.2)
                        expect(hit!.at.fx).toBeLessThan(0.8)
                    } else {
                        // only a tile in front, standing higher, may cover it
                        expect(map.tileX(hit!.tile) + map.tileY(hit!.tile)).toBeGreaterThan(x + y)
                    }
                }
            }
            expect(exact / tried).toBeGreaterThan(0.9)
        }
    })

    it('a 100-tile straight rail drag emits exactly one buildRailLine reaching the end tile', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        drag(r.tools, w.map.idx(10, 20), w.map.idx(110, 20))
        expect(r.commands).toEqual([{ kind: RtCommandKind.buildRailLine, tile: w.map.idx(10, 20), endTile: w.map.idx(110, 20), trackdir: rtTrackdirOf(RtTrack.x, true) }])
        expect(r.preview()).toBeNull()
        must(w, 0, r.commands[0]!)
        expect(rtRailTilePieces(w.map, w.map.idx(60, 20))).toBe(1 << RtTrack.x)
    })

    it('a fixed track direction lays only its own pieces, on a click and along any drag', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.options.railDirection = RtRailDirection.y
        r.tools.select(RtToolKind.rail)
        // a drag that autorail would lay along x still goes along y
        drag(r.tools, w.map.idx(20, 20), w.map.idx(40, 22))
        const line = r.commands[0] as Extract<RtCommand, { kind: typeof RtCommandKind.buildRailLine }>
        expect(line.trackdir & 7).toBe(RtTrack.y)

        r.tools.options.railDirection = RtRailDirection.horizontal
        drag(r.tools, w.map.idx(60, 60), w.map.idx(70, 70))
        const diagonal = r.commands[1] as Extract<RtCommand, { kind: typeof RtCommandKind.buildRailLine }>
        const walk = rtRailLineWalk(w.map, diagonal.tile, diagonal.trackdir, 256)
        for (const step of walk.slice(0, 4)) expect([RtTrack.upper, RtTrack.lower]).toContain(step.piece)

        // a click in the tile's centre, on the x and y lines, still lays a vertical piece
        r.tools.options.railDirection = RtRailDirection.vertical
        const tile = w.map.idx(90, 90)
        r.tools.pointerDown(tile)
        r.tools.pointerUp(tile)
        const click = r.commands[2] as Extract<RtCommand, { kind: typeof RtCommandKind.buildRail }>
        expect(click.kind).toBe(RtCommandKind.buildRail)
        expect([RtTrack.left, RtTrack.right]).toContain(click.piece)
    })

    it('a fixed road axis holds the drag to that axis, and a click builds its straight piece', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.options.roadDirection = RtRoadDirection.y
        r.tools.select(RtToolKind.road)
        // autoroad would follow the longer x drag; the y axis keeps the start column
        drag(r.tools, w.map.idx(20, 20), w.map.idx(30, 23))
        expect(r.commands[0]).toEqual({ kind: RtCommandKind.buildRoadLine, tile: w.map.idx(20, 20), endTile: w.map.idx(20, 23) })
        r.tools.pointerDown(w.map.idx(50, 50))
        r.tools.pointerUp(w.map.idx(50, 50))
        expect(r.commands[1]).toEqual({ kind: RtCommandKind.buildRoad, tile: w.map.idx(50, 50), bits: RT_ROAD_Y })
    })

    it('a slightly crooked drag snaps to the straight line; a diagonal drag lays alternating pieces', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        drag(r.tools, w.map.idx(30, 30), w.map.idx(30, 50))
        drag(r.tools, w.map.idx(40, 40), w.map.idx(52, 41))
        drag(r.tools, w.map.idx(60, 60), w.map.idx(70, 70))
        expect(r.commands.length).toBe(3)
        const [down, crooked, diagonal] = r.commands as Extract<RtCommand, { kind: typeof RtCommandKind.buildRailLine }>[]
        expect(down!.endTile).toBe(w.map.idx(30, 50))
        expect(crooked!.endTile).toBe(w.map.idx(52, 40))
        const walk = rtRailLineWalk(w.map, diagonal!.tile, diagonal!.trackdir, 256)
        const pieces = new Set(walk.slice(0, 4).map(step => step.piece))
        expect(pieces.size).toBe(2)
        expect(pieces.has(RtTrack.x) || pieces.has(RtTrack.y)).toBe(false)
        expect(Math.abs(w.map.tileX(diagonal!.endTile) - 70) + Math.abs(w.map.tileY(diagonal!.endTile) - 70)).toBeLessThanOrEqual(1)
    })

    it('a drag starting on the end of own track extends it, costing only the new pieces', () => {
        const w = flatWorld()
        const east = rtTrackdirOf(RtTrack.x, true)
        must(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(10, 10), endTile: w.map.idx(20, 10), trackdir: east })
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        r.tools.pointerDown(w.map.idx(20, 10))
        r.tools.pointerMove(w.map.idx(25, 10))
        const preview = r.preview()!
        expect(preview.ok).toBe(true)
        expect(preview.blocked).toEqual([])
        // costed as the five new pieces only: the tile already built is free
        const fresh = applyCommand(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(21, 10), endTile: w.map.idx(25, 10), trackdir: east }, false)
        expect(fresh.ok).toBe(true)
        expect(preview.cost).toBe((fresh as { cost: number }).cost)
        r.tools.pointerUp(w.map.idx(25, 10))
        expect(r.commands).toEqual([{ kind: RtCommandKind.buildRailLine, tile: w.map.idx(20, 10), endTile: w.map.idx(25, 10), trackdir: east }])
    })

    it('a drag that would build nothing emits nothing; the preview reds the tiles beyond what money pays for', () => {
        const w = flatWorld()
        for (let x = 40; x <= 50; x++) w.map.setTile(w.map.idx(x, 5), RtTileKind.water, 255, 0)
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        drag(r.tools, w.map.idx(40, 5), w.map.idx(50, 5))
        expect(r.commands).toEqual([])
        // all already built: nothing to do either
        must(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(10, 8), endTile: w.map.idx(20, 8), trackdir: rtTrackdirOf(RtTrack.x, true) })
        drag(r.tools, w.map.idx(10, 8), w.map.idx(20, 8))
        expect(r.commands).toEqual([])
        // money for three pieces: the line stops there
        const piece = applyCommand(w, 0, { kind: RtCommandKind.buildRail, tile: w.map.idx(10, 30), piece: RtTrack.x }, false)
        w.company(0)!.money = (piece as { cost: number }).cost * 3
        r.tools.pointerDown(w.map.idx(10, 30))
        r.tools.pointerMove(w.map.idx(20, 30))
        expect(r.preview()!.ok).toBe(true)
        expect(r.preview()!.blocked.length).toBeGreaterThan(5)
        expect(r.preview()!.blocked[0]).toBe(w.map.idx(13, 30))
    })

    it('Escape cancels a drag: the release sends nothing', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        r.tools.pointerDown(w.map.idx(10, 10))
        r.tools.pointerMove(w.map.idx(30, 10))
        r.tools.key('Escape')
        r.tools.pointerUp(w.map.idx(30, 10))
        expect(r.commands).toEqual([])
    })

    it('drags are clamped to the line and area caps before a command is sent', () => {
        const w = flatWorld(256)
        const r = rig(w)
        r.tools.select(RtToolKind.road)
        drag(r.tools, w.map.idx(0, 3), w.map.idx(255, 3))
        expect(r.commands[0]).toEqual({ kind: RtCommandKind.buildRoadLine, tile: w.map.idx(0, 3), endTile: w.map.idx(255, 3) })
        r.tools.select(RtToolKind.demolish)
        must(w, 0, { kind: RtCommandKind.buildRoadLine, tile: w.map.idx(0, 100), endTile: w.map.idx(40, 100) })
        drag(r.tools, w.map.idx(0, 90), w.map.idx(40, 140))
        const area = r.commands[1] as Extract<RtCommand, { kind: typeof RtCommandKind.demolishArea }>
        expect(area.kind).toBe(RtCommandKind.demolishArea)
        const max = RT_CATALOG.caps.areaMaxTiles - 1
        expect([w.map.tileX(area.endTile), w.map.tileY(area.endTile)]).toEqual([max, 90 + max])
        expect(r.commands.length).toBe(2)
    })

    it('a demolish drag emits one demolishArea; a demolish click one demolish', () => {
        const w = flatWorld()
        must(w, 0, { kind: RtCommandKind.buildRoadLine, tile: w.map.idx(5, 5), endTile: w.map.idx(9, 5) })
        const r = rig(w)
        r.tools.select(RtToolKind.demolish)
        drag(r.tools, w.map.idx(5, 4), w.map.idx(9, 6))
        drag(r.tools, w.map.idx(7, 5), w.map.idx(7, 5))
        expect(r.commands).toEqual([
            { kind: RtCommandKind.demolishArea, tile: w.map.idx(5, 4), endTile: w.map.idx(9, 6) },
            { kind: RtCommandKind.demolish, tile: w.map.idx(7, 5) }
        ])
    })

    it('the signal tool places the toolbar type; a click on an existing signal cycles it with its own type', () => {
        const w = flatWorld()
        must(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(10, 10), endTile: w.map.idx(20, 10), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const r = rig(w)
        r.tools.select(RtToolKind.signal)
        r.tools.options.signalType = RtSignalType.block
        r.tools.pointerUp(w.map.idx(12, 10))
        r.tools.options.signalType = RtSignalType.path
        r.tools.pointerUp(w.map.idx(15, 10))
        expect(r.commands).toEqual([
            { kind: RtCommandKind.placeSignal, tile: w.map.idx(12, 10), piece: RtTrack.x, signalType: RtSignalType.block },
            { kind: RtCommandKind.placeSignal, tile: w.map.idx(15, 10), piece: RtTrack.x, signalType: RtSignalType.path }
        ])
        for (const c of r.commands) must(w, 0, c)
        r.tools.pointerUp(w.map.idx(12, 10))
        expect(r.commands[2]).toEqual({ kind: RtCommandKind.placeSignal, tile: w.map.idx(12, 10), piece: RtTrack.x, signalType: RtSignalType.block })
        must(w, 0, r.commands[2]!)
        expect(rtSignalTypeAt(w.map, w.map.idx(12, 10), RtTrack.x)).toBe(RtSignalType.block)
        // a click on bare land places nothing
        r.tools.pointerUp(w.map.idx(50, 50))
        expect(r.commands.length).toBe(3)
    })

    it('stations, stops, depots and parking spots are single clicks; R turns the depot and the station axis', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.railStation)
        r.tools.options.stationLength = 3
        r.tools.pointerMove(w.map.idx(30, 30))
        expect(r.preview()!.tiles.length).toBe(3)
        expect(r.preview()!.catchment.length).toBe((3 + 2 * RT_CATALOG.catchment.rail) * (1 + 2 * RT_CATALOG.catchment.rail))
        r.tools.key('r')
        expect(r.tools.options.stationAxis).toBe(RtAxis.y)
        r.tools.pointerUp(w.map.idx(30, 30))
        expect(r.commands[0]).toEqual({ kind: RtCommandKind.buildRailStation, tile: w.map.idx(30, 30), axis: RtAxis.y, tracks: 1, length: 3 })
        r.tools.select(RtToolKind.depot)
        r.tools.key('R')
        r.tools.pointerUp(w.map.idx(40, 40))
        expect(r.commands[1]).toEqual({ kind: RtCommandKind.buildDepot, tile: w.map.idx(40, 40), vehicleKind: RtVehicleKind.rail, facing: RtDir.nw })
        r.tools.select(RtToolKind.roadStop)
        must(w, 0, { kind: RtCommandKind.buildRoadLine, tile: w.map.idx(50, 50), endTile: w.map.idx(55, 50) })
        r.tools.pointerUp(w.map.idx(52, 50))
        expect(r.commands[2]).toEqual({ kind: RtCommandKind.buildRoadStop, tile: w.map.idx(52, 50), stop: RtStationTile.bus, shape: RtRoadStopShape.driveX })
        // parking: the dead end of a branch takes a spot, the middle of the branch does not (and shows why)
        must(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(60, 60), endTile: w.map.idx(66, 60), trackdir: rtTrackdirOf(RtTrack.x, true) })
        const branch = rtRailDrag(w.map, w.map.idx(63, 60), w.map.idx(63, 65))!
        must(w, 0, { kind: RtCommandKind.buildRailLine, tile: w.map.idx(63, 60), ...branch })
        r.tools.select(RtToolKind.parking)
        r.tools.pointerUp(w.map.idx(63, 63))
        expect(r.commands.length).toBe(3)
        expect(r.preview()!.hint).not.toBeNull()
        r.tools.pointerUp(w.map.idx(63, 65))
        expect(r.commands[3]).toEqual({ kind: RtCommandKind.buildSiding, tile: w.map.idx(63, 65) })
        must(w, 0, r.commands[3]!)
        r.tools.pointerUp(w.map.idx(63, 65), undefined, true)
        expect(r.commands[4]).toEqual({ kind: RtCommandKind.removeSiding, tile: w.map.idx(63, 65) })
    })

    it('R turns a road stop: a bay to the next side, a drive-through stop to the other axis; the preview says why a stop is refused', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.roadStop)
        expect(r.tools.options.stopShape).toBe(RtRoadStopShape.driveX)
        r.tools.key('r')
        expect(r.tools.options.stopShape).toBe(RtRoadStopShape.driveY)
        r.tools.key('R')
        expect(r.tools.options.stopShape).toBe(RtRoadStopShape.driveX)
        r.tools.options.stopShape = RtRoadStopShape.bayNw
        r.tools.key('r')
        expect(r.tools.options.stopShape).toBe(RtRoadStopShape.bayNe)
        for (const shape of [RtRoadStopShape.baySe, RtRoadStopShape.baySw, RtRoadStopShape.bayNw]) {
            r.tools.key('r')
            expect(r.tools.options.stopShape).toBe(shape)
        }
        // a drive-through stop across a road: the hover preview carries the reason, and a click sends nothing
        must(w, 0, { kind: RtCommandKind.buildRoadLine, tile: w.map.idx(50, 40), endTile: w.map.idx(50, 45) })
        r.tools.options.stopShape = RtRoadStopShape.driveX
        r.tools.pointerMove(w.map.idx(50, 42))
        expect(r.preview()).toMatchObject({ ok: false, error: RtCommandError.wrongDirection, blocked: [w.map.idx(50, 42)] })
        r.tools.pointerUp(w.map.idx(50, 42))
        expect(r.commands).toEqual([])
        // a bay on the road is refused too; a bay beside it is sent with its shape
        r.tools.options.stopShape = RtRoadStopShape.baySw
        r.tools.pointerMove(w.map.idx(50, 42))
        expect(r.preview()).toMatchObject({ ok: false, error: RtCommandError.occupied })
        r.tools.pointerUp(w.map.idx(49, 42))
        expect(r.commands).toEqual([{ kind: RtCommandKind.buildRoadStop, tile: w.map.idx(49, 42), stop: RtStationTile.bus, shape: RtRoadStopShape.baySw }])
        expect(r.preview()!.catchment.length).toBeGreaterThan(1)
    })

    it('query emits the clicked tile', () => {
        const w = flatWorld()
        const r = rig(w)
        r.tools.select(RtToolKind.query)
        r.tools.pointerUp(w.map.idx(9, 9))
        expect(r.queries).toEqual([w.map.idx(9, 9)])
        expect(r.commands).toEqual([])
    })

    it('pick mode emits picked for an own station or depot, ignores a rival\'s without sharing, and Escape leaves it', () => {
        const w = flatWorld()
        const own = must(w, 0, { kind: RtCommandKind.buildRailStation, tile: w.map.idx(10, 10), axis: RtAxis.x, tracks: 1, length: 3 }).id!
        must(w, 1, { kind: RtCommandKind.buildRailStation, tile: w.map.idx(10, 20), axis: RtAxis.x, tracks: 1, length: 3 })
        must(w, 0, { kind: RtCommandKind.buildDepot, tile: w.map.idx(30, 30), vehicleKind: RtVehicleKind.rail, facing: RtDir.sw })
        const r = rig(w)
        r.tools.select(RtToolKind.rail)
        r.tools.enterPick(['station', 'depot'])
        r.tools.pointerUp(w.map.idx(11, 20))
        expect(r.picks).toEqual([])
        r.tools.pointerUp(w.map.idx(11, 10))
        expect(r.picks).toEqual([{ kind: 'station', id: own }])
        expect(r.tools.tool).toBe(RtToolKind.rail)
        r.tools.enterPick(['depot'])
        r.tools.pointerUp(w.map.idx(30, 30))
        expect(r.picks[1]).toEqual({ kind: 'depot', id: w.map.idx(30, 30) })
        r.tools.enterPick(['station'])
        r.tools.key('Escape')
        expect(r.pickEnds()).toBe(1)
        expect(r.tools.tool).toBe(RtToolKind.rail)
        expect(r.commands).toEqual([])
    })

    it('with sharing on a rival\'s station can be picked', () => {
        const w = flatWorld(128, true)
        const rival = must(w, 1, { kind: RtCommandKind.buildRailStation, tile: w.map.idx(10, 20), axis: RtAxis.x, tracks: 1, length: 3 }).id!
        const r = rig(w)
        r.tools.enterPick(['station'])
        r.tools.pointerUp(w.map.idx(12, 20))
        expect(r.picks).toEqual([{ kind: 'station', id: rival }])
    })

    it('a spectator only queries: no build gesture emits a command', () => {
        const w = flatWorld()
        const r = rig(w, 255)
        r.tools.select(RtToolKind.rail)
        drag(r.tools, w.map.idx(10, 10), w.map.idx(20, 10))
        r.tools.select(RtToolKind.depot)
        r.tools.pointerUp(w.map.idx(5, 5))
        expect(r.commands).toEqual([])
    })

    it('announces every tool change, pick mode included, so the toolbar can follow', () => {
        const w = flatWorld()
        const r = rig(w)
        const seen: RtToolKind[] = []
        r.tools.on('tool', t => seen.push(t))
        r.tools.select(RtToolKind.rail)
        r.tools.enterPick(['station'])
        r.tools.key('Escape')
        r.tools.enterPick(['station'])
        r.tools.select(RtToolKind.road)
        expect(seen).toEqual([RtToolKind.rail, RtToolKind.pick, RtToolKind.rail, RtToolKind.pick, RtToolKind.road])
    })

    it('a highlight goes out as a preview, and refresh brings the tool\'s own back', () => {
        const w = flatWorld()
        const r = rig(w)
        const shown = r.tools.highlight([1, 2], [3, 4, 5])
        expect(r.preview()).toBe(shown)
        expect(shown).toMatchObject({ tiles: [1, 2], catchment: [3, 4, 5], blocked: [], ok: true, cost: 0 })
        r.tools.refresh()
        expect(r.preview()).toBeNull()
    })
})
