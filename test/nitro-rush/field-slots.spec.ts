import { describe, expect, it } from 'vitest'
import { fieldEditorPicture } from '../../app/utils/nitro-rush/field-editor'
import { compileCustomTrack, fieldArrivals, sanitizeCustomTrack, walkedField, type CustomTrack, type SectionId, type SectionSpot } from '#shared/utils/nitro-rush/custom'
import type { CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { branchEnding, setJoin, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { addFieldExit, fieldPlanAt, growField, resizeField, setFieldEntry, setFieldExit, useFieldTool, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { defaultFieldPlan, portPose, portTiles, walledOffFault, type FieldPort, type FieldTile } from '#shared/utils/nitro-rush/field'
import { fieldGroup, walkedFields } from '#shared/utils/nitro-rush/field-group'
import { fieldJoin } from '#shared/utils/nitro-rush/field-join'
import { routeFieldPaths } from '#shared/utils/nitro-rush/field-plan'
import { finishJoin } from '#shared/utils/nitro-rush/finish-loop'
import { drive, trackOf } from './bot-lap'

/** Edge slots every 10 m: on each tile's middle and on the lines between tiles, so roads off one edge meet the next square. */

const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}

const FIRST = { branch: 0, at: 3 }
const RIGHT = { branch: 0, at: 4 }
const RING: SectionId[] = ['right-wide', 'straight-200', 'right-wide', 'right-wide']

/** A 200 m field grown into another past its right edge, the road carrying on out of the second's side, and a branch out of the first's far edge through `tile`. */
function ring(tile: number, sections: SectionId[] = RING): CustomTrack {
    let t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'] }
    t = done(resizeField(t, FIRST, 200, 200))
    t = done(growField(t, FIRST, 'right'))
    t = done(setFieldExit(t, RIGHT, { edge: 'right', tile: 5 }))
    t = done(addFieldExit(t, FIRST, { edge: 'exit', tile }))
    return setJoin({ ...t, branches: t.branches!.map(b => ({ ...b, sections })) }, 1, RIGHT)
}

describe('slots between tiles', () => {
    it('brings a ring of wide bends off a field\'s far edge square onto the next field\'s edge with no run in', () => {
        const t = ring(5.5)
        expect(fieldArrivals(t)[0]).toMatchObject({ runIn: 0 })
        expect(branchEnding(t, walkForks(t), 1)).toEqual({ kind: 'joins', to: RIGHT })
        const { def, error } = compileCustomTrack(t)
        expect(error).toBeNull()
        // It meets the second field on the line between two of its tiles.
        expect(def!.fields![1]!.mouths.some(m => m.branch === 1 && m.edge === 'exit' && Math.abs(m.at - 80) < 1e-6)).toBe(true)
        // A tile either way off, it runs 10 m on, or ends inside the field.
        expect(fieldArrivals(ring(6))[0]).toMatchObject({ runIn: 10 })
        expect(fieldArrivals(ring(5))[0]).toBeNull()
    })

    it('offers the slots between tiles to finish a branch into, and finishes the ring', () => {
        const t = ring(5.5, RING.slice(0, 3))
        const { walks } = walkForks(t)
        const target = walkedField(walks, RIGHT)!.placement!
        const slot = portPose(target, { edge: 'exit', tile: 3.5 })
        const goals = fieldJoin(t, walks, RIGHT)!.goals(walks[1]!.end)
        expect(goals.some(g => Math.abs(g.x - slot.x) < 1e-6 && Math.abs(g.z - slot.z) < 1e-6)).toBe(true)
        const { sections, error } = finishJoin(t, 1)
        expect(error).toBeNull()
        // The one bend that closes the ring, not a detour onto a nearer slot.
        expect(sections).toEqual(['right-wide'])
        const joined = { ...t, branches: t.branches!.map(b => ({ ...b, sections: [...b.sections, ...sections!] })) }
        expect(branchEnding(joined, walkForks(joined), 1)).toEqual({ kind: 'joins', to: RIGHT })
        expect(compileCustomTrack(joined).error).toBeNull()
    })

    it('drives a field entered and left between tiles', () => {
        const fields: CustomField[] = [{ at: { branch: 0, at: 2 }, width: 200, length: 200, entry: 4.5, exit: { edge: 'right', tile: 6.5 }, tiles: [] }]
        const t = trackOf(false, ['straight-20', 'start', 'field', 'straight-20', 'finish', 'straight-200'], fields)
        expect(t.fields[0]!.mouths.map(m => [m.edge, m.at])).toEqual([['entry', 100], ['right', 140]])
        expect(routeFieldPaths(t.fields, t.routes[0]!)).toHaveLength(1)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('stores half steps and nothing finer', () => {
        const stored = (entry: number, exit: FieldPort) => sanitizeCustomTrack({
            id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'field', 'finish', 'straight-200'],
            fields: [{ at: { branch: 0, at: 2 }, ...defaultFieldPlan(), entry, exit }]
        })
        expect(stored(1.5, { edge: 'exit', tile: 3.5 })?.fields?.[0]).toMatchObject({ entry: 1.5, exit: { tile: 3.5 } })
        expect(stored(1.25, { edge: 'exit', tile: 3 })).toBeNull()
        expect(stored(2, { edge: 'exit', tile: 4.5 })).toBeNull()
        // A mouth a tile from another overlaps it; a tile and a half clears it.
        expect(stored(2, { edge: 'entry', tile: 3 })).toBeNull()
        expect(stored(2, { edge: 'entry', tile: 3.5 })).not.toBeNull()
    })
})

describe('a mouth on the line between tiles', () => {
    const SPOT = { branch: 0, at: 2 }
    const course = (plan: Partial<CustomField> = {}): CustomTrack => ({
        id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'field', 'finish', 'straight-200'],
        fields: [{ at: SPOT, ...defaultFieldPlan(), ...plan }]
    })

    it('opens onto both tiles beside it', () => {
        expect(portTiles(defaultFieldPlan(), { edge: 'entry', tile: 1.5 })).toEqual([{ col: 1, row: 0 }, { col: 2, row: 0 }])
        expect(portTiles(defaultFieldPlan(), { edge: 'right', tile: 2.5 })).toEqual([{ col: 4, row: 2 }, { col: 4, row: 3 }])
    })

    it('keeps a block off either tile beside it', () => {
        const t = course({ entry: 1.5 })
        expect(useFieldTool(t, SPOT, 1, 0, 'block').error).toBe('keep road tiles clear')
        expect(useFieldTool(t, SPOT, 2, 0, 'pillar').error).toBe('keep road tiles clear')
        expect(useFieldTool(t, SPOT, 3, 0, 'block').error).toBeNull()
        const blocked = done(useFieldTool(course(), SPOT, 3, 4, 'block'))
        expect(addFieldExit(blocked, SPOT, { edge: 'exit', tile: 2.5 }).error).toBe('clear that tile first')
        expect(addFieldExit(blocked, SPOT, { edge: 'exit', tile: 3.5 }).error).toBe('clear that tile first')
        expect(addFieldExit(blocked, SPOT, { edge: 'exit', tile: 0.5 }).error).toBeNull()
        expect(compileCustomTrack(course({ entry: 1.5, tiles: [{ col: 2, row: 0, kind: 'block' }] })).error).not.toBeNull()
    })

    it('counts as reached through either tile, and the bot sets off through the open one', () => {
        // The left tile beside the way in is a dead end; the field is reached through the right one.
        const tiles: FieldTile[] = [{ col: 0, row: 0, kind: 'block' }, { col: 1, row: 1, kind: 'block' }]
        expect(walledOffFault({ ...defaultFieldPlan(), entry: 1.5, tiles }, portTiles(defaultFieldPlan(), { edge: 'entry', tile: 1.5 }))).toBeNull()
        const t = trackOf(false, ['straight-20', 'start', 'field', 'finish', 'straight-200'], [{ at: SPOT, ...defaultFieldPlan(), entry: 1.5, tiles }])
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
        // Boxed in on both sides, it's walled off.
        const boxed: FieldTile[] = [...tiles, { col: 2, row: 1, kind: 'block' }, { col: 3, row: 0, kind: 'block' }]
        expect(compileCustomTrack(course({ entry: 1.5, tiles: boxed })).error).toBe('part of the field is walled off')
    })

    it('moves the way in onto a slot between tiles, turning the field for a side edge', () => {
        const t = done(setFieldEntry(course(), SPOT, { edge: 'entry', tile: 0.5 }))
        expect(fieldPlanAt(t, SPOT).entry).toBe(0.5)
        expect(compileCustomTrack(t).error).toBeNull()
        const side = done(setFieldEntry(course({ width: 200, length: 100, entry: 4.5, exit: { edge: 'exit', tile: 4.5 } }), SPOT, { edge: 'left', tile: 1.5 }))
        const plan = fieldPlanAt(side, SPOT)
        expect([plan.width, plan.length, plan.entry % 1, plan.exit.edge, plan.exit.tile % 1]).toEqual([100, 200, 0.5, 'left', 0.5])
        expect(compileCustomTrack(side).error).toBeNull()
    })
})

describe('slots in the field editor', () => {
    const groupOf = (t: CustomTrack, spot: SectionSpot) => fieldGroup(walkedFields(t, walkForks(t).walks), spot)

    it('shows a slot every 10 m, with taken ones last and every tap box edge to edge', () => {
        const t = done(addFieldExit({ id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'field', 'finish', 'straight-200'] }, { branch: 0, at: 2 }, { edge: 'left', tile: 1.5 }))
        const picture = fieldEditorPicture(groupOf(t, { branch: 0, at: 2 }), 0, [{ line: 1, port: { edge: 'left', tile: 1.5 } }], [])
        const left = picture.slots.filter(s => s.edge === 'left')
        expect(left.map(s => s.tile).sort()).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
        expect(left.find(s => s.tile === 1.5)).toMatchObject({ label: '1', taken: true })
        expect(picture.slots.at(-1)!.taken).toBe(true)
        const free = left.filter(s => !s.taken).sort((a, b) => a.hit.y - b.hit.y)
        expect(free[1]!.hit.y - free[0]!.hit.y).toBeCloseTo(free[0]!.hit.height)
    })
})
