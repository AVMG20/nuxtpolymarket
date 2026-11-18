import { describe, expect, it } from 'vitest'
import { compileCustomTrack, exportCustomTrack, importCustomTrack, roadKey, sanitizeCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { settleFieldJoins } from '#shared/utils/nitro-rush/custom-forks'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { fieldPlanAt, useFieldTool, type FieldEdit } from '#shared/utils/nitro-rush/field-edit'
import { defaultFieldPlan, type FieldTile } from '#shared/utils/nitro-rush/field'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { Track, type Route } from '#shared/utils/nitro-rush/track'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, crossesLines, gridCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive, RECTANGLE } from './bot-lap'

/** Checkpoints marked required: every lap has to drive them, so routes that skip one don't count. */

const LEFT = { branch: 0, at: 2 }

/** The detour course from `field-detour.spec.ts`: four joined fields, with a loop off the third that has a checkpoint on it. */
const detour = (checkpoint: SectionId) => settleFieldJoins(sanitizeCustomTrack({
    id: 'custom-test',
    name: 'My Track',
    closed: false,
    sections: ['field', 'field', 'field', 'field'],
    branches: [{ sections: ['right-wide', 'straight-20', 'right-wide', checkpoint, 'right-wide'], from: { ...LEFT, port: { edge: 'left', tile: 4.5 } }, to: null }],
    fields: [
        { at: { branch: 0, at: 0 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 4 }, tiles: [] },
        { at: { branch: 0, at: 1 }, width: 200, length: 200, entry: 4, exit: { edge: 'right', tile: 4 }, tiles: [{ col: 1, row: 8, kind: 'start', dir: 1 }] },
        { at: LEFT, width: 200, length: 200, entry: 5, exit: { edge: 'right', tile: 4 }, tiles: [] },
        { at: { branch: 0, at: 3 }, width: 200, length: 200, entry: 5, exit: { edge: 'exit', tile: 5 }, tiles: [{ col: 1, row: 8, kind: 'finish', dir: 0 }] }
    ]
}) as CustomTrack)

const SPRINT: SectionId[] = ['straight-20', 'start', 'straight-100', 'checkpoint-required', 'straight-100', 'finish', 'straight-200']
const FIELD_SPRINT: SectionId[] = ['straight-20', 'start', 'straight-20', 'field', 'straight-100', 'finish', 'straight-200']
const FIELD_SPOT = { branch: 0, at: 3 }

const course = (sections: SectionId[], extra: Partial<CustomTrack> = {}): CustomTrack => ({ id: 'custom-test', name: 'Test', closed: false, sections, ...extra })
const built = (t: CustomTrack) => {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
const done = (e: FieldEdit) => {
    expect(e.error).toBeNull()
    return e.track!
}

/** The bot's run down `route` until it ends a lap or misses one, with the events it saw. */
function botRun(track: Track, route: Route) {
    const car = gridCar(track)
    const timer = new LapTimer(track, car.x, car.y, car.z)
    const events: LapEvent[] = []
    for (let i = 0; i < PHYSICS_HZ * 240; i++) {
        expect(stepCar(car, botInput(car, track, 1, route), track, 1 / PHYSICS_HZ).fell).toBe(false)
        events.push(...timer.update(car.x, car.y, car.z, 1 / PHYSICS_HZ, crossesLines(car, track)))
        if (events.some(e => e.type === 'lap' || e.type === 'missed')) return events
    }
    throw new Error('the run never reached the finish')
}

/** Steps along the main line from `from` to `to`, 2 m every 1/20 s, the way a car on the road would. */
function along(track: Track, timer: LapTimer, from: number, to: number) {
    const events: LapEvent[] = []
    for (let s = from + 2; s <= to; s += 2) {
        const p = track.pointAt(track.wrapS(s))
        events.push(...timer.update(p.x, p.y, p.z, 0.05))
    }
    return events
}

describe('a required checkpoint on a detour', () => {
    it('leaves only the route through the detour, which compiles and the bot drives', () => {
        const plain = built(detour('checkpoint'))
        expect(plain.routes).toHaveLength(2)
        const track = built(detour('checkpoint-required'))
        const id = track.checkpointIds[1]![0]!
        expect(track.requiredIds).toEqual([id])
        expect(track.routes).toHaveLength(1)
        expect(track.routes[0]!.checkpoints).toContain(id)
        expect(track.k).toBe(1)
        expect(ghostDrivesTrack(track, drive(track, 0, track.routes[0]!))).toBe(true)
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
    })

    it('won\'t count a run that skips the detour', () => {
        const track = built(detour('checkpoint-required'))
        const skip = built(detour('checkpoint')).routes.find(r => r.legs.every(l => l.branch === 0))!
        const events = botRun(track, skip)
        expect(events.filter(e => e.type === 'lap')).toEqual([])
        expect(events.find(e => e.type === 'missed')).toMatchObject({ required: true })
        // The skipping ghost isn't a lap either.
        expect(ghostDrivesTrack(track, drive(built(detour('checkpoint')), 0, skip))).toBe(false)
    })
})

describe('a required checkpoint on a field', () => {
    const tiles: FieldTile[] = [{ col: 0, row: 2, kind: 'checkpoint', dir: 0, required: true }]
    const withGate = course(FIELD_SPRINT, { fields: [{ at: FIELD_SPOT, ...defaultFieldPlan(), tiles }] })

    it('is placed and switched with the checkpoint tool', () => {
        const plain = course(FIELD_SPRINT)
        let t = done(useFieldTool(plain, FIELD_SPOT, 0, 2, 'checkpoint', true, 0, true))
        expect(fieldPlanAt(t, FIELD_SPOT).tiles).toEqual(tiles)
        // Tapped with the switch off, it goes back to normal where it stands, and only then turns.
        t = done(useFieldTool(t, FIELD_SPOT, 0, 2, 'checkpoint', true, 0, false))
        expect(fieldPlanAt(t, FIELD_SPOT).tiles).toEqual([{ col: 0, row: 2, kind: 'checkpoint', dir: 0 }])
        t = done(useFieldTool(t, FIELD_SPOT, 0, 2, 'checkpoint', true, 0, false))
        expect(fieldPlanAt(t, FIELD_SPOT).tiles).toEqual([{ col: 0, row: 2, kind: 'checkpoint', dir: 1 }])
        t = done(useFieldTool(t, FIELD_SPOT, 0, 2, 'checkpoint', true, 0, true))
        expect(fieldPlanAt(t, FIELD_SPOT).tiles).toEqual([{ col: 0, row: 2, kind: 'checkpoint', dir: 1, required: true }])
    })

    it('has to be driven: the bot goes through it, and a run straight across misses it', () => {
        const track = built(withGate)
        const gate = track.fieldGateIds[0]![0]!
        expect(track.requiredIds).toEqual([gate])
        expect(track.lapLines.find(l => l.id === gate)).toMatchObject({ field: 0, required: true })
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
        const p = track.pointAt(track.startS - 10)
        const timer = new LapTimer(track, p.x, p.y, p.z)
        const events = along(track, timer, track.startS - 10, track.finishS + 10)
        expect(events).toEqual([{ type: 'missed', lap: 0, required: true }])
        expect(timer.finished).toBe(false)
    })

    it('changes the road key, so times set without it don\'t carry over', () => {
        const normal = course(FIELD_SPRINT, { fields: [{ at: FIELD_SPOT, ...defaultFieldPlan(), tiles: [{ col: 0, row: 2, kind: 'checkpoint', dir: 0 }] }] })
        expect(roadKey(withGate)).toContain('[0,2,"checkpoint",0,1]')
        // A course without a required one keeps the key it always had.
        expect(roadKey(normal)).toContain('[0,2,"checkpoint",0]')
    })
})

describe('a required checkpoint no route can drive', () => {
    it('is refused with a message', () => {
        const fork = (checkpoint: SectionId): CustomTrack => ({
            id: 'custom-sprint', name: 'Sprint', closed: false,
            sections: ['straight-20', 'start', 'split-right', 'straight-100', checkpoint, 'straight-60', 'straight-20', 'finish', 'straight-100'],
            branches: [{ sections: ['left-eighth', 'straight-100', checkpoint, 'straight-60', 'straight-20', 'finish', 'straight-100'], from: { branch: 0, at: 2 }, to: null }]
        })
        expect(built(fork('checkpoint')).routes).toHaveLength(2)
        const { def, error } = compileCustomTrack(fork('checkpoint-required'))
        expect(def).toBeNull()
        expect(error).toBe('No route passes every required checkpoint')
    })
})

describe('timing a required checkpoint', () => {
    it('won\'t end a sprint that jumped it, and does once it was driven', () => {
        const track = built(course(SPRINT))
        const [cp] = track.lapLines.filter(l => l.kind === 'checkpoint')
        expect(cp).toMatchObject({ required: true })
        const from = track.startS - 10
        const p = track.pointAt(from)
        const timer = new LapTimer(track, p.x, p.y, p.z)
        along(track, timer, from, cp!.s - 6)
        // Off the ground over it: the move crosses nothing.
        const past = track.pointAt(cp!.s + 6)
        expect(timer.update(past.x, past.y, past.z, 0.05, false)).toEqual([])
        expect(along(track, timer, cp!.s + 6, track.finishS + 10)).toEqual([{ type: 'missed', lap: 0, required: true }])
        expect(timer.finished).toBe(false)

        const clean = new LapTimer(track, p.x, p.y, p.z)
        expect(along(track, clean, from, track.finishS + 10).map(e => e.type)).toEqual(['split', 'lap'])
        expect(clean.finished).toBe(true)
    })

    it('counts on every lap of a loop', () => {
        const track = built(course(RECTANGLE.map(id => id === 'straight-20' ? 'checkpoint-required' : id), { closed: true }))
        const [cp] = track.lapLines.filter(l => l.kind === 'checkpoint')
        expect(cp).toMatchObject({ required: true })
        const L = track.length
        const p = track.pointAt(track.wrapS(-10))
        const timer = new LapTimer(track, p.x, p.y, p.z)
        expect(along(track, timer, -10, L + 10).map(e => e.type)).toEqual(['split', 'lap'])
        along(track, timer, L + 10, L + cp!.s - 6)
        const past = track.pointAt(cp!.s + 6)
        timer.update(past.x, past.y, past.z, 0.05, false)
        expect(along(track, timer, L + cp!.s + 6, 2 * L + 10)).toEqual([{ type: 'missed', lap: 1, required: true }])
        expect(timer.lap).toBe(1)
    })
})

describe('storing a required checkpoint', () => {
    const stored = { ...course(FIELD_SPRINT.map(id => id === 'straight-100' ? 'checkpoint-required' : id)), fields: [{ at: FIELD_SPOT, ...defaultFieldPlan(), tiles: [{ col: 0, row: 2, kind: 'checkpoint', dir: 1, required: true }] }] }

    it('round-trips the section and the field flag', () => {
        expect(sanitizeCustomTrack(stored)).toEqual(stored)
        const { track, error } = importCustomTrack(exportCustomTrack(stored), stored.id)
        expect(error).toBeNull()
        expect(track).toEqual(stored)
    })

    it('loads a course without any just as it was', () => {
        const old = { ...course(FIELD_SPRINT), fields: [{ at: FIELD_SPOT, ...defaultFieldPlan(), tiles: [{ col: 0, row: 2, kind: 'checkpoint', dir: 1 }] }] }
        expect(sanitizeCustomTrack(old)).toEqual(old)
        expect(compileCustomTrack(old).def!.requiredCheckpoints).toBeUndefined()
    })

    it('refuses junk', () => {
        const tile = (extra: Record<string, unknown>) => ({ ...stored, fields: [{ ...stored.fields[0]!, tiles: [{ col: 0, row: 2, kind: 'checkpoint', dir: 1, ...extra }] }] })
        for (const required of [false, 1, 'yes', null, {}]) expect(sanitizeCustomTrack(tile({ required }))).toBeNull()
        // Only a checkpoint can be required.
        expect(sanitizeCustomTrack({ ...stored, fields: [{ ...stored.fields[0]!, tiles: [{ col: 0, row: 2, kind: 'boost', dir: 1, required: true }] }] })).toBeNull()
        expect(sanitizeCustomTrack({ ...stored, fields: [{ ...stored.fields[0]!, tiles: [{ col: 0, row: 2, kind: 'block', required: true }] }] })).toBeNull()
        expect(sanitizeCustomTrack({ ...stored, sections: [...stored.sections, 'checkpoint-mandatory'] })).toBeNull()
    })
})

describe('the shortest lap past many required gates', () => {
    /** A 200 m field on the sprint with `count` checkpoint gates on it, the first `required` of them required. */
    const gates = (count: number, required: number) => {
        const tiles: FieldTile[] = []
        for (let row = 1; row < 9 && tiles.length < count; row++) {
            for (let col = 0; col < 10 && tiles.length < count; col += 2) tiles.push({ col, row, kind: 'checkpoint', dir: 1, ...tiles.length < required ? { required: true as const } : {} })
        }
        return built(course(FIELD_SPRINT, { fields: [{ at: FIELD_SPOT, ...defaultFieldPlan(200, 200), tiles }] }))
    }

    it('is worked out in time however many gates there are, and is never lower for gates being required', () => {
        for (const count of [13, 20, 32]) {
            const track = gates(count, 12)
            expect(track.requiredIds).toHaveLength(12)
            expect(Number.isFinite(track.minLapSeconds)).toBe(true)
            // Required gates only add to a lap, so their bound is never below the same gates' with none required.
            expect(track.minLapSeconds).toBeGreaterThanOrEqual(gates(count, 0).minLapSeconds)
        }
    }, 10_000)
})
