import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useNitroRushTrackDraft } from '../../app/composables/useNitroRushTrackDraft'
import { compileCustomTrack, MAX_SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
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
    it('turns a lone start line into a compact oval', () => {
        const { extra, def } = finished(['start'])
        expect(extra.length).toBeLessThanOrEqual(8)
        expect(new Track(def).length).toBeLessThan(500)
    })

    it('adds nothing to a loop that already closes', () => {
        const closing: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
        expect(compileCustomTrack(loop(closing)).error).toBeNull()
        expect(finishLoop(loop(closing))).toEqual({ sections: [], error: null })
    })

    it.each<[string, SectionId[]]>([
        ['heading away', ['start', 'straight-200']],
        ['heading sideways', ['start', 'straight-60', 'right-tight', 'straight-100']],
        ['heading back', ['start', 'straight-60', 'left-hairpin-medium', 'straight-200']],
        ['on a diagonal', ['start', 'straight-60', 'left-eighth', 'straight-20']],
        ['on the other diagonal', ['start', 'right-eighth-wide', 'straight-10', 'left-hairpin']],
        ['banked', ['start', 'bank-right', 'straight-60']],
        ['banked round a bend', ['start', 'bank-left', 'left-wide']],
        ['climbing', ['start', 'slope-up', 'straight-60']],
        ['climbing steeply', ['start', 'slope-up-steep', 'straight-100', 'right-medium']],
        ['coming down', ['start', 'slope-up-steep', 'straight-100', 'slope-down', 'straight-20']],
        ['high and level', ['start', 'ramp-up', 'ramp-up', 'steep-up']],
        ['a metre up and falling', ['start', 'slope-up', 'slope-flat', 'slope-down', 'straight-10']],
        ['banked, sloped and diagonal', ['start', 'bank-right', 'slope-up', 'right-eighth', 'straight-20']],
        ['off a spiral', ['start', 'straight-60', 'right-spiral-up', 'straight-60']],
        ['after a stunt', ['start', 'straight-100', 'looping-left', 'straight-60', 'jump']]
    ])('closes a road that ends %s', (_, sections) => {
        finished(sections)
    })

    it('finds a way out from inside a curl of its own road', () => {
        finished(['start', 'straight-100', 'straight-100', 'right-wide', 'straight-200', 'right-wide', 'straight-200', 'right-wide', 'straight-60', 'right-tight', 'straight-60'])
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
        let solved = 0
        let tried = 0
        for (let i = 0; i < 150; i++) {
            const sections: SectionId[] = ['start', ...Array.from({ length: 1 + rand(10) }, () => pool[rand(pool.length)]!)]
            const walk = walkCustomTrack(loop(sections))
            // Only a road with nothing already wrong with it can be finished.
            if (walk.ys.some((y, k) => y - walk.lifts[k]! < -0.01)) continue
            tried++
            const result = finishLoop(loop(sections))
            if (result.sections) {
                solved++
                expect(compileCustomTrack(loop([...sections, ...result.sections])).error, sections.join(' ')).toBeNull()
            }
        }
        expect(tried).toBeGreaterThan(50)
        expect(solved / tried).toBeGreaterThan(0.9)
    }, 60_000)

    it('says what\'s wrong rather than papering over it', () => {
        expect(finishLoop(loop(['straight-60'])).error).toMatch(/start block/)
        expect(finishLoop(loop(['start', 'straight-60', 'start'])).error).toMatch(/start block/)
        expect(finishLoop(loop(['start', 'slope-up', 'jump', 'straight-20'])).error).toMatch(/level the road out/)
    })

    it.each<[string, SectionId[]]>([
        ['its own new road', ['start', 'left-medium', 'left-hairpin']],
        ['the road to level on', ['start', 'bank-right', 'left-eighth', 'left-eighth-tight', 'left-hairpin-wide']],
        ['every bend off a diagonal', ['start', 'right-eighth', 'right-wide', 'right-hairpin']]
    ])('turns first when going straight on is blocked by %s', (_, sections) => {
        finished(sections)
    })

    it.each<[string, SectionId[]]>([
        ['that already dug in', ['start', 'slope-down', 'straight-60']],
        ['heading steeply down near where it set off', ['start', 'slope-up', 'slope-down-steep']]
    ])('climbs back to the start line from a road %s, and it can be driven', (_, sections) => {
        const { def } = finished(sections)
        expect(Math.min(...def.heights!)).toBeCloseTo(0)
        const road = new Track(def)
        expect(ghostDrivesTrack(road, drive(road))).toBe(true)
    })

    it('stays above the ground when it can, so the start line doesn\'t move', () => {
        const dug = walkCustomTrack(loop(['start', 'slope-down', 'straight-20', 'slope-flat']))
        const { def } = finished(['start', 'slope-down', 'straight-20', 'slope-flat'])
        expect(def.heights![0]).toBeCloseTo(dug.rise)
    })

    it('owns up when there\'s no way back', () => {
        // Two stretches at ground level hem in the last run to the line.
        expect(finishLoop(loop(['start', 'left-eighth', 'left-hairpin', 'ramp-up']))).toEqual({ sections: null, error: expect.stringMatching(/no way back/) })
    })

    it('says so when the road already crosses itself', () => {
        const crossing: SectionId[] = ['start', 'left-eighth', 'left-eighth', 'left-hairpin', 'right-wide', 'bank-right', 'straight-100', 'left-medium']
        expect(finishLoop(loop(crossing)).error).toMatch(/passes .* from another stretch/)
    })

    it('knows a road with a fault in it before looking for a way home', () => {
        const started = performance.now()
        for (let i = 0; i < 200; i++) finishLoop(loop(['straight-60']))
        expect(performance.now() - started).toBeLessThan(500)
    })

    it('takes one undo to put back, and says why when it can\'t', () => {
        const initial = ref(loop(['start', 'bank-right', 'slope-up', 'straight-60']))
        const { draft, compiled, cursor, closeLoop, undo } = useNitroRushTrackDraft(initial)
        closeLoop()
        expect(compiled.value.error).toBeNull()
        expect(cursor.value).toBe(draft.value.sections.length - 1)
        undo()
        expect(draft.value).toBe(initial.value)

        const stuck = useNitroRushTrackDraft(ref(loop(['straight-60'])))
        stuck.closeLoop()
        expect(stuck.loopError.value).toMatch(/start block/)
        stuck.setClosed(false)
        expect(stuck.loopError.value).toBeNull()
    })

    it('won\'t go over the section limit', () => {
        const nearly = Array.from({ length: MAX_SECTIONS - 2 }, () => 'straight-10' as SectionId)
        const { sections, error } = finishLoop(loop(['start', ...nearly]))
        expect(sections).toBeNull()
        expect(error).toMatch(/more sections/)
    })
})
