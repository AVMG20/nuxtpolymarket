import { describe, expect, it } from 'vitest'
import { compileCustomTrack, type CustomTrack, type SectionId, type SectionSpot } from '#shared/utils/nitro-rush/custom'
import { branchEnding, setJoin, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { addFieldExit, growField, resizeField, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import type { FieldPort } from '#shared/utils/nitro-rush/field'
import { finishJoin } from '#shared/utils/nitro-rush/finish-loop'

/** Finishing a branch into a field it doesn't yet point at: the road is laid round to a free slot on one of its edges. */

const FIRST = { branch: 0, at: 3 }
const SECOND = { branch: 0, at: 4 }
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}

/** A sprint across two 200 m fields, one grown from the other, and a branch out of the first through `port` along `sections`, heading for `to`. */
function branched(port: FieldPort, sections: SectionId[], to: SectionSpot = SECOND): CustomTrack {
    let t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ['straight-20', 'start', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200'] }
    t = done(resizeField(t, FIRST, 200, 200))
    t = done(growField(t, FIRST, 'exit'))
    t = done(addFieldExit(t, FIRST, port))
    return setJoin({ ...t, branches: t.branches!.map(b => ({ ...b, sections })) }, 1, to)
}

const finished = (t: CustomTrack) => {
    const { sections, error } = finishJoin(t, 1)
    expect(error).toBeNull()
    return { ...t, branches: t.branches!.map((b, i) => i ? b : { ...b, sections: [...b.sections, ...sections!] }) }
}

describe('finishing a branch into a field', () => {
    it('lays the road round to a side of the joined fields when the branch curls away beside the one it left', () => {
        const t = branched({ edge: 'entry', tile: 0 }, ['right-medium', 'right-medium'])
        expect(branchEnding(t, walkForks(t), 1)).toMatchObject({ kind: 'short' })
        const joined = finished(t)
        // The two fields are one floor, so the nearest free slot on either will do.
        expect([FIRST, SECOND]).toContainEqual((branchEnding(joined, walkForks(joined), 1) as { to: SectionSpot }).to)
        expect(branchEnding(joined, walkForks(joined), 1).kind).toBe('joins')
        expect(compileCustomTrack(joined).error).toBeNull()
    })

    it('turns a branch that points away from the joined fields round into them', () => {
        const t = branched({ edge: 'left', tile: 1 }, ['straight-100', 'right-medium', 'right-medium'])
        const joined = finished(t)
        expect(branchEnding(joined, walkForks(joined), 1).kind).toBe('joins')
        expect(compileCustomTrack(joined).error).toBeNull()
    })
})
