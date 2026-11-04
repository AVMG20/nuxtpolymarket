import { describe, expect, it } from 'vitest'
import { compileCustomTrack, loopGap, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'

const course = (closed: boolean, sections: SectionId[]): CustomTrack => ({ id: 'custom-t', name: 'T', closed, sections })
const sprint = (sections: SectionId[]) => course(false, ['straight-20', 'start', 'straight-60', ...sections, 'finish', 'straight-200'])

describe('slope state', () => {
    it('keeps every state change on whole metres, however a bend measures', () => {
        for (const bend of ['left-tight', 'right-medium', 'left-eighth', 'right-eighth-wide', 'left-hairpin', 'right-hairpin-wide', 'left-eighth-tight'] as SectionId[]) {
            const { end } = walkCustomTrack(course(false, ['slope-up', 'straight-60', bend, 'straight-20', bend, 'slope-flat']))
            expect(Math.abs(end.y - Math.round(end.y)), bend).toBeLessThan(1e-6)
        }
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
    })
})
