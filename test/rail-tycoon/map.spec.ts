import { describe, expect, it } from 'vitest'
import {
    RT_DIRS,
    RT_ROAD_DIR_BIT,
    RtDir,
    RtMap,
    RtSlope,
    RtTileKind,
    rtReverseDir,
    rtTreeCount,
    rtTreePayload,
    rtTreeStage,
    rtTreeType
} from '#shared/utils/rail-tycoon/map'
import { RT_OWNER_NONE } from '#shared/utils/rail-tycoon/types'

/** Set tile (x, y)'s corners to the given heights; north is corner (x, y), west (x + 1, y), east (x, y + 1), south (x + 1, y + 1). */
function setCorners(map: RtMap, x: number, y: number, h: { n: number, w: number, e: number, s: number }): number {
    map.setCornerHeight(x, y, h.n)
    map.setCornerHeight(x + 1, y, h.w)
    map.setCornerHeight(x, y + 1, h.e)
    map.setCornerHeight(x + 1, y + 1, h.s)
    return map.idx(x, y)
}

describe('rail tycoon map', () => {
    it('accepts the three power-of-two sides and rejects anything else', () => {
        for (const side of [64, 128, 256]) {
            const map = new RtMap(side)
            expect(map.side).toBe(side)
            expect(map.tileCount).toBe(side * side)
            expect(map.heights.length).toBe((side + 1) * (side + 1))
            expect(map.kind.length).toBe(side * side)
            expect(map.owner.length).toBe(side * side)
            expect(map.payload.length).toBe(side * side)
        }
        for (const side of [100, 512, 32, 0, -64, 64.5]) expect(() => new RtMap(side)).toThrow(RangeError)
    })

    it('starts as clear, unowned, flat sea-level land', () => {
        const map = new RtMap(64)
        expect(map.kind.every(k => k === RtTileKind.clear)).toBe(true)
        expect(map.owner.every(o => o === RT_OWNER_NONE)).toBe(true)
        expect(map.payload.every(p => p === 0)).toBe(true)
        expect(map.heights.every(h => h === 0)).toBe(true)
    })

    it('makes idx and xy inverse over every tile', () => {
        const map = new RtMap(64)
        for (let i = 0; i < map.tileCount; i++) {
            const { x, y } = map.xy(i)
            expect(map.idx(x, y)).toBe(i)
            expect(map.tileX(i)).toBe(x)
            expect(map.tileY(i)).toBe(y)
        }
        expect(map.idx(5, 3)).toBe(3 * 64 + 5)
        expect(map.xy(3 * 64 + 5)).toEqual({ x: 5, y: 3 })
    })

    it('knows which tiles lie on the map', () => {
        const map = new RtMap(64)
        expect(map.inBounds(0, 0)).toBe(true)
        expect(map.inBounds(63, 63)).toBe(true)
        expect(map.inBounds(64, 0)).toBe(false)
        expect(map.inBounds(0, -1)).toBe(false)
        expect(map.inBounds(1.5, 2)).toBe(false)
        expect(map.validTile(4095)).toBe(true)
        expect(map.validTile(4096)).toBe(false)
        expect(map.validTile(-1)).toBe(false)
    })

    it('reads and writes corner heights within 0 to 15 on the (side + 1) grid', () => {
        const map = new RtMap(64)
        map.setCornerHeight(64, 64, 15)
        expect(map.cornerHeight(64, 64)).toBe(15)
        expect(map.heights[65 * 65 - 1]).toBe(15)
        expect(() => map.setCornerHeight(0, 0, 16)).toThrow(RangeError)
        expect(() => map.setCornerHeight(0, 0, -1)).toThrow(RangeError)
        expect(() => map.cornerHeight(65, 0)).toThrow(RangeError)
        expect(() => map.cornerHeight(0, -1)).toThrow(RangeError)
    })

    it('gives a flat tile slope 0 and its height', () => {
        const map = new RtMap(64)
        const i = setCorners(map, 10, 10, { n: 3, w: 3, e: 3, s: 3 })
        expect(map.tileSlope(i)).toBe(RtSlope.flat)
        expect(map.isFlat(i)).toBe(true)
        expect(map.tileHeight(i)).toBe(3)
        expect(map.tileMaxHeight(i)).toBe(3)
    })

    it('gives each single raised corner its own bit', () => {
        const cases = [
            { corners: { n: 1, w: 0, e: 0, s: 0 }, slope: RtSlope.n },
            { corners: { n: 0, w: 1, e: 0, s: 0 }, slope: RtSlope.w },
            { corners: { n: 0, w: 0, e: 1, s: 0 }, slope: RtSlope.e },
            { corners: { n: 0, w: 0, e: 0, s: 1 }, slope: RtSlope.s }
        ]
        for (const { corners, slope } of cases) {
            const map = new RtMap(64)
            const i = setCorners(map, 20, 30, corners)
            expect(map.tileSlope(i)).toBe(slope)
            expect(map.isFlat(i)).toBe(false)
            expect(map.tileHeight(i)).toBe(0)
        }
        expect([RtSlope.w, RtSlope.s, RtSlope.e, RtSlope.n]).toEqual([1, 2, 4, 8])
    })

    it('gives the four two-corner ramps and the three-corner slopes their masks', () => {
        const cases = [
            { corners: { n: 2, w: 3, e: 2, s: 3 }, slope: RtSlope.sw, mask: 3 },
            { corners: { n: 2, w: 2, e: 3, s: 3 }, slope: RtSlope.se, mask: 6 },
            { corners: { n: 3, w: 3, e: 2, s: 2 }, slope: RtSlope.nw, mask: 9 },
            { corners: { n: 3, w: 2, e: 3, s: 2 }, slope: RtSlope.ne, mask: 12 },
            { corners: { n: 1, w: 1, e: 1, s: 0 }, slope: RtSlope.n | RtSlope.w | RtSlope.e, mask: 13 },
            { corners: { n: 2, w: 1, e: 2, s: 2 }, slope: RtSlope.n | RtSlope.e | RtSlope.s, mask: 14 }
        ]
        for (const { corners, slope, mask } of cases) {
            const map = new RtMap(64)
            const i = setCorners(map, 5, 6, corners)
            expect(slope).toBe(mask)
            expect(map.tileSlope(i)).toBe(mask)
            expect(map.tileHeight(i)).toBe(Math.min(corners.n, corners.w, corners.e, corners.s))
        }
    })

    it('flags a steep slope whose highest corner is two levels above the lowest', () => {
        const steepCases = [
            // north highest, south lowest: the three corners above the south are raised
            { corners: { n: 2, w: 1, e: 1, s: 0 }, slope: RtSlope.steep | RtSlope.n | RtSlope.w | RtSlope.e },
            { corners: { n: 0, w: 1, e: 1, s: 2 }, slope: RtSlope.steep | RtSlope.s | RtSlope.w | RtSlope.e },
            { corners: { n: 1, w: 2, e: 0, s: 1 }, slope: RtSlope.steep | RtSlope.w | RtSlope.n | RtSlope.s },
            { corners: { n: 1, w: 0, e: 2, s: 1 }, slope: RtSlope.steep | RtSlope.e | RtSlope.n | RtSlope.s }
        ]
        for (const { corners, slope } of steepCases) {
            const map = new RtMap(64)
            const i = setCorners(map, 40, 41, corners)
            expect(map.tileSlope(i)).toBe(slope)
            expect(map.tileSlope(i) & RtSlope.steep).toBe(RtSlope.steep)
            expect(map.tileHeight(i)).toBe(0)
            expect(map.tileMaxHeight(i)).toBe(2)
        }
        expect(RtSlope.steep | RtSlope.n | RtSlope.w | RtSlope.e).toBe(29)
    })

    it('shares corners between neighbouring tiles', () => {
        const map = new RtMap(64)
        // raising one corner tilts all four tiles that meet there
        map.setCornerHeight(10, 10, 1)
        expect(map.tileSlope(map.idx(10, 10))).toBe(RtSlope.n)
        expect(map.tileSlope(map.idx(9, 10))).toBe(RtSlope.w)
        expect(map.tileSlope(map.idx(10, 9))).toBe(RtSlope.e)
        expect(map.tileSlope(map.idx(9, 9))).toBe(RtSlope.s)
        expect(map.tileSlope(map.idx(11, 11))).toBe(RtSlope.flat)
    })

    it('steps to the four axis neighbours and returns -1 past every edge', () => {
        const map = new RtMap(64)
        const mid = map.idx(10, 20)
        expect(map.neighbour(mid, RtDir.ne)).toBe(map.idx(9, 20))
        expect(map.neighbour(mid, RtDir.sw)).toBe(map.idx(11, 20))
        expect(map.neighbour(mid, RtDir.nw)).toBe(map.idx(10, 19))
        expect(map.neighbour(mid, RtDir.se)).toBe(map.idx(10, 21))

        expect(map.neighbour(map.idx(0, 5), RtDir.ne)).toBe(-1)
        expect(map.neighbour(map.idx(63, 5), RtDir.sw)).toBe(-1)
        expect(map.neighbour(map.idx(5, 0), RtDir.nw)).toBe(-1)
        expect(map.neighbour(map.idx(5, 63), RtDir.se)).toBe(-1)
        // a row end never wraps onto the next row
        expect(map.neighbour(map.idx(63, 5), RtDir.ne)).toBe(map.idx(62, 5))
        expect(map.neighbour(map.idx(0, 6), RtDir.sw)).toBe(map.idx(1, 6))
        for (const corner of [map.idx(0, 0), map.idx(63, 0), map.idx(0, 63), map.idx(63, 63)]) {
            const edges = RT_DIRS.filter(dir => map.neighbour(corner, dir) === -1)
            expect(edges.length).toBe(2)
        }
        for (const dir of RT_DIRS) {
            const n = map.neighbour(mid, dir)
            expect(map.neighbour(n, rtReverseDir(dir))).toBe(mid)
        }
    })

    it('writes kind, owner and payload together in setTile and checks its input', () => {
        const map = new RtMap(64)
        const i = map.idx(7, 8)
        map.setTile(i, RtTileKind.rail, 3, 0xdeadbeef)
        expect(map.kind[i]).toBe(RtTileKind.rail)
        expect(map.owner[i]).toBe(3)
        expect(map.payload[i]).toBe(0xdeadbeef)
        map.setTile(i, RtTileKind.road, RT_OWNER_NONE, RT_ROAD_DIR_BIT[RtDir.ne]! | RT_ROAD_DIR_BIT[RtDir.sw]!)
        expect(map.kind[i]).toBe(RtTileKind.road)
        expect(map.owner[i]).toBe(255)
        expect(map.payload[i]).toBe(8 | 2)
        // neighbouring tiles are untouched
        expect(map.kind[i + 1]).toBe(RtTileKind.clear)
        expect(map.payload[i - 1]).toBe(0)

        expect(() => map.setTile(-1, RtTileKind.clear, 0, 0)).toThrow(RangeError)
        expect(() => map.setTile(map.tileCount, RtTileKind.clear, 0, 0)).toThrow(RangeError)
        expect(() => map.setTile(i, 10 as RtTileKind, 0, 0)).toThrow(RangeError)
        expect(() => map.setTile(i, RtTileKind.clear, 256, 0)).toThrow(RangeError)
        expect(() => map.setTile(i, RtTileKind.clear, 0, 2 ** 32)).toThrow(RangeError)
        expect(() => map.setTile(i, RtTileKind.clear, 0, -1)).toThrow(RangeError)
    })

    it('packs tree type, growth stage and count into a tree payload', () => {
        const payload = rtTreePayload(11, 6, 4)
        expect(rtTreeType(payload)).toBe(11)
        expect(rtTreeStage(payload)).toBe(6)
        expect(rtTreeCount(payload)).toBe(4)
        const small = rtTreePayload(0, 3, 1)
        expect([rtTreeType(small), rtTreeStage(small), rtTreeCount(small)]).toEqual([0, 3, 1])
    })
})
