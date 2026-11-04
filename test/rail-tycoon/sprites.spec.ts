import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { RT_CATALOG, RT_INDUSTRY_TYPE_IDS, RT_VEHICLE_MODEL_IDS } from '#shared/utils/rail-tycoon/catalog'
import { RT_ROAD_DIR_BIT, RtDir, RtSlope } from '#shared/utils/rail-tycoon/map'
import {
    RT_COMPANY_BASE_SHADE,
    rtClearTransparent,
    rtCompanyColour,
    rtCompanyRamp,
    rtIsRecolouredName,
    rtMaskChannel,
    rtMaskShade,
    rtPackRects,
    rtPlaceholderPixels,
    rtRecolourInto,
    rtRectHasMask
} from '../../app/utils/rail-tycoon/sprites'
import type { RtAtlasJson } from '../../app/utils/rail-tycoon/sprites'
import {
    RT_RAIL_PIECES,
    RT_SIDE_NAMES,
    RT_SLOPE_CORNERS,
    RT_SPRITE_DIRECTIONS,
    RT_WATER_CYCLE_MS,
    RT_WATER_FRAMES,
    rtCoastSpriteName,
    rtCrossingSpriteName,
    rtDepotSpriteNames,
    rtFoundationSpriteName,
    rtHouseSpriteName,
    rtIndustrySpriteName,
    rtRailPiecesFromBits,
    rtRailSpriteNames,
    rtRoadSidesFromBits,
    rtRoadSpriteName,
    rtRoadStopSpriteNames,
    rtSignalSpriteName,
    rtSlopeNameFromBits,
    rtSlopeNameFromCorners,
    rtStationSpriteNames,
    rtTerrainSpriteName,
    rtTreeSpriteName,
    rtVehicleSpriteName,
    rtWaterFrameAt,
    rtWaterSpriteName
} from '../../app/utils/rail-tycoon/sprite-names'
import type { RtRailPiece, RtSlopeName } from '../../app/utils/rail-tycoon/sprite-names'

const outDir = resolve(import.meta.dirname, '../../public/rail-tycoon/opengfx')
const atlas = JSON.parse(readFileSync(join(outDir, 'atlas.json'), 'utf8')) as RtAtlasJson
const names = new Set(Object.keys(atlas.sprites))
const slopeNames = Object.keys(RT_SLOPE_CORNERS) as RtSlopeName[]

const luminance = (ramp: Uint8Array, s: number) => 0.299 * ramp[s * 3]! + 0.587 * ramp[s * 3 + 1]! + 0.114 * ramp[s * 3 + 2]!

/** Every subset of the six rail pieces. */
function pieceSets(): RtRailPiece[][] {
    const sets: RtRailPiece[][] = []
    for (let m = 1; m < 64; m++) sets.push(RT_RAIL_PIECES.filter((_, k) => m & (1 << k)))
    return sets
}

describe('company colour ramps', () => {
    it('puts the catalog colour at the base shade and gets lighter shade by shade', () => {
        RT_CATALOG.companies.colours.forEach((colour, index) => {
            expect(rtCompanyColour(index)).toBe(colour)
            const ramp = rtCompanyRamp(colour)
            expect(ramp).toHaveLength(24)
            const b = RT_COMPANY_BASE_SHADE * 3
            expect([ramp[b], ramp[b + 1], ramp[b + 2]]).toEqual([(colour >> 16) & 255, (colour >> 8) & 255, colour & 255])
            for (let s = 1; s < 8; s++) expect(luminance(ramp, s)).toBeGreaterThan(luminance(ramp, s - 1))
        })
    })

    it('gives the sixteen companies sixteen different ramps', () => {
        const ramps = new Set(RT_CATALOG.companies.colours.map(c => Array.from(rtCompanyRamp(c)).join(',')))
        expect(ramps.size).toBe(16)
    })

    it('rejects a colour index outside the catalog', () => {
        expect(() => rtCompanyColour(16)).toThrow(RangeError)
    })
})

describe('mask decoding', () => {
    it('reads shade s from (s + 1) * 32 - 1 and nothing from 0', () => {
        for (let s = 0; s < 8; s++) expect(rtMaskShade((s + 1) * 32 - 1)).toBe(s)
        expect(rtMaskShade(0)).toBe(-1)
    })

    it('takes the first channel of an RGBA mask', () => {
        expect(Array.from(rtMaskChannel([31, 31, 31, 255, 0, 0, 0, 255, 255, 255, 255, 255]))).toEqual([31, 0, 255])
    })
})

describe('recolouring', () => {
    // 3x1 atlas: an opaque plain pixel, an opaque company pixel at shade 2, a transparent pixel.
    const src = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 0])
    const mask = new Uint8Array([0, 95, 0])
    const ramp = rtCompanyRamp(0x2a4fa8)

    it('replaces company pixels with the ramp shade, keeps others and clears transparent ones', () => {
        const dst = new Uint8Array(4 * 4 * 4).fill(7)
        rtRecolourInto(src, mask, 3, { x: 0, y: 0, w: 3, h: 1 }, ramp, dst, 4, 1, 2)
        const at = (x: number, y: number) => Array.from(dst.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4))
        expect(at(1, 2)).toEqual([10, 20, 30, 255])
        expect(at(2, 2)).toEqual([ramp[6], ramp[7], ramp[8], 255])
        expect(at(3, 2)).toEqual([0, 0, 0, 0])
        expect(at(0, 2)).toEqual([7, 7, 7, 7])
    })

    it('finds company pixels in a rectangle', () => {
        expect(rtRectHasMask(mask, 3, { x: 1, y: 0, w: 1, h: 1 })).toBe(true)
        expect(rtRectHasMask(mask, 3, { x: 2, y: 0, w: 1, h: 1 })).toBe(false)
    })

    it('makes a straight-alpha buffer premultiplied by zeroing transparent colour', () => {
        const buf = src.slice()
        rtClearTransparent(buf)
        expect(Array.from(buf)).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0])
    })

    it('recolours exactly the masked pixels of a real vehicle sprite', () => {
        const image = PNG.sync.read(readFileSync(join(outDir, 'atlas.png')))
        const maskImage = PNG.sync.read(readFileSync(join(outDir, 'mask.png')))
        const channel = rtMaskChannel(maskImage.data)
        const rect = atlas.sprites['vehicle.train.diesel.e']!
        const companyRamp = rtCompanyRamp(rtCompanyColour(1))
        const dst = new Uint8Array(rect.w * rect.h * 4)
        rtRecolourInto(image.data, channel, image.width, rect, companyRamp, dst, rect.w, 0, 0)
        let recoloured = 0
        for (let y = 0; y < rect.h; y++) {
            for (let x = 0; x < rect.w; x++) {
                const p = (rect.y + y) * image.width + rect.x + x
                const d = (y * rect.w + x) * 4
                const shade = rtMaskShade(channel[p]!)
                if (image.data[p * 4 + 3] === 0) {
                    expect(dst[d + 3]).toBe(0)
                } else if (shade >= 0) {
                    recoloured++
                    expect([dst[d], dst[d + 1], dst[d + 2]]).toEqual([companyRamp[shade * 3], companyRamp[shade * 3 + 1], companyRamp[shade * 3 + 2]])
                } else {
                    expect([dst[d], dst[d + 1], dst[d + 2]]).toEqual([image.data[p * 4], image.data[p * 4 + 1], image.data[p * 4 + 2]])
                }
            }
        }
        expect(recoloured).toBeGreaterThan(0)
    })

    it('recolours vehicles, stations, depots and road stops only', () => {
        expect(rtIsRecolouredName('vehicle.road.bus.n')).toBe(true)
        expect(rtIsRecolouredName('station.rail.x.plain.rear')).toBe(true)
        expect(rtIsRecolouredName('depot.road.se.front')).toBe(true)
        expect(rtIsRecolouredName('roadstop.truck.nw.a')).toBe(true)
        expect(rtIsRecolouredName('house.large.0')).toBe(false)
        expect(rtIsRecolouredName('terrain.grass.flat')).toBe(false)
    })
})

describe('company sheet packing', () => {
    it('places every recoloured sprite inside the sheet without overlap', () => {
        const rects = Object.entries(atlas.sprites).filter(([name]) => rtIsRecolouredName(name)).map(([, r]) => r)
        const packing = rtPackRects(rects, 512)
        const boxes = rects.map((r, k) => ({ ...packing.slots[k]!, w: r.w, h: r.h }))
        for (const box of boxes) {
            expect(box.x).toBeGreaterThanOrEqual(1)
            expect(box.y).toBeGreaterThanOrEqual(1)
            expect(box.x + box.w).toBeLessThanOrEqual(511)
            expect(box.y + box.h).toBeLessThanOrEqual(packing.height - 1)
        }
        for (let a = 0; a < boxes.length; a++) {
            for (let b = a + 1; b < boxes.length; b++) {
                const p = boxes[a]!
                const q = boxes[b]!
                const apart = p.x + p.w + 1 <= q.x || q.x + q.w + 1 <= p.x || p.y + p.h + 1 <= q.y || q.y + q.h + 1 <= p.y
                expect(apart).toBe(true)
            }
        }
        expect(rtPackRects(rects, 512)).toEqual(packing)
    })

    it('refuses a sprite wider than the sheet', () => {
        expect(() => rtPackRects([{ w: 600, h: 4 }], 512)).toThrow(RangeError)
    })
})

describe('placeholder', () => {
    it('is a flat diamond: opaque in the middle, clear in the corners', () => {
        const px = rtPlaceholderPixels(64, 31, 0xff00ff)
        const alpha = (x: number, y: number) => px[(y * 64 + x) * 4 + 3]
        expect(alpha(32, 15)).toBe(255)
        expect(Array.from(px.slice((15 * 64 + 32) * 4, (15 * 64 + 32) * 4 + 3))).toEqual([255, 0, 255])
        expect(alpha(0, 0)).toBe(0)
        expect(alpha(63, 30)).toBe(0)
    })
})

describe('water animation', () => {
    it('walks the 8 frames once per water cycle', () => {
        const step = RT_WATER_CYCLE_MS / RT_WATER_FRAMES
        expect(rtWaterFrameAt(0)).toBe(0)
        for (let f = 0; f < 8; f++) expect(rtWaterFrameAt(f * step + 1)).toBe(f)
        expect(rtWaterFrameAt(RT_WATER_CYCLE_MS + 1)).toBe(0)
        expect(atlas.meta.waterFrames).toBe(RT_WATER_FRAMES)
    })
})

describe('sprite names', () => {
    it('knows the 19 atlas slopes and their corners', () => {
        expect(Object.keys(atlas.meta.slopes).sort()).toEqual([...slopeNames].sort())
        for (const name of slopeNames) {
            const meta = atlas.meta.slopes[name]!
            expect(RT_SLOPE_CORNERS[name]).toBe(meta.corners)
            expect(rtSlopeNameFromCorners(meta.corners, meta.steep)).toBe(name)
        }
        expect(rtSlopeNameFromCorners('wn', false)).toBe('nw')
        expect(() => rtSlopeNameFromCorners('n', true)).toThrow(RangeError)
    })

    it('names a sprite in the atlas for every terrain, water, coast, foundation and tree', () => {
        const wanted: string[] = []
        for (const slope of slopeNames) {
            wanted.push(rtTerrainSpriteName('grass', slope), rtTerrainSpriteName('rough', slope))
            const foundation = rtFoundationSpriteName(slope)
            if (foundation) wanted.push(foundation)
            if (slope !== 'flat') for (let f = 0; f < 8; f++) wanted.push(rtCoastSpriteName(slope, f))
        }
        for (let v = 0; v < 5; v++) wanted.push(rtTerrainSpriteName('rough', 'flat', v))
        for (let f = 0; f < 8; f++) wanted.push(rtWaterSpriteName(f))
        for (let t = 0; t < 12; t++) for (let s = 0; s < 7; s++) wanted.push(rtTreeSpriteName(t, s))
        expect(wanted.filter(n => !names.has(n))).toEqual([])
    })

    it('draws every rail piece set from atlas sprites', () => {
        for (const set of pieceSets()) {
            const sprites = rtRailSpriteNames(set)
            expect(sprites.length).toBeGreaterThan(0)
            expect(sprites.filter(n => !names.has(n))).toEqual([])
        }
        expect(rtRailSpriteNames([])).toEqual([])
        expect(rtRailSpriteNames(['y', 'x'])).toEqual(['rail.flat.x-y'])
        expect(rtRailSpriteNames(['s', 'n'])).toEqual(['rail.flat.n-s'])
        expect(rtRailSpriteNames(['x', 'n'])).toEqual(['rail.junction.no-se', 'rail.overlay.x', 'rail.overlay.n'])
        expect(rtRailSpriteNames(['y', 'e'])).toEqual(['rail.junction.no-sw', 'rail.overlay.y', 'rail.overlay.e'])
        expect(rtRailSpriteNames(RT_RAIL_PIECES)).toEqual(['rail.junction.all', ...RT_RAIL_PIECES.map(p => `rail.overlay.${p}`)])
    })

    it('uses the sloped rail sprite for a straight piece on its incline only', () => {
        expect(rtRailSpriteNames(['x'], 'ne')).toEqual(['rail.slope.ne'])
        expect(rtRailSpriteNames(['x'], 'sw')).toEqual(['rail.slope.sw'])
        expect(rtRailSpriteNames(['y'], 'se')).toEqual(['rail.slope.se'])
        expect(rtRailSpriteNames(['y'], 'nw')).toEqual(['rail.slope.nw'])
        expect(rtRailSpriteNames(['y'], 'ne')).toEqual(['rail.flat.y'])
        expect(rtRailSpriteNames(['x'], 'n')).toEqual(['rail.flat.x'])
    })

    it('names a road sprite for every side set and ramp', () => {
        for (const surface of ['grass', 'town'] as const) {
            for (let m = 1; m < 16; m++) {
                const sides = RT_SIDE_NAMES.filter((_, k) => m & (1 << k))
                expect(names.has(rtRoadSpriteName(surface, sides)!)).toBe(true)
            }
            for (const ramp of ['ne', 'se', 'sw', 'nw'] as const) {
                expect(rtRoadSpriteName(surface, ['ne', 'sw'], ramp)).toBe(`road.${surface}.slope-${ramp}`)
                expect(names.has(`road.${surface}.slope-${ramp}`)).toBe(true)
            }
        }
        expect(rtRoadSpriteName('grass', [])).toBeNull()
        expect(rtRoadSpriteName('town', ['nw', 'ne'])).toBe('road.town.ne-nw')
    })

    it('names crossings, signals, stations, depots and road stops in the atlas', () => {
        const wanted: string[] = []
        for (const surface of ['grass', 'town'] as const) {
            for (const axis of ['x', 'y'] as const) wanted.push(rtCrossingSpriteName(surface, axis, false), rtCrossingSpriteName(surface, axis, true))
        }
        for (const kind of ['block', 'path', 'path-oneway'] as const) {
            for (const dir of RT_SPRITE_DIRECTIONS) wanted.push(rtSignalSpriteName(kind, dir, false), rtSignalSpriteName(kind, dir, true))
        }
        for (const axis of ['x', 'y'] as const) {
            for (const building of [false, true]) {
                const parts = rtStationSpriteNames(axis, building)
                wanted.push(parts.rear, parts.front)
                expect(atlas.sprites[parts.rear]!.layer).toBe('rear')
                expect(atlas.sprites[parts.front]!.layer).toBe('front')
            }
        }
        for (const side of RT_SIDE_NAMES) {
            wanted.push(...rtDepotSpriteNames('rail', side), ...rtDepotSpriteNames('road', side))
            wanted.push(...rtRoadStopSpriteNames('bus', side), ...rtRoadStopSpriteNames('truck', side))
        }
        expect(wanted.filter(n => !names.has(n))).toEqual([])
        // every depot part in the atlas is one the helper names
        const depotParts = [...names].filter(n => n.startsWith('depot.'))
        expect(depotParts.sort()).toEqual(RT_SIDE_NAMES.flatMap(s => [...rtDepotSpriteNames('rail', s), ...rtDepotSpriteNames('road', s)]).sort())
    })

    it('names houses and every industry layout tile in the atlas', () => {
        const count = (prefix: string) => [...names].filter(n => n.startsWith(`${prefix}.`)).length
        for (let size = 0; size < RT_CATALOG.houses.classes.length; size++) {
            const prefix = ['house.small', 'house.medium', 'house.large'][size]!
            for (let v = 0; v < 20; v++) expect(names.has(rtHouseSpriteName(size, v, count(prefix)))).toBe(true)
        }
        expect(() => rtHouseSpriteName(3, 0, 1)).toThrow(RangeError)
        for (const type of RT_INDUSTRY_TYPE_IDS) {
            const layout = atlas.meta.industryLayouts[type]!
            expect(layout.length).toBeGreaterThan(0)
            for (const [, , tile] of layout) expect(names.has(rtIndustrySpriteName(type, tile))).toBe(true)
        }
    })

    it('names every vehicle model in all 8 directions, empty and loaded', () => {
        expect(atlas.meta.directions).toEqual(RT_SPRITE_DIRECTIONS)
        for (const model of RT_VEHICLE_MODEL_IDS) {
            for (const dir of RT_SPRITE_DIRECTIONS) {
                for (const loaded of [false, true]) expect(names.has(rtVehicleSpriteName(model, dir, loaded))).toBe(true)
            }
        }
        expect(rtVehicleSpriteName('coalLorry', 'sw', true)).toBe('vehicle.road.coal-full.sw')
    })
})

describe('map encoding bridge', () => {
    it('names every slope tileSlope can return', () => {
        // the lowest corner is never raised, so all four corner bits (15) cannot occur
        for (let bits = 0; bits < 15; bits++) {
            const name = rtSlopeNameFromBits(bits)
            expect([...RT_SLOPE_CORNERS[name]].length).toBe([RtSlope.n, RtSlope.e, RtSlope.s, RtSlope.w].filter(b => bits & b).length)
        }
        expect(rtSlopeNameFromBits(RtSlope.flat)).toBe('flat')
        expect(rtSlopeNameFromBits(RtSlope.ne)).toBe('ne')
        expect(rtSlopeNameFromBits(RtSlope.w | RtSlope.s)).toBe('sw')
        expect(rtSlopeNameFromBits(RtSlope.steep | RtSlope.e | RtSlope.n | RtSlope.w)).toBe('steep-n')
        expect(rtSlopeNameFromBits(RtSlope.steep | RtSlope.s | RtSlope.e | RtSlope.n)).toBe('steep-e')
    })

    it('reads road sides from road bits', () => {
        expect(rtRoadSidesFromBits(0)).toEqual([])
        expect(rtRoadSidesFromBits(RT_ROAD_DIR_BIT[RtDir.ne]!)).toEqual(['ne'])
        expect(rtRoadSidesFromBits(RT_ROAD_DIR_BIT[RtDir.nw]! | RT_ROAD_DIR_BIT[RtDir.se]!)).toEqual(['se', 'nw'])
        expect(rtRoadSidesFromBits(15)).toEqual(['ne', 'se', 'sw', 'nw'])
    })

    it('reads rail pieces from track bits through the table it is given', () => {
        const table = { x: 1, y: 2, n: 4, s: 8, w: 16, e: 32 }
        expect(rtRailPiecesFromBits(0, table)).toEqual([])
        expect(rtRailPiecesFromBits(1 | 4, table)).toEqual(['x', 'n'])
        expect(rtRailPiecesFromBits(63, table)).toEqual([...RT_RAIL_PIECES])
    })
})
