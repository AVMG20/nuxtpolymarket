import { describe, expect, it } from 'vitest'
import { compileCustomTrack, MAX_SECTIONS, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { finishLoop } from '#shared/utils/nitro-rush/finish-loop'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { drive } from './bot-lap'
import { Track } from '#shared/utils/nitro-rush/track'

const loop = (sections: SectionId[]): CustomTrack => ({ id: 'custom-t', name: 'T', closed: true, sections })

/** Finishes a course and proves the result is a course. */
function finished(sections: SectionId[]) {
    const result = finishLoop(loop(sections))
    expect(result.error, sections.join(' ')).toBeNull()
    const whole = loop([...sections, ...result.sections!])
    const compiled = compileCustomTrack(whole)
    expect(compiled.error, whole.sections.join(' ')).toBeNull()
    return { extra: result.sections!, def: compiled.def! }
}

describe('finishing a loop', () => {
    it('adds nothing to a loop that already closes', () => {
        const closing: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
        expect(compileCustomTrack(loop(closing)).error).toBeNull()
        expect(finishLoop(loop(closing))).toEqual({ sections: [], error: null })
    })

    it.each<[string, SectionId[]]>([
        ['heading away', ['start', 'straight-200']],
        ['on a diagonal', ['start', 'straight-60', 'left-eighth', 'straight-20']],
        ['banked, sloped and diagonal', ['start', 'bank-right', 'slope-up', 'right-eighth', 'straight-20']],
        ['off a spiral', ['start', 'straight-60', 'right-spiral-up', 'straight-60']],
        ['after a stunt', ['start', 'straight-100', 'looping-left', 'straight-60', 'jump']]
    ])('closes a road that ends %s', (_, sections) => {
        finished(sections)
    })

    it('never routes through its own start line', () => {
        const { extra } = finished(['start', 'straight-60', 'left-wide', 'left-hairpin'])
        expect(extra.length).toBeGreaterThan(0)
    })

    it('makes a road the bot can actually lap', () => {
        const { def } = finished(['start', 'bank-right', 'slope-up', 'straight-60', 'right-wide'])
        const road = new Track(def)
        expect(ghostDrivesTrack(road, drive(road))).toBe(true)
    })

    it('only ever lays a valid course on random roads', () => {
        // A fixed sequence, so a failure reproduces.
        let seed = 12345
        const rand = (n: number) => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return Math.floor(seed / 4294967296 * n)
        }
        const pool: SectionId[] = ['straight-20', 'straight-60', 'straight-100', 'left-tight', 'right-tight', 'left-medium', 'right-wide', 'left-eighth', 'right-eighth', 'left-hairpin', 'bank-right', 'bank-flat', 'slope-up', 'slope-flat', 'slope-up-steep', 'slope-down', 'ramp-up']
        for (let i = 0; i < 40; i++) {
            const sections: SectionId[] = ['start', ...Array.from({ length: 1 + rand(10) }, () => pool[rand(pool.length)]!)]
            const result = finishLoop(loop(sections))
            if (result.sections) expect(compileCustomTrack(loop([...sections, ...result.sections])).error, sections.join(' ')).toBeNull()
        }
    }, 60_000)

    it('says what\'s wrong rather than papering over it', () => {
        expect(finishLoop(loop(['straight-60'])).error).toMatch(/start block/)
        expect(finishLoop(loop(['start', 'straight-60', 'start'])).error).toMatch(/start block/)
        expect(finishLoop(loop(['start', 'slope-up', 'jump', 'straight-20'])).error).toMatch(/level the road out/)
    })

    it('climbs back to the start line from a road that already dug in, and it can be driven', () => {
        const { def } = finished(['start', 'slope-down', 'straight-60'])
        expect(Math.min(...def.heights!)).toBeCloseTo(0)
        const road = new Track(def)
        expect(ghostDrivesTrack(road, drive(road))).toBe(true)
    })

    it('owns up when there\'s no way back', () => {
        // Two stretches at ground level hem in the last run to the line.
        expect(finishLoop(loop(['start', 'left-eighth', 'left-hairpin', 'ramp-up']))).toEqual({ sections: null, error: expect.stringMatching(/no way back/) })
    })

    it('says so when the road already crosses itself', () => {
        const crossing: SectionId[] = ['start', 'left-eighth', 'left-eighth', 'left-hairpin', 'right-wide', 'bank-right', 'straight-100', 'left-medium']
        expect(finishLoop(loop(crossing)).error).toMatch(/passes .* from another stretch/)
    })

    it('won\'t go over the section limit', () => {
        const nearly = Array.from({ length: MAX_SECTIONS - 2 }, () => 'straight-10' as SectionId)
        const { sections, error } = finishLoop(loop(['start', ...nearly]))
        expect(sections).toBeNull()
        expect(error).toMatch(/more sections/)
    })
})
