import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { createCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { nextSection, stepsFor, type Construction } from '#shared/utils/nitro-rush/construct'
import { compileCustomTrack, loopGap, rideTag, ROAD_WIDTHS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { finishLoop } from '#shared/utils/nitro-rush/finish-loop'
import { LOOPING_SHIFT, loopingShift } from '#shared/utils/nitro-rush/layout'
import { clearanceFault } from '#shared/utils/nitro-rush/road-checks'
import { ROAD, TRACKS } from '#shared/utils/nitro-rush/tracks'
import { drive, trackOf } from './bot-lap'

const DT = 1 / PHYSICS_HZ
const GAS = { throttle: 1, brake: 0, steer: 0, drift: false }
const course = (closed: boolean, sections: SectionId[]): CustomTrack => ({ id: 'custom-test', name: 'Test', closed, sections })
const sprint = (...sections: SectionId[]): SectionId[] => ['straight-20', 'start', 'straight-60', ...sections, 'straight-200', 'finish', 'straight-200']
const VERGE = ROAD.wallOffset - ROAD.halfWidth

describe('road widths', () => {
    it('steps the road in halves of the normal width', () => {
        expect(Object.values(ROAD_WIDTHS).map(w => w / ROAD.halfWidth)).toEqual([0.5, 1, 1.5, 2])
    })

    it('leaves every built-in course at the one road width', () => {
        for (const def of TRACKS) expect(def.halfWidths).toBeUndefined()
    })

    it('eases the road to a width piece\'s width, and keeps it until another changes it', () => {
        const walk = walkCustomTrack(course(false, ['straight-20', 'width-narrow', 'straight-60', 'right-tight', 'width-very-wide', 'straight-20']))
        const [, change, after, bend, widen, last] = walk.pieceStarts
        expect(walk.halfWidths[0]).toBe(ROAD.halfWidth)
        expect(walk.halfWidths[change! + 1]).toBeLessThan(ROAD.halfWidth)
        expect(walk.halfWidths[change! + 1]).toBeGreaterThan(ROAD_WIDTHS.narrow)
        for (const i of [after!, bend!, widen!]) expect(walk.halfWidths[i]).toBe(ROAD_WIDTHS.narrow)
        expect(walk.halfWidths[last!]).toBe(ROAD_WIDTHS.veryWide)
        expect(walk.walls[last!]).toBe(ROAD_WIDTHS.veryWide + VERGE)
        expect(walk.states.map(s => s.halfWidth)).toEqual([9, 9, 4.5, 4.5, 4.5, 18])
        expect(walk.end.halfWidth).toBe(ROAD_WIDTHS.veryWide)
    })

    it('gives a compiled course its widths, which the track blends between points', () => {
        const track = trackOf(false, sprint('width-wide', 'straight-100'))
        expect(track.def.halfWidths).toBeDefined()
        expect(track.halfWidthAt(0)).toBe(ROAD.halfWidth)
        expect(track.wallAt(track.finishS)).toBe(ROAD_WIDTHS.wide + VERGE)
        expect(track.maxWall).toBe(ROAD_WIDTHS.wide + VERGE)
        const mid = track.def.runUp! + 60 + 30
        expect(track.halfWidthAt(mid)).toBeGreaterThan(ROAD.halfWidth)
        expect(track.halfWidthAt(mid)).toBeLessThan(ROAD_WIDTHS.wide)
        expect(track.wallSlopeAt(mid)).toBeGreaterThan(0)
    })

    it('scales a boost pad to the road it\'s laid on', () => {
        const pad = trackOf(false, sprint('width-narrow', 'boost-pad-right')).boostPads[0]!
        expect(pad).toMatchObject({ latFrom: 0, latTo: ROAD_WIDTHS.narrow })
    })

    it('closes a loop only at its start\'s width', () => {
        // The rectangle, its long sides a width piece longer.
        const narrowed = (back: SectionId): SectionId[] => ['start', 'width-narrow', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', back, 'right-tight', 'right-tight']
        const narrow = course(true, narrowed('straight-60'))
        expect(compileCustomTrack(narrow).error).toMatch(/starting width/)
        expect(loopGap(walkCustomTrack(narrow)).width).toBe(ROAD_WIDTHS.narrow - ROAD.halfWidth)
        expect(compileCustomTrack(course(true, narrowed('width-normal'))).error).toBeNull()
    })

    it('finishes a loop by bringing the road back to its width first', () => {
        const t = course(true, ['start', 'straight-100', 'width-wide', 'right-tight'])
        const { sections, error } = finishLoop(t)
        expect(error).toBeNull()
        expect(sections![0]).toBe('width-normal')
        expect(compileCustomTrack({ ...t, sections: [...t.sections, ...sections!] }).error).toBeNull()
    })

    it('needs more room between wide roads than between normal ones', () => {
        // Two parallel runs 30 m apart, far apart along the road.
        const pts: [number, number][] = [...Array.from({ length: 60 }, (_, i) => [0, -i * 2] as [number, number]), ...Array.from({ length: 60 }, (_, i) => [30, -118 + i * 2] as [number, number])]
        const road = (wall: number) => ({ pts, ys: pts.map(() => 0), lifts: pts.map(() => 0), walls: pts.map(() => wall) })
        expect(clearanceFault(road(ROAD.wallOffset), false)).toBeNull()
        expect(clearanceFault(road(ROAD_WIDTHS.veryWide + VERGE), false)).toMatch(/passes/)
    })

    it('swings a looping on a very wide road further out, still on the grid', () => {
        expect(loopingShift(ROAD.wallOffset)).toBe(LOOPING_SHIFT)
        expect(loopingShift(ROAD_WIDTHS.veryWide + VERGE)).toBe(50)
        expect(compileCustomTrack(course(false, sprint('width-very-wide', 'looping-right', 'width-normal'))).error).toBeNull()
    })

    it('tags the sections a narrow or wide road carries', () => {
        expect(rideTag('straight-20', { bank: 0, grade: 0, halfWidth: ROAD_WIDTHS.narrow })).toBe('NARROW')
        expect(rideTag('straight-20', { bank: 0, grade: 0.1, halfWidth: ROAD_WIDTHS.wide })).toBe('UP WIDE')
        expect(rideTag('width-normal', { bank: 0, grade: 0, halfWidth: ROAD_WIDTHS.wide })).toBe('')
    })
})

describe('building at a width', () => {
    const choice: Construction = { curve: 'straight', size: 'medium', length: 60, slope: 'slope-flat', bank: 'bank-flat', width: 'width-wide' }

    it('lays the width piece before the road itself', () => {
        expect(nextSection(choice, { bank: 0, grade: 0, halfWidth: ROAD.halfWidth })).toBe('width-wide')
        expect(nextSection(choice, { bank: 0, grade: 0, halfWidth: ROAD_WIDTHS.wide })).toBe('straight-60')
    })

    it('reads the width the road already has', () => {
        expect(stepsFor({ bank: 0, grade: 0, halfWidth: ROAD_WIDTHS.narrow }).width).toBe('width-narrow')
        expect(stepsFor({ bank: 0, grade: 0, halfWidth: ROAD_WIDTHS.veryWide }).width).toBe('width-very-wide')
        expect(stepsFor({ bank: 0, grade: 0, halfWidth: ROAD.halfWidth }).width).toBe('width-normal')
    })
})

describe('driving at a width', () => {
    it('holds the car inside a narrow road\'s walls', () => {
        const track = trackOf(false, sprint('width-narrow', 'straight-200'))
        const car = createCar(track, track.def.runUp! + 150, ROAD_WIDTHS.narrow - 1)
        car.speed = 40
        // Toward the right-hand wall.
        car.heading -= 0.15
        car.travel = car.heading
        let hit = false
        for (let i = 0; i < PHYSICS_HZ * 2; i++) {
            hit ||= stepCar(car, GAS, track, DT).wallImpact > 0
            expect(Math.abs(car.proj.lateral)).toBeLessThanOrEqual(track.wallAt(car.proj.s) + 1e-6)
        }
        expect(hit).toBe(true)
    })

    it('runs a car along the edge into the walls where the road narrows', () => {
        const track = trackOf(false, sprint('width-narrow'))
        const lateral = ROAD.halfWidth
        const car = createCar(track, track.def.runUp! + 30, lateral)
        car.speed = 40
        let impact = 0
        for (let i = 0; i < PHYSICS_HZ * 3 && car.proj.s < track.def.runUp! + 160; i++) impact = Math.max(impact, stepCar(car, GAS, track, DT).wallImpact)
        expect(impact).toBeGreaterThan(1)
        expect(Math.abs(car.proj.lateral)).toBeLessThan(ROAD_WIDTHS.narrow + VERGE)
    })

    it('lets the bot drive a course of every width, and the server take its lap', () => {
        const track = trackOf(false, sprint('width-narrow', 'left-medium', 'width-wide', 'straight-100', 'width-very-wide', 'right-medium', 'width-normal', 'straight-100', 'width-narrow', 'straight-100', 'width-normal'))
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
    })
})
