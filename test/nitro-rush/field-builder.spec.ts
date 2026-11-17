import { describe, expect, it } from 'vitest'
import { draftTrackDef } from '#shared/utils/nitro-rush/custom-draft'
import { compileCustomTrack, MAX_BRANCHES, PALETTE_SECTIONS, SECTION_CATEGORIES, walkCustomTrack, type CustomBranch, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { branchEnding, canJoin, draftForkedDef, insertSection, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { addFieldExit, fieldPlanAt, growField, resizeField, setFieldExit, useFieldTool, withField, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { defaultFieldPlan, FIELD_MAX_ITEMS, fieldBox, type FieldTile } from '#shared/utils/nitro-rush/field'
import { fieldGroup, fieldOutlines, onAnyField, quarterTurns, walkedFields } from '#shared/utils/nitro-rush/field-group'
import { Track } from '#shared/utils/nitro-rush/track'

const ROAD: SectionId[] = ['straight-20', 'start', 'field', 'finish', 'straight-200']
const SPOT = { branch: 0, at: 2 }
const course = (extra: Partial<CustomTrack> = {}): CustomTrack => ({ id: 'custom-test', name: 'Test', closed: false, sections: ROAD, ...extra })
const field = (extra: Partial<CustomField> = {}): CustomField => ({ at: SPOT, ...defaultFieldPlan(), ...extra })
/** The course an edit gave, failing the test when it gave an error instead. */
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}
const tiles = (t: CustomTrack) => fieldPlanAt(t, SPOT).tiles

describe('the field palette', () => {
    it('offers the field section on its own tab', () => {
        expect(SECTION_CATEGORIES.some(c => c.id === 'fields')).toBe(true)
        expect(PALETTE_SECTIONS.some(([id, s]) => id === 'field' && s.category === 'fields')).toBe(true)
    })
})

describe('editing a field', () => {
    it('places an item, turns it on a second tap and leaves it be while painting', () => {
        const once = done(useFieldTool(course(), SPOT, 1, 1, 'boost'))
        expect(tiles(once)).toEqual([{ col: 1, row: 1, kind: 'boost', dir: 0 }])
        const turned = done(useFieldTool(once, SPOT, 1, 1, 'boost'))
        expect(tiles(turned)).toEqual([{ col: 1, row: 1, kind: 'boost', dir: 1 }])
        expect(done(useFieldTool(turned, SPOT, 1, 1, 'boost', false))).toBe(turned)
        expect(tiles(done(useFieldTool(turned, SPOT, 1, 1, 'checkpoint')))).toEqual([{ col: 1, row: 1, kind: 'checkpoint', dir: 0 }])
        expect(tiles(done(useFieldTool(turned, SPOT, 1, 1, 'erase')))).toEqual([])
    })

    it('keeps the tiles at a mouth clear and nothing walled off', () => {
        expect(useFieldTool(course(), SPOT, 2, 0, 'block').error).toMatch(/clear/)
        expect(useFieldTool(course(), SPOT, 2, 4, 'pillar').error).toMatch(/clear/)
        // A gate on a mouth's tile goes along the road, and can't turn across it with a post in the road.
        const gated = done(useFieldTool(course(), SPOT, 2, 0, 'checkpoint'))
        expect(tiles(gated)).toEqual([{ col: 2, row: 0, kind: 'checkpoint', dir: 0 }])
        expect(useFieldTool(gated, SPOT, 2, 0, 'checkpoint').error).toMatch(/clear/)
        // A wall of blocks across the field, short of the gate behind it.
        let t = done(useFieldTool(course(), SPOT, 0, 4, 'checkpoint'))
        for (const col of [0, 1, 2, 3]) t = done(useFieldTool(t, SPOT, col, 3, 'block'))
        expect(useFieldTool(t, SPOT, 4, 3, 'block').error).toMatch(/walls something off/)
    })

    it('holds a field to its item cap', () => {
        const full: FieldTile[] = Array.from({ length: FIELD_MAX_ITEMS }, (_, i) => ({ col: i % 10, row: 2 + Math.floor(i / 10) * 2, kind: 'boost', dir: 0 }))
        const t = course({ fields: [field({ width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: full })] })
        expect(useFieldTool(t, SPOT, 0, 0, 'boost').error).toMatch(/at most/)
    })

    it('resizes a field, dropping what falls off and keeping its roads on their edges', () => {
        const t = course({ fields: [field({ tiles: [{ col: 4, row: 4, kind: 'pillar' }, { col: 0, row: 0, kind: 'boost', dir: 2 }] })] })
        const small = done(resizeField(t, SPOT, 40, 60))
        expect(fieldPlanAt(small, SPOT)).toEqual({ width: 40, length: 60, entry: 1, exit: { edge: 'exit', tile: 1 }, tiles: [{ col: 0, row: 0, kind: 'boost', dir: 2 }] })
        expect(compileCustomTrack(small).error).toBeNull()
        // The road in and out on neighbouring tiles of a field one tile wide don't fit.
        const across = done(setFieldExit(t, SPOT, { edge: 'left', tile: 2 }))
        expect(resizeField(across, SPOT, 20, 100).error).toBeNull()
        const out: CustomBranch = { sections: ['finish', 'straight-200'], from: { ...SPOT, port: { edge: 'exit', tile: 4 } }, to: null }
        expect(resizeField({ ...t, branches: [out] }, SPOT, 60, 100).error).toMatch(/don't fit/)
    })

    it('keeps fields in course order, as storage does', () => {
        const two = course({ sections: ['straight-20', 'start', 'field', 'straight-100', 'field', 'finish', 'straight-200'] })
        const t = withField(withField(two, { branch: 0, at: 4 }, defaultFieldPlan(40, 40)), SPOT, defaultFieldPlan())
        expect(t.fields!.map(f => f.at.at)).toEqual([2, 4])
    })
})

describe('roads out of a field', () => {
    it('starts a branch at an exit, which a finish of its own completes', () => {
        const t = done(addFieldExit(course(), SPOT, { edge: 'right', tile: 2 }))
        expect(t.branches).toEqual([{ sections: [], from: { ...SPOT, port: { edge: 'right', tile: 2 } }, to: null }])
        const finished: CustomTrack = { ...t, branches: [{ ...t.branches![0]!, sections: ['finish', 'straight-200'] }] }
        const { def } = compileCustomTrack(finished)
        expect(new Track(def!).routes).toHaveLength(2)
    })

    it('refuses an exit next to another road, on a block or past the branch cap', () => {
        expect(addFieldExit(course(), SPOT, { edge: 'exit', tile: 3 }).error).toMatch(/leave a tile/)
        expect(addFieldExit(course(), SPOT, { edge: 'exit', tile: 2 }).error).toMatch(/already/)
        const blocked = done(useFieldTool(course(), SPOT, 4, 2, 'block'))
        expect(addFieldExit(blocked, SPOT, { edge: 'right', tile: 2 }).error).toMatch(/clear/)
        let t = course({ fields: [field({ width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 } })] })
        for (let i = 0; i < MAX_BRANCHES; i++) t = done(addFieldExit(t, SPOT, { edge: i % 2 ? 'left' : 'right', tile: Math.floor(i / 2) * 2 }))
        expect(addFieldExit(t, SPOT, { edge: 'exit', tile: 0 }).error).toMatch(/no more branches/)
    })

    it('moves the road out to another edge and keeps it off the way in', () => {
        const t = done(setFieldExit(course(), SPOT, { edge: 'right', tile: 2 }))
        expect(fieldPlanAt(t, SPOT).exit).toEqual({ edge: 'right', tile: 2 })
        expect(setFieldExit(course(), SPOT, { edge: 'entry', tile: 2 }).error).toMatch(/comes in/)
    })
})

describe('branches into a field', () => {
    /** Two fields 100 m apart; a branch leaves the first beside the main road for the second. */
    const twoFields = (sections: SectionId[], to: CustomBranch['to'] = { branch: 0, at: 4 }) => course({
        sections: ['straight-20', 'start', 'field', 'straight-100', 'field', 'finish', 'straight-200'],
        fields: [field({ exit: { edge: 'exit', tile: 1 } }), field({ at: { branch: 0, at: 4 } })],
        branches: [{ sections, from: { ...SPOT, port: { edge: 'exit', tile: 3 } }, to }]
    })

    it('lets a branch head for any field but the one it leaves', () => {
        const t = twoFields(['straight-60'], null)
        expect(canJoin(t, 1, { branch: 0, at: 4 })).toBe(true)
        expect(canJoin(t, 1, SPOT)).toBe(false)
        // A field takes any number of roads, so heading in frees none.
        const both = { ...t, branches: [...t.branches!, { ...t.branches![0]!, from: { ...SPOT, port: { edge: 'exit' as const, tile: 0 } }, to: { branch: 0, at: 4 } }] }
        expect(canJoin(both, 1, { branch: 0, at: 4 })).toBe(true)
    })

    it('connects a branch that drives in square, and says why one doesn\'t', () => {
        const t = twoFields(['straight-60'])
        expect(branchEnding(t, walkForks(t), 1)).toEqual({ kind: 'joins', to: { branch: 0, at: 4 } })
        const bent = twoFields(['right-eighth'])
        expect(branchEnding(bent, walkForks(bent), 1)).toMatchObject({ kind: 'askew', why: expect.stringMatching(/straight on/) })
        const wide = twoFields(['right-tight'])
        expect(branchEnding(wide, walkForks(wide), 1)).toMatchObject({ kind: 'askew', why: expect.stringMatching(/misses/) })
    })

    it('draws the forked draft with both fields, the branch running hub to hub', () => {
        const t = twoFields(['straight-60'])
        const forks = walkForks(t)
        const draft = draftForkedDef(t, forks, false)
        expect(draft).not.toBeNull()
        const track = new Track(draft!.def)
        expect(track.fields).toHaveLength(2)
        const { def } = compileCustomTrack(t)
        expect(draft!.def.branches![0]!.from).toEqual(def!.branches![0]!.from)
        expect(draft!.def.branches![0]!.to).toEqual(def!.branches![0]!.to)
        expect(track.fields.map(f => f.mouths.length)).toEqual(def!.fields!.map(f => f.mouths.length))
    })

    it('draws a field laid on a line still being built', () => {
        const t = insertSection(course({ sections: ['straight-20', 'start'] }), 0, 2, 'field')
        const def = draftTrackDef(walkCustomTrack(t), false)!
        const track = new Track(def)
        expect(track.fields).toHaveLength(1)
        expect(track.fields[0]!.mouths.map(m => m.edge)).toEqual(['entry', 'exit'])
    })
})

describe('growing a field', () => {
    const walked = (t: CustomTrack) => walkedFields(t, walkForks(t).walks)
    const spotAt = (at: number) => ({ branch: 0, at })

    it('lays a matching field flush past the far edge, the road carrying on from it', () => {
        const t = done(growField(course(), SPOT, 'exit'))
        expect(t.sections).toEqual(['straight-20', 'start', 'field', 'field', 'finish', 'straight-200'])
        expect(fieldPlanAt(t, spotAt(3))).toEqual(defaultFieldPlan())
        const [a, b] = walked(t)
        expect(fieldBox(b!).z1).toBeCloseTo(fieldBox(a!).z0)
        expect(fieldBox(b!).x0).toBeCloseTo(fieldBox(a!).x0)
        expect(fieldGroup(walked(t), SPOT)).toHaveLength(2)
        expect(compileCustomTrack(t).error).toBeNull()
    })

    it('turns a quarter off a side edge, as long as that edge, and lines up with it', () => {
        const t = done(growField(course({ fields: [field({ width: 100, length: 60, exit: { edge: 'exit', tile: 2 } })] }), SPOT, 'right'))
        expect(fieldPlanAt(t, SPOT).exit).toEqual({ edge: 'right', tile: 1 })
        expect(fieldPlanAt(t, spotAt(3))).toMatchObject({ width: 60, length: 100, entry: 1 })
        const [a, b] = walked(t)
        expect(quarterTurns(a!, b!)).toBe(1)
        expect(fieldBox(b!).x0).toBeCloseTo(fieldBox(a!).x1)
        expect(fieldBox(b!).z0).toBeCloseTo(fieldBox(a!).z0)
        expect(fieldBox(b!).z1).toBeCloseTo(fieldBox(a!).z1)
    })

    it('steps the road off a branch in the middle of the edge and still sits flush', () => {
        const out: CustomBranch = { sections: [], from: { ...SPOT, port: { edge: 'left', tile: 2 } }, to: null }
        const t = done(growField(course({ branches: [out] }), SPOT, 'left'))
        expect(fieldPlanAt(t, SPOT).exit).toEqual({ edge: 'left', tile: 0 })
        const [a, b] = walked(t)
        expect(fieldBox(b!).x1).toBeCloseTo(fieldBox(a!).x0)
        expect(fieldBox(b!).z0).toBeCloseTo(fieldBox(a!).z0)
    })

    it('builds a square of four that drives as one, and refuses a fifth on top of the first', () => {
        let t = done(growField(course(), SPOT, 'exit'))
        t = done(growField(t, spotAt(3), 'right'))
        t = done(growField(t, spotAt(4), 'right'))
        expect(fieldGroup(walked(t), SPOT)).toHaveLength(4)
        expect(growField(t, spotAt(5), 'right').error).toMatch(/no room/)
        expect(compileCustomTrack(t).error).toBeNull()
    })

    it('outlines a square of four as one: two outer edges each, none inside', () => {
        let t = done(growField(course(), SPOT, 'exit'))
        t = done(growField(t, spotAt(3), 'right'))
        t = done(growField(t, spotAt(4), 'right'))
        const fields = walked(t)
        const outlines = fieldOutlines(fields)
        expect(outlines.map(o => o.rim.length)).toEqual([2, 2, 2, 2])
        const rim = outlines.flatMap(o => o.rim).reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
        expect(rim).toBeCloseTo(800)
        const [cx, cz] = outlines[0]!.corners[2]!
        expect(onAnyField(fields, cx + 1, fields[0]!.y, cz + 1)).toBe(true)
        expect(onAnyField(fields, cx + 1, fields[0]!.y + 10, cz + 1)).toBe(false)
    })

    it('refuses an edge with no tile a road fits through', () => {
        const narrow = course({ fields: [field({ width: 20, length: 60, entry: 0, exit: { edge: 'right', tile: 1 } })] })
        expect(growField(narrow, SPOT, 'exit').error).toBeNull()
        expect(growField(done(useFieldTool(narrow, SPOT, 0, 2, 'block')), SPOT, 'exit').error).toMatch(/clear a tile/)
    })

    it('turns a gate between along and across only, as it counts either way through', () => {
        const gate = done(useFieldTool(course(), SPOT, 1, 1, 'checkpoint', true, 3))
        expect(tiles(gate)).toEqual([{ col: 1, row: 1, kind: 'checkpoint', dir: 1 }])
        expect(tiles(done(useFieldTool(gate, SPOT, 1, 1, 'checkpoint')))).toEqual([{ col: 1, row: 1, kind: 'checkpoint', dir: 0 }])
    })

    it('starts a new pad facing the way asked when it fits', () => {
        expect(tiles(done(useFieldTool(course(), SPOT, 1, 1, 'boost', true, 3)))).toEqual([{ col: 1, row: 1, kind: 'boost', dir: 3 }])
    })
})
