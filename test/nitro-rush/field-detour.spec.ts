import { describe, expect, it } from 'vitest'
import { compileCustomTrack, sanitizeCustomTrack, type CustomTrack, type SectionId, type SectionSpot } from '#shared/utils/nitro-rush/custom'
import { branchEnding, canJoin, setJoin, settleFieldJoins, walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { addFieldExit, resizeField, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { fieldJoin } from '#shared/utils/nitro-rush/field-join'
import { finishJoin } from '#shared/utils/nitro-rush/finish-loop'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { Track, type Route } from '#shared/utils/nitro-rush/track'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, crossesLines, gridCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive } from './bot-lap'

/** A branch that leaves a field and comes back into the same joined fields is a detour: driven once or skipped, never looped. */

const LEFT = { branch: 0, at: 2 }

/** A sprint across four joined 200 m fields, with a short loop off the third's left edge that ends square on its exit edge. */
const DETOUR = sanitizeCustomTrack({
    id: 'custom-test',
    name: 'My Track',
    closed: false,
    sections: ['field', 'field', 'field', 'field'],
    branches: [{ sections: ['right-wide', 'straight-20', 'right-wide', 'checkpoint', 'right-wide'], from: { ...LEFT, port: { edge: 'left', tile: 4.5 } }, to: null }],
    fields: [
        { at: { branch: 0, at: 0 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 4 }, tiles: [] },
        { at: { branch: 0, at: 1 }, width: 200, length: 200, entry: 4, exit: { edge: 'right', tile: 4 }, tiles: [{ col: 1, row: 8, kind: 'start', dir: 1 }] },
        { at: LEFT, width: 200, length: 200, entry: 5, exit: { edge: 'right', tile: 4 }, tiles: [] },
        { at: { branch: 0, at: 3 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [{ col: 1, row: 8, kind: 'finish', dir: 0 }] }
    ]
}) as CustomTrack

const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}

function trackOf(t: CustomTrack) {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}

/** The checkpoint ids the bot's run down `route` touches before the finish. */
function touchedOn(track: Track, route: Route) {
    const car = gridCar(track)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        expect(stepCar(car, botInput(car, track, 1, route), track, 1 / PHYSICS_HZ).fell).toBe(false)
        const lap = timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, track)).find(e => e.type === 'lap')
        if (lap?.type === 'lap') return lap.splits.flatMap((s, id) => s === null ? [] : [id])
    }
    throw new Error('the run never finished')
}

describe('detours through joined fields', () => {
    it('takes a branch ending square on the field it left into that field, and the course compiles and drives', () => {
        const t = settleFieldJoins(DETOUR)
        expect(t.branches![0]!.to).toEqual(LEFT)
        expect(branchEnding(t, walkForks(t), 1)).toMatchObject({ kind: 'joins', to: LEFT })
        const track = trackOf(t)
        expect(track.routes).toHaveLength(2)
        for (const route of track.routes) expect(ghostDrivesTrack(track, drive(track, 0, route))).toBe(true)
    })

    it('never joins a branch that only ends near a field', () => {
        const short = { ...DETOUR, branches: DETOUR.branches!.map(b => ({ ...b, sections: b.sections.slice(0, -1) })) }
        expect(settleFieldJoins(short).branches![0]!.to).toBeNull()
    })

    it('leaves a branch the edit didn\'t move unjoined, even ending square on a field', () => {
        const unjoined = walkForks(DETOUR).walks.map(w => w.end)
        expect(settleFieldJoins(DETOUR, unjoined).branches![0]!.to).toBeNull()
        const shorter = { ...DETOUR, branches: DETOUR.branches!.map(b => ({ ...b, sections: b.sections.slice(0, -1) })) }
        expect(settleFieldJoins(DETOUR, walkForks(shorter).walks.map(w => w.end)).branches![0]!.to).toEqual(LEFT)
    })

    it('counts the detour\'s checkpoint only on the route through it, and no route drives it twice', () => {
        const track = trackOf(settleFieldJoins(DETOUR))
        const id = track.checkpointIds[1]![0]!
        const through = track.routes.filter(r => r.checkpoints.includes(id))
        expect(through).toHaveLength(1)
        expect(track.k).toBe(0)
        for (const route of track.routes) {
            const legs = route.legs.map(l => `${l.branch}:${l.from}:${l.to}`)
            expect(new Set(legs).size).toBe(legs.length)
            expect(route.legs.filter(l => l.branch === 1).length).toBeLessThanOrEqual(1)
            expect(touchedOn(track, route).includes(id)).toBe(route === through[0])
        }
    })

    it('lets a branch come back into another field of the group at its outer edge', () => {
        let t: CustomTrack = { ...DETOUR, branches: [{ ...DETOUR.branches![0]!, from: { ...LEFT, port: { edge: 'left', tile: 1 } }, sections: ['left-wide'] }] }
        t = setJoin(t, 1, LEFT)
        const { sections, error } = finishJoin(t, 1)
        expect(error).toBeNull()
        const joined = { ...t, branches: t.branches!.map(b => ({ ...b, sections: [...b.sections, ...sections!] })) }
        const ending = branchEnding(joined, walkForks(joined), 1) as { kind: string, to: SectionSpot }
        expect(ending.kind).toBe('joins')
        expect(ending.to).not.toEqual(LEFT)
        const track = trackOf(joined)
        for (const route of track.routes) expect(ghostDrivesTrack(track, drive(track, 0, route))).toBe(true)
    })

    it('offers slots on every field of the group to finish a branch into', () => {
        const slots = fieldJoin(DETOUR, walkForks(DETOUR).walks, LEFT)!.slots
        const ats = new Set(slots.map(s => s.at.at))
        expect([...ats].sort()).toEqual([0, 1, 2, 3])
    })

    it('still refuses a branch from a later field back into an earlier one', () => {
        const road: SectionId[] = ['straight-20', 'start', 'field', 'straight-100', 'field', 'finish', 'straight-200']
        let t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: road }
        t = done(resizeField(t, { branch: 0, at: 2 }, 100, 100))
        t = done(resizeField(t, { branch: 0, at: 4 }, 100, 100))
        t = done(addFieldExit(t, { branch: 0, at: 4 }, { edge: 'left', tile: 1 }))
        expect(canJoin(t, 1, { branch: 0, at: 2 })).toBe(false)
        expect(canJoin(t, 1, { branch: 0, at: 4 })).toBe(true)
        expect(compileCustomTrack(setJoin(t, 1, { branch: 0, at: 2 })).error).not.toBeNull()
    })
})
