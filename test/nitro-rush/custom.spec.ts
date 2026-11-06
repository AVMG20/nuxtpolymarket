import { describe, expect, it } from 'vitest'
import { compileCustomTrack, isCustomTrackId, isSectionId, loopGap, MAX_NAME_LENGTH, MAX_SECTIONS, newCustomTrack, sanitizeCustomTrack, SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { Track } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'

const course = (closed: boolean, sections: SectionId[]): CustomTrack => ({ id: 'custom-test', name: 'Test', closed, sections })
const loop = (sections: SectionId[]) => course(true, sections)
const sprint = (sections: SectionId[]) => course(false, sections)

/** A rounded rectangle, closed by tight right-handers. */
const RECTANGLE: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']

describe('custom track sections', () => {
    /** Small courses that between them lay every section in the catalogue. */
    const courses = [
        loop(RECTANGLE),
        loop(['start', 'straight-10', 'straight-10', 'right-tight', 'right-tight', 'straight-20', 'straight-20', 'right-tight', 'right-tight']),
        loop(['start', 'straight-100', 'right-hairpin', 'straight-100', 'straight-20', 'right-hairpin']),
        loop(['start', 'straight-100', 'left-hairpin', 'straight-100', 'straight-20', 'left-hairpin']),
        sprint(['straight-20', 'start', 'straight-100', 'left-spiral-up', 'straight-100', 'left-wide', 'ramp-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'right-spiral-up', 'straight-100', 'right-wide', 'ramp-down', 'checkpoint', 'left-eighth', 'straight-60', 'right-eighth', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'ramp-up', 'straight-100', 'left-spiral-down', 'straight-100', 'left-tight', 'straight-100', 'ramp-up', 'straight-100', 'right-spiral-down', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-200', 'jump', 'straight-100', 'big-jump', 'straight-100', 'looping-left', 'straight-100', 'looping-right', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'right-quarter-spiral-up', 'straight-60', 'left-quarter-spiral-up', 'straight-60', 'left-quarter-spiral-down', 'straight-60', 'right-quarter-spiral-down', 'straight-100', 'left-half-spiral-up', 'straight-200', 'right-half-spiral-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'left-quarter-spiral-up', 'straight-60', 'right-quarter-spiral-up', 'straight-60', 'right-quarter-spiral-down', 'straight-60', 'left-quarter-spiral-down', 'straight-100', 'right-half-spiral-up', 'straight-200', 'left-half-spiral-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'bank-left', 'corkscrew-left', 'bank-right', 'corkscrew-right', 'bank-flat', 'straight-100', 'right-banked', 'straight-100', 'left-banked', 'steep-up', 'steep-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'bank-left', 'straight-100', 'left-tight', 'bank-flat', 'straight-60', 'bank-right', 'right-wide', 'bank-flat', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'slope-up', 'straight-20', 'slope-up-steep', 'straight-20', 'slope-down', 'slope-down-steep', 'slope-flat', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'left-medium', 'straight-100', 'right-medium', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'left-eighth-tight', 'straight-100', 'right-eighth-tight', 'straight-100', 'left-eighth-wide', 'straight-100', 'right-eighth-wide', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'boost-pad', 'boost-pad-left', 'boost-pad-right', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-200', 'left-hairpin-medium', 'straight-200', 'right-hairpin-medium', 'straight-200', 'left-hairpin-wide', 'straight-200', 'right-hairpin-wide', 'straight-200', 'finish', 'straight-200'])
    ]

    it('can each be laid in a course that compiles', () => {
        const used = new Set(courses.flatMap(c => c.sections))
        expect(Object.keys(SECTIONS).filter(id => !used.has(id as SectionId))).toEqual([])
        for (const c of courses) {
            const { def, error } = compileCustomTrack(c)
            expect(error, c.sections.join(', ')).toBeNull()
            expect(def!.id).toBe(c.id)
            const t = new Track(def!)
            expect(t.closed).toBe(c.closed)
        }
    })

    it('recognises only catalogue ids as sections', () => {
        expect(isSectionId('straight-100')).toBe(true)
        for (const id of ['nope', '__proto__', 'toString', 'constructor', 'hasOwnProperty', '', 7, null, undefined, {}]) {
            expect(isSectionId(id)).toBe(false)
        }
    })
})

describe('banks', () => {
    it('has to level out before a course ends', () => {
        expect(compileCustomTrack(sprint(['straight-20', 'start', 'straight-20', 'bank-left', 'finish', 'bank-flat', 'straight-200'])).error).toMatch(/a finish line needs flat, unbanked road: level the bank first/)
        expect(compileCustomTrack(sprint(['straight-20', 'start', 'straight-20', 'finish', 'straight-100', 'bank-left'])).error).toMatch(/level out before it ends/)
        const open = ['start', 'straight-60', 'bank-right', 'right-tight', 'right-tight', 'straight-60', 'straight-60', 'right-tight', 'right-tight'] as SectionId[]
        const { error } = compileCustomTrack(loop(open))
        expect(error).toMatch(/closing the loop|level out/)
    })

    it('refuses stunts and lines on a bank, naming what to level out for', () => {
        const on = (piece: SectionId) => compileCustomTrack(sprint(['straight-20', 'start', 'bank-left', 'straight-20', piece, 'straight-100', 'bank-flat', 'finish', 'straight-200'])).error
        expect(on('jump')).toMatch(/a jump needs flat, unbanked road: level the bank first/)
        expect(on('looping-left')).toMatch(/a looping needs flat/)
        expect(on('checkpoint')).toMatch(/a checkpoint needs flat/)
        expect(walkCustomTrack(sprint(['bank-left', 'jump'])).misplaced).toMatch(/a jump needs flat/)
        expect(walkCustomTrack(sprint(['bank-left', 'bank-flat', 'jump'])).misplaced).toBeNull()
    })

    it('closes a loop through a bank, and tells a loop still banked to level', () => {
        const home: SectionId[] = ['start', 'straight-60', 'bank-right', 'right-tight', 'right-tight', 'bank-flat', 'straight-60', 'straight-20', 'right-tight', 'right-tight']
        const { def, error } = compileCustomTrack(loop(home))
        expect(error).toBeNull()
        expect(new Track(def!).ys.some(y => y > 4)).toBe(true)
        const gap = loopGap(walkCustomTrack(loop(['start', 'bank-right'])))
        expect(gap.bank).toBeCloseTo(25)
        expect(gap.climb).toBeCloseTo(0)
        expect(loopGap(walkCustomTrack(loop(home))).bank).toBe(0)
    })

    it('measures a crossing from a bank\'s raised edge, not its centre', () => {
        // The upper road crosses 12 m up and 130 m along: clear of the lower one's centre on a bank, but not of its raised edge.
        const over = (under: SectionId[]) => compileCustomTrack(sprint(['straight-20', 'start', ...under, 'right-hairpin', 'ramp-up', 'right-tight', 'straight-200', 'finish', 'straight-100'])).error
        expect(over(['straight-200', 'straight-100'])).toBeNull()
        expect(over(['straight-60', 'bank-right', 'straight-20', 'bank-flat', 'straight-100'])).toMatch(/passes .* from another stretch/)
    })
})

describe('compileCustomTrack', () => {
    it('reports why a fresh course does not compile yet, without the track id', () => {
        for (const closed of [true, false]) {
            const t = newCustomTrack(closed)
            expect(t.closed).toBe(closed)
            const { def, error } = compileCustomTrack(t)
            expect(def).toBeNull()
            expect(error).toBeTruthy()
            expect(error).not.toMatch(/^Track /)
            expect(error).not.toContain(t.id)
        }
        expect(compileCustomTrack(newCustomTrack(true)).error).toMatch(/closing the loop/)
        expect(compileCustomTrack(newCustomTrack(false)).error).toMatch(/one finish/)
    })

    it('returns an error for a course with no sections, rather than throwing', () => {
        for (const closed of [true, false]) {
            const result = compileCustomTrack(course(closed, []))
            expect(result.def).toBeNull()
            expect(result.error).toBeTruthy()
        }
    })
})

describe('loopGap', () => {
    it('is nothing on a closed loop', () => {
        const gap = loopGap(walkCustomTrack(loop(RECTANGLE)))
        expect(gap.distance).toBeCloseTo(0, 6)
        expect(gap.turn).toBeCloseTo(0)
        expect(gap.climb).toBeCloseTo(0, 6)
    })
})

describe('sanitizeCustomTrack', () => {
    const valid = { id: 'custom-abc', name: 'Neon Ring', closed: true, sections: [...RECTANGLE] }

    it('keeps a valid stored course, with its own copy of the sections', () => {
        const t = sanitizeCustomTrack(valid)
        expect(t).toEqual(valid)
        expect(t!.sections).not.toBe(valid.sections)
        expect(sanitizeCustomTrack(newCustomTrack(false))).not.toBeNull()
    })

    it('rejects anything that is not an object', () => {
        for (const raw of [null, undefined, 0, 'custom-abc', true, []]) expect(sanitizeCustomTrack(raw)).toBeNull()
    })

    it('rejects a wrong id, unknown sections and wrong types', () => {
        const bad = [
            { ...valid, id: 'polytown-oval' },
            { ...valid, id: 42 },
            { ...valid, name: 7 },
            { ...valid, closed: 'yes' },
            { ...valid, sections: 'start' },
            { ...valid, sections: ['start', 'teleporter'] },
            { ...valid, sections: ['start', '__proto__'] },
            { ...valid, sections: ['start', 'toString'] },
            { ...valid, sections: ['start', 3] },
            { ...valid, sections: Array.from({ length: MAX_SECTIONS + 1 }, () => 'straight-20') }
        ]
        for (const raw of bad) expect(sanitizeCustomTrack(raw)).toBeNull()
        expect(sanitizeCustomTrack({ ...valid, sections: Array.from({ length: MAX_SECTIONS }, () => 'straight-20') })).not.toBeNull()
    })

    it('clips an over-long name', () => {
        const t = sanitizeCustomTrack({ ...valid, name: 'x'.repeat(MAX_NAME_LENGTH * 3) })
        expect(t!.name).toHaveLength(MAX_NAME_LENGTH)
    })
})

describe('custom track ids', () => {
    it('never collide with a built-in course', () => {
        for (const t of TRACKS) expect(isCustomTrackId(t.id)).toBe(false)
        expect(isCustomTrackId(newCustomTrack().id)).toBe(true)
        expect(newCustomTrack().id).not.toBe(newCustomTrack().id)
    })
})
