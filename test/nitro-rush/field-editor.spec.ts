import { describe, expect, it } from 'vitest'
import { fieldEditorPicture, pictureTile } from '../../app/utils/nitro-rush/field-editor'
import type { CustomTrack } from '#shared/utils/nitro-rush/custom'
import { walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { growField, useFieldTool, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { fieldGroup, walkedFields } from '#shared/utils/nitro-rush/field-group'

const course: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'field', 'finish', 'straight-200'] }
const spot = (at: number) => ({ branch: 0, at })
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}
/** Four 100 m fields in a square: in, on past the far edge, right, then back down beside the first. */
function square() {
    let t = done(growField(course, spot(2), 'exit'))
    t = done(growField(t, spot(3), 'right'))
    t = done(growField(t, spot(4), 'right'))
    return t
}
const groupOf = (t: CustomTrack) => fieldGroup(walkedFields(t, walkForks(t).walks), spot(2))

describe('the field editor picture', () => {
    it('draws a square of fields as one, the first one\'s entry at the bottom', () => {
        const picture = fieldEditorPicture(groupOf(square()), 3, [], [])
        expect([picture.width, picture.height]).toEqual([200, 200])
        expect(picture.floors.map(f => [Math.round(f.x), Math.round(f.y)])).toEqual([[0, 100], [0, 0], [100, 0], [100, 100]])
    })

    it('shows slots and + buttons only on the highlighted field\'s open edges', () => {
        // The last field: its entry and left edge meet the others; it can grow down or right.
        const picture = fieldEditorPicture(groupOf(square()), 3, [], [])
        expect(new Set(picture.slots.map(s => s.edge))).toEqual(new Set(['exit', 'left']))
        expect(picture.grow.map(g => g.edge).sort()).toEqual(['exit', 'left'])
        expect(picture.slots.find(s => s.label === 'OUT')).toMatchObject({ edge: 'exit' })
    })

    it('finds the field and tile under a point, and the way that points up the picture', () => {
        const group = groupOf(square())
        expect(pictureTile(group, 10, 190)).toEqual({ spot: spot(2), col: 0, row: 0, facing: 0 })
        // The third field is turned a quarter right, so up the picture is its left.
        expect(pictureTile(group, 190, 10)).toMatchObject({ spot: spot(4), facing: 3 })
        expect(pictureTile(group, 210, 10)).toBeNull()
    })

    it('turns items on a turned field to match the picture', () => {
        const group = groupOf(square())
        const at = pictureTile(group, 150, 50)!
        const t = done(useFieldTool(square(), at.spot, at.col, at.row, 'boost', true, at.facing))
        expect(fieldEditorPicture(groupOf(t), 0, [], []).items).toMatchObject([{ kind: 'boost', turn: 0, x: 150, y: 50 }])
    })
})

describe('growing from the editor', () => {
    it('shows no + buttons on a field its road leaves straight into another', () => {
        expect(fieldEditorPicture(groupOf(square()), 0, [], [], false).grow).toEqual([])
    })
})
