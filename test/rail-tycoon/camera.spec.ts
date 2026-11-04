import { describe, expect, it } from 'vitest'
import { RT_MAX_HEIGHT, RtMap } from '#shared/utils/rail-tycoon/map'
import { generateWorld, rtDefaultWorldOptions } from '#shared/utils/rail-tycoon/worldgen'
import {
    RT_CAMERA_EDGE_SPEED,
    RT_CAMERA_EDGE_ZONE,
    RT_CAMERA_KEY_FAST,
    RT_CAMERA_KEY_SPEED,
    RT_CAMERA_STEP_MS,
    RT_CAMERA_ZOOMS,
    RtCamera,
    RtScrollKey,
    rtForEachTileInRange,
    rtCornerHeightsAt,
    rtTileToWorld,
    rtWorldToTile
} from '../../app/utils/rail-tycoon/camera'
import type { RtCameraZoom, RtPoint } from '../../app/utils/rail-tycoon/camera'

/**
 * A 64 map of rolling hills with a Manhattan pyramid peaking at RT_MAX_HEIGHT, so it holds every
 * slope including steep ones. Adjacent corners differ by at most one level, as worldgen keeps them.
 */
function hillyMap(): RtMap {
    const map = new RtMap(64)
    for (let cy = 0; cy <= 64; cy++) {
        for (let cx = 0; cx <= 64; cx++) {
            const hills = Math.min(RT_MAX_HEIGHT, Math.max(0, Math.round(4 + 3 * Math.sin(cx / 5) + 3 * Math.cos(cy / 7))))
            const peak = Math.max(0, RT_MAX_HEIGHT - Math.abs(cx - 40) - Math.abs(cy - 24))
            map.setCornerHeight(cx, cy, Math.max(hills, peak))
        }
    }
    return map
}

/** Screen position of the middle of tile (x, y)'s surface: the mean of its four projected corners. */
function tileCentre(camera: RtCamera, map: RtMap, x: number, y: number): RtPoint {
    const [n, w, e, s] = rtCornerHeightsAt(map, x, y)
    const pts = [camera.tileToScreen(x, y, n), camera.tileToScreen(x + 1, y, w), camera.tileToScreen(x, y + 1, e), camera.tileToScreen(x + 1, y + 1, s)]
    return { x: pts.reduce((a, p) => a + p.x, 0) / 4, y: pts.reduce((a, p) => a + p.y, 0) / 4 }
}

function isWholeDevicePixel(v: number, dpr: number): boolean {
    return Math.abs(v * dpr - Math.round(v * dpr)) < 1e-9
}

describe('rail tycoon camera', () => {
    it('projects tiles to 64 by 32 diamonds that rise 8 px per height level', () => {
        expect(rtTileToWorld(0, 0, 0)).toEqual({ x: 0, y: 0 })
        // x runs down-left, y down-right
        expect(rtTileToWorld(1, 0, 0)).toEqual({ x: -32, y: 16 })
        expect(rtTileToWorld(0, 1, 0)).toEqual({ x: 32, y: 16 })
        expect(rtTileToWorld(1, 1, 0)).toEqual({ x: 0, y: 32 })
        expect(rtTileToWorld(3, 5, 2)).toEqual({ x: 64, y: 128 - 16 })
        const back = rtWorldToTile(64, 112, 2)
        expect(back.x).toBeCloseTo(3)
        expect(back.y).toBeCloseTo(5)
    })

    it('scales the projection by the zoom and keeps every position on a whole device pixel', () => {
        for (const dpr of [1, 1.25, 1.5, 2]) {
            for (const zoom of RT_CAMERA_ZOOMS) {
                const camera = new RtCamera({ width: 801, height: 599, dpr, zoom })
                camera.scrollBy(123.37, -45.71)
                const a = camera.tileToScreen(10, 10, 0)
                const b = camera.tileToScreen(11, 11, 0)
                expect(b.y - a.y).toBeCloseTo(32 * zoom, 0)
                expect(b.x - a.x).toBeCloseTo(0, 5)
                for (let i = 0; i < 40; i++) {
                    const p = camera.tileToScreen(i * 1.37, i * 0.53, i % 16)
                    expect(isWholeDevicePixel(p.x, dpr)).toBe(true)
                    expect(isWholeDevicePixel(p.y, dpr)).toBe(true)
                }
                expect(isWholeDevicePixel(camera.originX, dpr)).toBe(true)
                expect(isWholeDevicePixel(camera.originY, dpr)).toBe(true)
            }
        }
    })

    it('never renders below native resolution: the rounding grid has a floor of one device pixel', () => {
        expect(new RtCamera({ dpr: 0.5 }).resolution).toBe(1)
        expect(new RtCamera({ dpr: 2 }).resolution).toBe(2)
    })

    it('picks back every tile of a hilly map at each zoom', () => {
        const map = hillyMap()
        for (const dpr of [1, 2]) {
            for (const zoom of RT_CAMERA_ZOOMS) {
                const camera = new RtCamera({ width: 1280, height: 720, dpr, zoom, mapSide: 64 })
                camera.centreOnTile(20.3, 41.7, 3)
                for (let y = 0; y < 64; y++) {
                    for (let x = 0; x < 64; x++) {
                        const p = tileCentre(camera, map, x, y)
                        const picked = camera.screenToTile(p.x, p.y, map)
                        if (picked?.x !== x || picked.y !== y) {
                            expect.fail(`zoom ${zoom} dpr ${dpr}: tile ${x},${y} picked as ${JSON.stringify(picked)}`)
                        }
                    }
                }
            }
        }
    })

    it('picks back every tile of a generated world at each zoom', () => {
        const { map } = generateWorld(20261030, rtDefaultWorldOptions(64))
        for (const zoom of RT_CAMERA_ZOOMS) {
            const camera = new RtCamera({ width: 1024, height: 768, zoom, mapSide: 64 })
            camera.centreOnTile(32, 32)
            let misses = 0
            for (let i = 0; i < map.tileCount; i++) {
                const x = map.tileX(i)
                const y = map.tileY(i)
                const p = tileCentre(camera, map, x, y)
                const picked = camera.screenToTile(p.x, p.y, map)
                if (picked?.x !== x || picked.y !== y) misses++
            }
            expect(misses).toBe(0)
        }
    })

    it('picks the raised tile in front of a tile it hides', () => {
        const map = new RtMap(64)
        // tile (9, 9) lifted 15 levels as a sheer block hides the flat tile (5, 5) on the same screen column
        map.setCornerHeight(9, 9, 15)
        map.setCornerHeight(10, 9, 15)
        map.setCornerHeight(9, 10, 15)
        map.setCornerHeight(10, 10, 15)
        const camera = new RtCamera({ width: 800, height: 600 })
        const p = camera.tileToScreen(5.5, 5.5, 0)
        expect(camera.screenToTile(p.x, p.y, map)).toEqual({ x: 9, y: 9 })
        const q = camera.tileToScreen(20.5, 20.5, 0)
        expect(camera.screenToTile(q.x, q.y, map)).toEqual({ x: 20, y: 20 })
    })

    it('picks nothing off the map', () => {
        const map = hillyMap()
        const camera = new RtCamera({ width: 800, height: 600 })
        const above = camera.tileToScreen(0, 0, 0)
        expect(camera.screenToTile(above.x, above.y - 200, map)).toBeNull()
        const beyond = camera.tileToScreen(70, 70, 0)
        expect(camera.screenToTile(beyond.x, beyond.y, map)).toBeNull()
        const left = camera.tileToScreen(30, -3, 0)
        expect(camera.screenToTile(left.x, left.y, map)).toBeNull()
    })

    it('steps the zoom through 0.5, 1, 2 and 4 keeping the point under the cursor in place', () => {
        const camera = new RtCamera({ width: 1000, height: 700, zoom: 1, mapSide: 128 })
        camera.centreOnTile(64, 64)
        const cursor = { x: 310, y: 205 }
        const anchor = { x: camera.scrollX + cursor.x / camera.zoom, y: camera.scrollY + cursor.y / camera.zoom }
        const seen: RtCameraZoom[] = []
        while (camera.zoomAt(cursor.x, cursor.y, 1)) seen.push(camera.zoom)
        expect(seen).toEqual([2, 4])
        expect(camera.zoomAt(cursor.x, cursor.y, 1)).toBe(false)
        while (camera.zoomAt(cursor.x, cursor.y, -1)) seen.push(camera.zoom)
        expect(seen).toEqual([2, 4, 2, 1, 0.5])
        expect(camera.zoomAt(cursor.x, cursor.y, -1)).toBe(false)
        for (const zoom of RT_CAMERA_ZOOMS) {
            camera.setZoom(zoom, cursor.x, cursor.y)
            const at = camera.worldToScreen(anchor.x, anchor.y)
            // the anchor stays within one device pixel of the cursor
            expect(Math.abs(at.x - cursor.x)).toBeLessThanOrEqual(1)
            expect(Math.abs(at.y - cursor.y)).toBeLessThanOrEqual(1)
        }
        expect(() => camera.setZoom(3 as RtCameraZoom)).toThrow(RangeError)
    })

    it('scrolls with a drag: the view travels with the mouse, or the map follows it in map mode', () => {
        const camera = new RtCamera({ width: 800, height: 600, zoom: 2, mapSide: 128 })
        camera.centreOnTile(64, 64)
        const x0 = camera.scrollX
        const y0 = camera.scrollY
        const v0 = camera.version
        camera.dragScroll(40, -20)
        expect(camera.scrollX).toBeCloseTo(x0 + 20)
        expect(camera.scrollY).toBeCloseTo(y0 - 10)
        expect(camera.version).toBeGreaterThan(v0)
        camera.dragScroll(40, -20, 'map')
        expect(camera.scrollX).toBeCloseTo(x0)
        expect(camera.scrollY).toBeCloseTo(y0)
    })

    it('scrolls with the arrow keys at the original speed, along the tile axes on diagonals', () => {
        const camera = new RtCamera({ width: 800, height: 600, zoom: 1, mapSide: 256 })
        camera.centreOnTile(128, 128)
        const start = { x: camera.scrollX, y: camera.scrollY }
        camera.keyScroll(RtScrollKey.right, false, RT_CAMERA_STEP_MS)
        expect(camera.scrollX - start.x).toBeCloseTo(RT_CAMERA_KEY_SPEED)
        camera.keyScroll(RtScrollKey.left, true, RT_CAMERA_STEP_MS)
        expect(camera.scrollX - start.x).toBeCloseTo(RT_CAMERA_KEY_SPEED * (1 - RT_CAMERA_KEY_FAST))
        const mid = { x: camera.scrollX, y: camera.scrollY }
        camera.keyScroll(RtScrollKey.left | RtScrollKey.up, false, RT_CAMERA_STEP_MS * 2)
        expect(camera.scrollX - mid.x).toBeCloseTo(-2 * RT_CAMERA_KEY_SPEED)
        expect(camera.scrollY - mid.y).toBeCloseTo(-RT_CAMERA_KEY_SPEED)
        const v = camera.version
        camera.keyScroll(RtScrollKey.left | RtScrollKey.right, false, RT_CAMERA_STEP_MS)
        expect(camera.version).toBe(v)
    })

    it('scrolls when the cursor rests at the viewport edge, faster the closer it is', () => {
        const camera = new RtCamera({ width: 800, height: 600, zoom: 1, mapSide: 256 })
        camera.centreOnTile(128, 128)
        expect(camera.edgeScroll(400, 300, RT_CAMERA_STEP_MS)).toBe(false)
        const x0 = camera.scrollX
        expect(camera.edgeScroll(5, 300, RT_CAMERA_STEP_MS)).toBe(true)
        expect(camera.scrollX - x0).toBeCloseTo((5 - RT_CAMERA_EDGE_ZONE) * RT_CAMERA_EDGE_SPEED)
        const y0 = camera.scrollY
        camera.edgeScroll(400, 599, RT_CAMERA_STEP_MS)
        expect(camera.scrollY - y0).toBeCloseTo((599 - (600 - RT_CAMERA_EDGE_ZONE)) * RT_CAMERA_EDGE_SPEED)
    })

    it('keeps the centre of the view over the map', () => {
        const camera = new RtCamera({ width: 800, height: 600, zoom: 1, mapSide: 64 })
        camera.centreOnTile(-40, 90)
        const centre = camera.screenToWorld(400, 300)
        const t = rtWorldToTile(centre.x, centre.y)
        expect(t.x).toBeCloseTo(0)
        expect(t.y).toBeCloseTo(64)
        camera.scrollBy(-1e6, -1e6)
        const c2 = camera.screenToWorld(400, 300)
        const t2 = rtWorldToTile(c2.x, c2.y)
        expect(t2.x).toBeGreaterThanOrEqual(-1e-9)
        expect(t2.y).toBeGreaterThanOrEqual(-1e-9)
        expect(t2.x).toBeLessThanOrEqual(64 + 1e-9)
        expect(t2.y).toBeLessThanOrEqual(64 + 1e-9)
    })

    it('culls to the tiles that can show, visited back to front', () => {
        const map = hillyMap()
        for (const zoom of RT_CAMERA_ZOOMS) {
            const camera = new RtCamera({ width: 640, height: 480, zoom, mapSide: 64 })
            camera.centreOnTile(24, 30, 4)
            const range = camera.visibleTileRange()
            const visited = new Set<number>()
            let lastS = -1
            rtForEachTileInRange(range, map.side, (x, y) => {
                expect(map.inBounds(x, y)).toBe(true)
                expect(x + y).toBeGreaterThanOrEqual(lastS)
                lastS = x + y
                visited.add(map.idx(x, y))
            })
            // every tile with a corner inside the viewport is visited
            for (let y = 0; y < 64; y++) {
                for (let x = 0; x < 64; x++) {
                    const [n, w, e, s] = rtCornerHeightsAt(map, x, y)
                    const corners = [camera.tileToScreen(x, y, n), camera.tileToScreen(x + 1, y, w), camera.tileToScreen(x, y + 1, e), camera.tileToScreen(x + 1, y + 1, s)]
                    const shows = corners.some(p => p.x >= 0 && p.x <= 640 && p.y >= 0 && p.y <= 480)
                    if (shows && !visited.has(map.idx(x, y))) expect.fail(`zoom ${zoom}: tile ${x},${y} shows but was culled`)
                }
            }
            if (zoom >= 2) expect(visited.size).toBeLessThan(map.tileCount / 2)
        }
    })

    it('holds the view centre through a resize', () => {
        const camera = new RtCamera({ width: 800, height: 600, zoom: 2, mapSide: 128 })
        camera.centreOnTile(50, 70)
        const before = camera.screenToWorld(400, 300)
        camera.resize(1200, 900, 2)
        const after = camera.screenToWorld(600, 450)
        expect(after.x).toBeCloseTo(before.x, 0)
        expect(after.y).toBeCloseTo(before.y, 0)
        expect(camera.resolution).toBe(2)
    })
})
