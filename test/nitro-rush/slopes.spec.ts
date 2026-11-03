import { describe, expect, it } from 'vitest'
import { compileCustomTrack, lastPieceWalk, loopGap, rideTag, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { SLOPE_LENGTH } from '#shared/utils/nitro-rush/layout'
import { Track } from '#shared/utils/nitro-rush/track'
import { createCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive, trackOf } from './bot-lap'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'

const course = (closed: boolean, sections: SectionId[]): CustomTrack => ({ id: 'custom-t', name: 'T', closed, sections })
const sprint = (sections: SectionId[]) => course(false, ['straight-20', 'start', 'straight-60', ...sections, 'finish', 'straight-200'])
const worstStep = (values: ArrayLike<number>) => {
    let worst = 0
    for (let i = 1; i < values.length; i++) worst = Math.max(worst, Math.abs(values[i]! - values[i - 1]!))
    return worst
}

describe('slope state', () => {
    it('holds the grade through straights and bends until a slope piece levels it', () => {
        const walk = walkCustomTrack(course(false, ['slope-up', 'straight-100', 'right-tight', 'slope-flat', 'straight-20']))
        expect(walk.states.map(s => s.grade)).toEqual([0, 0.1, 0.1, 0.1, 0])
        // The ease in, half the grade over its length, then the straight's own 10 m.
        const straightAt = walk.pieceStarts[1]!
        expect(walk.ys[straightAt]).toBeCloseTo(SLOPE_LENGTH * 0.1 / 2)
        expect(walk.ys[walk.pieceStarts[2]!]).toBeCloseTo(2 + 10)
        expect(walk.end.grade).toBe(0)
    })

    it('never kinks the road, even from steep down to steep up', () => {
        const t = new Track(compileCustomTrack(sprint(['slope-up-steep', 'straight-100', 'slope-down-steep', 'straight-100', 'slope-up-steep', 'straight-20', 'slope-down', 'straight-60', 'slope-flat'])).def!)
        expect(worstStep(t.grades)).toBeLessThan(0.05)
    })

    it('keeps every state change on whole metres, however a bend measures', () => {
        for (const bend of ['left-tight', 'right-medium', 'left-eighth', 'right-eighth-wide', 'left-hairpin', 'right-hairpin-wide', 'left-eighth-tight'] as SectionId[]) {
            const { end } = walkCustomTrack(course(false, ['slope-up', 'straight-60', bend, 'straight-20', bend, 'slope-flat']))
            expect(Math.abs(end.y - Math.round(end.y)), bend).toBeLessThan(1e-6)
        }
    })

    it('closes a loop whose bends climb gently and fall steeply, thanks to whole metres', () => {
        const { def, error } = compileCustomTrack(course(true, [
            'start', 'slope-up', 'straight-60', 'right-tight', 'right-tight',
            'slope-up-steep', 'straight-20', 'straight-20', 'straight-10', 'slope-down-steep', 'straight-20', 'straight-10', 'right-tight', 'right-tight', 'slope-flat'
        ]))
        expect(error).toBeNull()
        // 36 m at the crest's lip, and 2 m more easing from steep up to steep down.
        expect(Math.max(...def!.heights!)).toBeCloseTo(38)
    })

    it('adds on top of a ramp and a spiral, and rides a bank', () => {
        const flat = walkCustomTrack(course(false, ['ramp-up'])).end.y
        const onSlope = walkCustomTrack(course(false, ['slope-up', 'ramp-up']))
        expect(onSlope.end.y).toBeCloseTo(2 + flat + 15)
        const both = compileCustomTrack(sprint(['bank-right', 'slope-up', 'straight-60', 'right-wide', 'slope-flat', 'bank-flat']))
        expect(both.error).toBeNull()
        const road = new Track(both.def!)
        expect(worstStep(road.grades)).toBeLessThan(0.05)
    })

    it('asks for level road before a line or stunt, and before the course ends', () => {
        for (const piece of ['jump', 'looping-left', 'corkscrew-right', 'checkpoint', 'finish'] as SectionId[]) {
            expect(compileCustomTrack(sprint(['slope-up', 'straight-20', piece])).error, piece).toMatch(/level the road out/)
        }
        expect(compileCustomTrack(course(false, ['straight-20', 'start', 'straight-60', 'finish', 'straight-200', 'slope-up'])).error).toMatch(/level out/)
        expect(loopGap(walkCustomTrack(course(true, ['start', 'slope-up']))).grade).toBe(0.1)
    })

    describe('a road that digs down', () => {
        const dug = sprint(['slope-down', 'straight-20', 'slope-flat'])

        it('lifts as a whole, so its lowest point sits on the ground and the climb is unchanged', () => {
            const walk = walkCustomTrack(dug)
            expect(walk.rise).toBeCloseTo(6)
            expect(walk.ys[0]).toBeCloseTo(walk.rise)
            expect(Math.min(...walk.ys)).toBeCloseTo(0)
            const def = compileCustomTrack(dug).def!
            expect(Math.min(...def.heights!)).toBeCloseTo(0)
            expect(def.heights![0]).toBeCloseTo(walk.rise)
        })

        it('leaves a road that never goes below where it set off alone', () => {
            const walk = walkCustomTrack(sprint(['slope-up', 'straight-20', 'slope-flat']))
            expect(walk.rise).toBe(0)
            expect(walk.ys[0]).toBe(0)
        })

        it('can be driven from its raised start line', () => {
            const road = new Track(compileCustomTrack(dug).def!)
            expect(ghostDrivesTrack(road, drive(road))).toBe(true)
        })

        it('tells a loop how far it has left to climb back to its start line', () => {
            expect(loopGap(walkCustomTrack(course(true, ['start', 'slope-down', 'straight-20', 'slope-flat']))).climb).toBeCloseTo(-6)
        })
    })

    it('tags a section with what it rides, but not a piece that sets that state', () => {
        expect(rideTag('straight-20', { bank: 0, grade: 0 })).toBe('')
        expect(rideTag('straight-20', { bank: 25, grade: 0.1 })).toBe('BANKED UP')
        expect(rideTag('right-tight', { bank: 0, grade: -0.2 })).toBe('DOWN')
        expect(rideTag('slope-flat', { bank: 0, grade: 0.1 })).toBe('')
        expect(rideTag('bank-flat', { bank: 25, grade: 0.1 })).toBe('UP')
    })

    it('cuts the last piece out of its walk, keeping where it ends', () => {
        const walk = walkCustomTrack(course(false, ['straight-20', 'slope-up']))
        const piece = lastPieceWalk(walk)
        expect(piece.pts[0]).toEqual(walk.pts[walk.pieceStarts[1]!])
        expect(piece.pts).toHaveLength(walk.pts.length - walk.pieceStarts[1]!)
        expect(piece.states).toEqual([walk.states[1]])
        expect(piece.end).toEqual(walk.end)
    })
})

describe('driving a slope', () => {
    const COAST = { throttle: 1, brake: 0, steer: 0, drift: false }

    it('still climbs the steepest grade from a standing start', () => {
        const t = new Track(compileCustomTrack(sprint(['slope-up-steep', 'straight-200', 'straight-200', 'slope-flat'])).def!)
        const car = createCar(t, t.startS + 60 + SLOPE_LENGTH, 0)
        for (let i = 0; i < 120 * 30 && car.proj.s < t.startS + 400; i++) stepCar(car, COAST, t, 1 / 120)
        expect(car.proj.s).toBeGreaterThan(t.startS + 400)
        expect(car.speed).toBeGreaterThan(10)
    })

    it('passes a real lap on a sprint and a loop with slopes', () => {
        const hill = trackOf(false, ['straight-20', 'start', 'straight-100', 'slope-up', 'straight-100', 'right-wide', 'slope-up-steep', 'straight-60', 'slope-flat', 'straight-60', 'slope-down', 'left-wide', 'straight-100', 'slope-flat', 'straight-20', 'finish', 'straight-200'])
        expect(ghostDrivesTrack(hill, drive(hill))).toBe(true)
    })
})
