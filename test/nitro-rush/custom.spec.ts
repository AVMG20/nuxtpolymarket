import { describe, expect, it } from 'vitest'
import { compileCustomTrack, draftTrackDef, isCustomTrackId, isSectionId, loopGap, MAX_NAME_LENGTH, MAX_SECTIONS, newCustomTrack, PALETTE_SECTIONS, pieceAt, sanitizeCustomTrack, sectionWalk, SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { BANK_LENGTH, GRID, walkLayout } from '#shared/utils/nitro-rush/layout'
import { Track, wallFoot } from '#shared/utils/nitro-rush/track'
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
        sprint(['straight-20', 'start', 'straight-100', 'corkscrew-left', 'straight-100', 'corkscrew-right', 'straight-100', 'right-banked', 'straight-100', 'left-banked', 'steep-up', 'steep-down', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'bank-left', 'straight-100', 'left-tight', 'bank-flat', 'straight-60', 'bank-right', 'right-wide', 'bank-flat', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'slope-up', 'straight-20', 'slope-up-steep', 'straight-20', 'slope-down', 'slope-down-steep', 'slope-flat', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'left-medium', 'straight-100', 'right-medium', 'straight-100', 'finish', 'straight-200']),
        sprint(['straight-20', 'start', 'straight-100', 'left-eighth-tight', 'straight-100', 'right-eighth-tight', 'straight-100', 'left-eighth-wide', 'straight-100', 'right-eighth-wide', 'straight-100', 'finish', 'straight-200']),
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

    it('ends every section that leaves along an axis on the builder grid', () => {
        const off: string[] = []
        for (const id of Object.keys(SECTIONS) as SectionId[]) {
            const { x, z, heading } = walkCustomTrack(sprint([id])).end
            if (Math.abs(Math.sin(2 * heading)) > 1e-9) continue
            const miss = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) * GRID
            if (miss(x) > 1e-6 || miss(z) > 1e-6) off.push(`${id} ends at (${x.toFixed(2)}, ${z.toFixed(2)})`)
        }
        expect(off).toEqual([])
    })

    it('shows every section on its own, without cutting a downhill off at the ground', () => {
        for (const id of Object.keys(SECTIONS) as SectionId[]) {
            const walk = sectionWalk(id)
            expect(Math.min(walk.end.y, ...walk.ys), id).toBeCloseTo(0)
            expect(new Track(draftTrackDef(walk, false)!).n, id).toBeGreaterThan(1)
        }
        const down = sectionWalk('ramp-down')
        expect(down.ys[0]).toBeCloseTo(12)
        expect(down.end.y).toBeCloseTo(0)
        expect(sectionWalk('ramp-up').ys[0]).toBe(0)
    })

    it('closes a figure eight of half and quarter spirals', () => {
        const eight: SectionId[] = ['start', 'left-half-spiral-up', 'left-quarter-spiral-up', 'straight-20', 'straight-20', 'straight-20', 'straight-20', 'right-half-spiral-down', 'right-quarter-spiral-down', 'straight-20', 'straight-20', 'straight-20']
        expect(compileCustomTrack(loop(eight)).error).toBeNull()
    })

    it('lays half and quarter spirals that add up to a full one', () => {
        const end = (sections: SectionId[]) => walkCustomTrack(sprint(sections)).end
        const full = end(['left-spiral-up'])
        for (const parts of [['left-half-spiral-up', 'left-half-spiral-up'], ['left-quarter-spiral-up', 'left-quarter-spiral-up', 'left-quarter-spiral-up', 'left-quarter-spiral-up']] as SectionId[][]) {
            const e = end(parts)
            expect(e.x).toBeCloseTo(full.x, 3)
            expect(e.z).toBeCloseTo(full.z, 3)
            expect(e.y).toBeCloseTo(full.y, 3)
        }
        const down = walkCustomTrack(sprint(['right-half-spiral-down']))
        expect(down.end.y - down.rise).toBeCloseTo(-6, 3)
        expect(end(['right-quarter-spiral-up']).y).toBeCloseTo(3, 3)
    })

    it('climbs a half spiral high enough to cross back over the road below', () => {
        const c = sprint(['straight-20', 'start', 'straight-200', 'right-half-spiral-up', 'straight-100', 'right-tight', 'straight-200', 'finish', 'straight-100'])
        const { def, error } = compileCustomTrack(c)
        expect(error).toBeNull()
        const t = new Track(def!)
        // The last straight runs west over the first one, which leaves the start heading north.
        const below = t.pointAt(t.startS + 60)
        const over = t.project(below.x, below.z, -1, undefined, below.y + 6)
        expect(Math.abs(over.s - t.startS - 60)).toBeGreaterThan(200)
        expect(t.pointAt(over.s).y - below.y).toBeCloseTo(6, 2)
    })

    it('recognises only catalogue ids as sections', () => {
        expect(isSectionId('straight-100')).toBe(true)
        for (const id of ['nope', '__proto__', 'toString', 'constructor', 'hasOwnProperty', '', 7, null, undefined, {}]) {
            expect(isSectionId(id)).toBe(false)
        }
    })
})

describe('banks', () => {
    const edge = wallFoot(10.6)
    /** Height of the road's outer foot on `side` at each point. */
    const edgeHeights = (t: Track, side: number) => Array.from({ length: t.n }, (_, i) => t.ys[i]! + t.right[i * 3 + 1]! * side * edge)
    const lowest = (t: Track) => Array.from({ length: t.n }, (_, i) => Math.min(edgeHeights(t, -1)[i]!, edgeHeights(t, 1)[i]!))
    const tilted = (t: Track, s: number) => Math.abs(t.frameAt(s).ry)
    const banked = (sections: SectionId[]) => {
        const { def, error } = compileCustomTrack(sprint(['straight-20', 'start', 'straight-60', ...sections, 'finish', 'straight-200']))
        expect(error, sections.join(', ')).toBeNull()
        return new Track(def!)
    }

    it('keeps the low edge on the ground and raises the other, whichever way it leans', () => {
        for (const [section, low] of [['bank-left', -1], ['bank-right', 1]] as [SectionId, number][]) {
            const t = banked([section, 'straight-100', 'left-tight', 'straight-60', 'right-tight', 'straight-60', 'bank-flat'])
            for (const y of lowest(t)) {
                expect(y).toBeGreaterThan(-0.05)
                expect(y).toBeLessThan(0.05)
            }
            const mid = t.segmentAt(t.startS + 60 + BANK_LENGTH + 50)
            expect(edgeHeights(t, low)[mid]).toBeCloseTo(0, 1)
            expect(edgeHeights(t, -low)[mid]).toBeCloseTo(2 * edge * Math.sin(25 * Math.PI / 180), 0)
        }
    })

    it('banks what follows on its own, until a bank to flat levels it', () => {
        const t = banked(['bank-right', 'straight-100', 'right-tight', 'straight-20', 'bank-flat', 'straight-20'])
        const at = t.startS + 10 + 60
        expect(tilted(t, at - 5)).toBe(0)
        // Halfway through the roll, and right over on the straight and round the bend.
        expect(tilted(t, at + BANK_LENGTH / 2)).toBeGreaterThan(0.1)
        const full = Math.sin(25 * Math.PI / 180)
        expect(tilted(t, at + BANK_LENGTH + 50)).toBeCloseTo(full, 1)
        expect(tilted(t, at + BANK_LENGTH + 100 + 40)).toBeCloseTo(full, 1)
        expect(tilted(t, t.finishS - 10)).toBe(0)
        expect(t.pointAt(t.finishS - 10).y).toBe(0)
    })

    it('leans a banked corner the bank\'s way, so a corner away from it runs off-camber', () => {
        const lean = (section: SectionId) => {
            const f = banked([section, 'right-tight', 'bank-flat']).frameAt(20 + 20 + 60 + BANK_LENGTH + 30)
            return f.ux * f.rx + f.uz * f.rz
        }
        expect(lean('bank-right')).toBeGreaterThan(0.3)
        expect(lean('bank-left')).toBeLessThan(-0.3)
    })

    it('rolls straight across from one bank to the other', () => {
        const t = banked(['bank-left', 'straight-20', 'bank-right', 'straight-20', 'bank-flat'])
        for (const y of lowest(t)) expect(Math.abs(y)).toBeLessThan(0.05)
        // Through level the road's height eases rather than kinks, which stepped its grade by about 0.5.
        const crossing = banked(['bank-left', 'bank-right', 'bank-flat'])
        for (let i = 1; i < crossing.n; i++) expect(Math.abs(crossing.grades[i]! - crossing.grades[i - 1]!)).toBeLessThan(0.1)
    })

    it('banks a ramp and holds the low edge to the road\'s height, not the ground', () => {
        const walk = walkCustomTrack(sprint(['ramp-up', 'bank-left', 'straight-20']))
        expect(walk.end.y - walk.end.lift).toBeCloseTo(12)
        expect(walk.end.lift).toBeCloseTo(edge * Math.sin(25 * Math.PI / 180))
        expect(banked(['ramp-up', 'bank-left', 'ramp-down', 'bank-flat']).pointAt(0).y).toBe(0)
    })

    it('lifts a banked ramp clear of the ground by its low edge, not its centre', () => {
        const walk = walkCustomTrack(sprint(['straight-20', 'start', 'straight-20', 'bank-left', 'ramp-down', 'bank-flat', 'finish', 'straight-200']))
        expect(walk.rise).toBeGreaterThan(0)
        expect(Math.min(...walk.ys.map((y, i) => y - walk.lifts[i]!))).toBeCloseTo(0, 3)
    })

    it('has to level out before a course ends', () => {
        expect(compileCustomTrack(sprint(['straight-20', 'start', 'straight-20', 'bank-left', 'finish', 'bank-flat', 'straight-200'])).error).toMatch(/level the road out before a finish line/)
        expect(compileCustomTrack(sprint(['straight-20', 'start', 'straight-20', 'finish', 'straight-100', 'bank-left'])).error).toMatch(/level out before it ends/)
        const open = ['start', 'straight-60', 'bank-right', 'right-tight', 'right-tight', 'straight-60', 'straight-60', 'right-tight', 'right-tight'] as SectionId[]
        const { error } = compileCustomTrack(loop(open))
        expect(error).toMatch(/closing the loop|level out/)
    })

    it('refuses stunts and lines on a bank, naming what to level out for', () => {
        const on = (piece: SectionId) => compileCustomTrack(sprint(['straight-20', 'start', 'bank-left', 'straight-20', piece, 'straight-100', 'bank-flat', 'finish', 'straight-200'])).error
        expect(on('jump')).toMatch(/before a jump/)
        expect(on('looping-left')).toMatch(/before a looping/)
        expect(on('corkscrew-right')).toMatch(/before a corkscrew/)
        expect(on('checkpoint')).toMatch(/before a checkpoint/)
        expect(walkCustomTrack(sprint(['bank-left', 'jump'])).notLevel).toBe('a jump')
        expect(walkCustomTrack(sprint(['bank-left', 'bank-flat', 'jump'])).notLevel).toBeNull()
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

    it('marks the sections that start on a bank', () => {
        const walk = walkCustomTrack(sprint(['straight-20', 'bank-left', 'straight-20', 'left-tight', 'bank-flat', 'straight-20']))
        expect([0, 1, 2, 3, 4, 5].map(i => walk.states[i]!.bank !== 0)).toEqual([false, false, true, true, true, false])
    })

    it('draws a bank to flat from its bank, and leaves the old banked corners off the palette', () => {
        const walk = sectionWalk('bank-flat')
        expect(walk.lifts[0]).toBeGreaterThan(4)
        expect(walk.end.bank).toBe(0)
        expect(walk.end.y).toBe(0)
        const ids = PALETTE_SECTIONS.map(([id]) => id)
        expect(ids).toEqual(expect.arrayContaining(['bank-left', 'bank-right', 'bank-flat']))
        expect(ids).not.toContain('left-banked')
        expect(ids).not.toContain('right-banked')
        expect(isSectionId('left-banked')).toBe(true)
    })

    it('keeps the old banked corners on the ground too', () => {
        for (const id of ['left-banked', 'right-banked'] as SectionId[]) {
            for (const y of lowest(banked([id, 'straight-60']))) expect(Math.abs(y)).toBeLessThan(0.05)
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
        expect(() => walkCustomTrack(loop(['straight-60', 'left-hairpin']))).not.toThrow()
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

    it('lays a replaced section\'s successor in a saved course', () => {
        expect(sanitizeCustomTrack({ ...valid, sections: ['start', 'straight-50'] })?.sections).toEqual(['start', 'straight-60'])
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
