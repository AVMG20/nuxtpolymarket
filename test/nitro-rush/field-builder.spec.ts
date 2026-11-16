import { describe, expect, it } from 'vitest'
import { draftTrackDef } from '#shared/utils/nitro-rush/custom-draft'
import { compileCustomTrack, MAX_BRANCHES, PALETTE_SECTIONS, SECTION_CATEGORIES, walkCustomTrack, type CustomBranch, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { branchEnding, canJoin, draftForkedDef, insertSection, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { addFieldExit, fieldPlanAt, resizeField, setFieldExit, useFieldTool, withField, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { defaultFieldPlan, FIELD_MAX_ITEMS, type FieldTile } from '#shared/utils/nitro-rush/field'
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
        // A gate on a mouth's tile goes along the road, so turning it skips the ways with a post in the road.
        const gated = done(useFieldTool(course(), SPOT, 2, 0, 'checkpoint'))
        const turned = done(useFieldTool(gated, SPOT, 2, 0, 'checkpoint'))
        expect(tiles(turned)).toEqual([{ col: 2, row: 0, kind: 'checkpoint', dir: 2 }])
        expect(tiles(done(useFieldTool(turned, SPOT, 2, 0, 'checkpoint')))).toEqual([{ col: 2, row: 0, kind: 'checkpoint', dir: 0 }])
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
