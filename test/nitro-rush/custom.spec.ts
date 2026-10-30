import { describe, expect, it } from 'vitest'
import { compileCustomTrack, draftTrackDef, isCustomTrackId, isSectionId, loopGap, MAX_NAME_LENGTH, MAX_SECTIONS, newCustomTrack, pieceAt, sanitizeCustomTrack, SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { walkLayout } from '#shared/utils/nitro-rush/layout'
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
        loop(['start', 'straight-100', 'right-hairpin', 'straight-100', 'straight-20', 'right-hairpin']),
        loop(['start', 'straight-100', 'left-hairpin', 'straight-100', 'straight-20', 'left-hairpin']),
        sprint(['straight-20', 'start', 'straight-100', 'left-spiral-up', 'straight-100', 'left-wide', 'ramp-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'right-spiral-up', 'straight-100', 'right-wide', 'ramp-down', 'checkpoint', 'left-eighth', 'straight-50', 'right-eighth', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'ramp-up', 'straight-100', 'left-spiral-down', 'straight-100', 'left-tight', 'straight-100', 'ramp-up', 'straight-100', 'right-spiral-down', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-200', 'jump', 'straight-100', 'big-jump', 'straight-100', 'looping-left', 'straight-100', 'looping-right', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'corkscrew-left', 'straight-100', 'corkscrew-right', 'straight-100', 'right-banked', 'straight-100', 'left-banked', 'steep-up', 'steep-down', 'finish', 'straight-200'])
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

    it('names the course after the player, and an untitled one when the name is blank', () => {
        expect(compileCustomTrack({ ...loop(RECTANGLE), name: '  Neon Ring ' }).def!.name).toBe('Neon Ring')
        expect(compileCustomTrack({ ...loop(RECTANGLE), name: '   ' }).def!.name).toBeTruthy()
    })
})

describe('loopGap', () => {
    it('reports the distance, turn and climb an unfinished loop has left', () => {
        const straightOn = loopGap(walkCustomTrack(loop(['start'])))
        expect(straightOn.distance).toBeCloseTo(20)
        expect(straightOn.turn).toBeCloseTo(0)
        expect(straightOn.climb).toBeCloseTo(0)
        // Turned right a quarter, the way home is a quarter turn to the left (-).
        const right = loopGap(walkCustomTrack(loop(['start', 'straight-100', 'right-tight'])))
        expect(right.distance).toBeGreaterThan(0)
        expect(right.turn).toBe(-90)
        expect(loopGap(walkCustomTrack(loop(['start', 'straight-100', 'left-tight']))).turn).toBe(90)
        const up = loopGap(walkCustomTrack(loop(['start', 'ramp-up'])))
        expect(up.climb).toBeCloseTo(12)
    })

    it('is nothing on a closed loop', () => {
        const gap = loopGap(walkCustomTrack(loop(RECTANGLE)))
        expect(gap.distance).toBeCloseTo(0, 6)
        expect(gap.turn).toBeCloseTo(0)
        expect(gap.climb).toBeCloseTo(0, 6)
    })
})

describe('walkCustomTrack', () => {
    it('marks where each piece starts, in order', () => {
        const t = loop(RECTANGLE)
        const walk = walkCustomTrack(t)
        expect(walk.pieceStarts).toHaveLength(t.sections.length)
        expect(walk.pieceStarts[0]).toBe(0)
        for (let i = 1; i < walk.pieceStarts.length; i++) expect(walk.pieceStarts[i]).toBeGreaterThan(walk.pieceStarts[i - 1]!)
        expect(walk.pieceStarts.at(-1)).toBeLessThan(walk.pts.length)
        expect(walk.ys).toHaveLength(walk.pts.length)
    })

    it('walks a loop that does not close yet, and a course with no start', () => {
        const unclosed = loop(['start', 'straight-100', 'right-tight', 'ramp-up'])
        expect(() => walkCustomTrack(unclosed)).not.toThrow()
        expect(walkCustomTrack(unclosed).pieceStarts).toHaveLength(4)
        expect(() => walkCustomTrack(loop(['straight-50', 'left-hairpin']))).not.toThrow()
        expect(walkCustomTrack(loop([])).pts).toEqual([])
    })

    it('still throws for a malformed piece', () => {
        const layout = { id: 'bad', name: 'Bad', group: 'circuits' as const, halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 }, pieces: [{ type: 'straight' as const, length: 0 }] }
        expect(() => walkLayout(layout)).toThrow(/positive length/)
    })
})

describe('pieceAt', () => {
    it('finds the piece holding each walk point', () => {
        const walk = walkCustomTrack(loop(RECTANGLE))
        const starts = walk.pieceStarts
        for (let k = 0; k < starts.length; k++) {
            const last = (starts[k + 1] ?? walk.pts.length) - 1
            expect(pieceAt(walk, starts[k]!)).toBe(k)
            expect(pieceAt(walk, last)).toBe(k)
        }
    })
})

describe('draftTrackDef', () => {
    it('draws a half-built course on to where its road ends', () => {
        const walk = walkCustomTrack(sprint(['straight-20', 'start', 'straight-100', 'ramp-up']))
        const def = draftTrackDef(walk, false)!
        expect(def.closed).toBe(false)
        expect(def.points).toHaveLength(walk.pts.length + 1)
        expect(def.points.at(-1)).toEqual([walk.end.x, walk.end.z])
        expect(def.heights!.at(-1)).toBeCloseTo(walk.end.y)
        const t = new Track(def)
        expect(t.closed).toBe(false)
        expect(t.length).toBeGreaterThan(200)
    })

    it('draws a loop that meets its start as a closed road', () => {
        const c = loop(RECTANGLE)
        const def = draftTrackDef(walkCustomTrack(c), true)!
        expect(def.closed).toBeUndefined()
        expect(def.heights).toBeUndefined()
        expect(def.ups).toBeUndefined()
        expect(new Track(def).length).toBeCloseTo(new Track(compileCustomTrack(c).def!).length, 0)
    })

    it('keeps the jump gaps and the rails of loopings', () => {
        const walk = walkCustomTrack(sprint(['straight-20', 'start', 'straight-100', 'jump', 'straight-100', 'looping-left', 'straight-100']))
        const def = draftTrackDef(walk, false)!
        expect(def.gaps).toEqual(walk.gaps)
        expect(def.rails).toEqual(walk.rails)
        expect(def.ups).toHaveLength(def.points.length)
        expect(() => new Track(def)).not.toThrow()
    })

    it('has nothing to draw under two points', () => {
        expect(draftTrackDef(walkCustomTrack(loop([])), true)).toBeNull()
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
