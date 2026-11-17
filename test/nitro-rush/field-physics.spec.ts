import { describe, expect, it } from 'vitest'
import { CAR_HALF_LENGTH, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { createCar, crossesLines, stepCar, type CarInput, type CarState, type StepEvents } from '../../app/utils/nitro-rush/physics'
import { hitFieldWalls } from '../../app/utils/nitro-rush/physics-walls'
import { WRONG_WAY_DELAY, wrongWayTime } from '../../app/utils/nitro-rush/wrong-way'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { defaultFieldPlan, gatePosts, PILLAR_RADIUS, type FieldDef, type FieldPort, type FieldTile } from '#shared/utils/nitro-rush/field'
import { GHOST_POSE, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { CourseField, SPEED_CEILING, Track } from '#shared/utils/nitro-rush/track'

const DT = 1 / PHYSICS_HZ
const COAST: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false }
const GAS: CarInput = { ...COAST, throttle: 1 }
/** Physics headings: the car faces (-sin h, -cos h). */
const TO_MINUS_Z = 0
const TO_PLUS_Z = Math.PI
const TO_PLUS_X = -Math.PI / 2
const ROAD: SectionId[] = ['straight-20', 'start', 'field', 'finish', 'straight-200']

/** A 100 m square entered at (0, -40) heading -z: u = x + 50 and v = -40 - z. */
function fieldTrack(tiles: FieldTile[] = [], exit: FieldPort = { edge: 'exit', tile: 2 }) {
    const t: CustomTrack = { id: 'custom-test', name: 'Test', closed: false, sections: ROAD, fields: [{ at: { branch: 0, at: 2 }, ...defaultFieldPlan(), exit, tiles }] }
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
const world = (u: number, v: number): [number, number] => [u - 50, -40 - v]

/** A car at field point (u, v) facing `heading` at `speed`. */
function carAt(track: Track, u: number, v: number, heading: number, speed: number) {
    const car = createCar(track, 30)
    const [x, z] = world(u, v)
    car.x = x
    car.z = z
    car.heading = car.travel = heading
    car.speed = speed
    track.locate(x, z, car.proj.branch, car.proj.seg, car.proj)
    return car
}

/** Steps the car for `seconds`, collecting every step's events. */
function run(car: CarState, track: Track, seconds: number, input = COAST) {
    const evs: StepEvents[] = []
    for (let i = 0; i < seconds * PHYSICS_HZ; i++) evs.push(stepCar(car, input, track, DT))
    return evs
}
const hit = (evs: StepEvents[]) => evs.some(e => e.wallImpact > 0)

describe('field walls', () => {
    it('stops a car at an edge wall and lets one out through a mouth', () => {
        const t = fieldTrack()
        const wall = carAt(t, 80, 50, TO_PLUS_X, 30)
        expect(hit(run(wall, t, 2))).toBe(true)
        expect(wall.x).toBeLessThanOrEqual(50 - CAR_HALF_LENGTH + 0.01)
        expect(wall.proj.field).toBe(0)

        const mouth = carAt(t, 50, 80, TO_MINUS_Z, 30)
        expect(hit(run(mouth, t, 1.5, GAS))).toBe(false)
        expect(mouth.z).toBeLessThan(-145)
        expect(mouth.proj.field).toBe(-1)
    })

    it('stops a car head on at the seam between two blocks', () => {
        const blocks: FieldTile[] = [1, 2, 3].map(col => ({ col, row: 2, kind: 'block' }))
        const t = fieldTrack(blocks)
        const car = carAt(t, 40, 20, TO_MINUS_Z, 30)
        expect(hit(run(car, t, 2))).toBe(true)
        expect(-40 - car.z).toBeLessThanOrEqual(40 - CAR_HALF_LENGTH + 0.01)
    })

    it('slides a car along a row of blocks without catching on the seams', () => {
        const blocks: FieldTile[] = [1, 2, 3].map(col => ({ col, row: 2, kind: 'block' }))
        const t = fieldTrack(blocks)
        // Heading +x and 5° in toward the blocks' face, 1.3 m from it.
        const car = carAt(t, 12, 37.7, TO_PLUS_X + 5 * Math.PI / 180, 30)
        let x = car.x
        const impacts: number[] = []
        // Until it's past the blocks' far end, short of the field's right wall.
        for (let i = 0; i < PHYSICS_HZ * 3 && car.x + 50 < 82; i++) {
            const ev = stepCar(car, GAS, t, DT)
            if (ev.wallImpact > 0) impacts.push(ev.wallImpact)
            expect(car.x).toBeGreaterThan(x)
            x = car.x
        }
        expect(car.x + 50).toBeGreaterThan(80)
        // The glancing touch, and nothing as hard after it.
        expect(impacts[0]).toBeGreaterThan(1)
        expect(Math.max(...impacts.slice(1), 0)).toBeLessThan(0.5)
    })

    it('stops a car at a pillar', () => {
        const t = fieldTrack([{ col: 2, row: 2, kind: 'pillar' }])
        const car = carAt(t, 50, 25, TO_MINUS_Z, 20)
        expect(hit(run(car, t, 2))).toBe(true)
        expect(-40 - car.z).toBeLessThanOrEqual(50 - PILLAR_RADIUS - CAR_HALF_LENGTH + 0.01)
    })

    it('leaves the edge two fields share open', () => {
        const def = (z: number): FieldDef => ({ x: 0, z, heading: 0, y: 0, plan: defaultFieldPlan(), home: { branch: 0, at: 0 }, mouths: [] })
        const a = def(0)
        const b = def(-100)
        const track = fieldTrack()
        // Nose past a's far edge, driving on into b.
        const bump = (field: CourseField) => {
            const car = createCar(track, 30)
            car.x = 50
            car.z = -99
            car.heading = car.travel = TO_MINUS_Z
            car.speed = 20
            const ev: StepEvents = { wallImpact: 0, wallTouched: false, scraping: false, driftStarted: false, driftEnded: 0, nitroEarned: 0, tookOff: false, landed: 0, fell: false, boosted: false, nitroStarted: false }
            hitFieldWalls(car, field, ev)
            return ev.wallImpact
        }
        expect(bump(new CourseField(a, 0))).toBeGreaterThan(0)
        expect(bump(new CourseField(a, 0, [a, b]))).toBe(0)
    })
})

describe('field pads', () => {
    const t = fieldTrack([{ col: 2, row: 2, kind: 'boost', dir: 0 }])

    it('boosts a car driving the way the pad points', () => {
        const car = carAt(t, 50, 30, TO_MINUS_Z, 20)
        expect(run(car, t, 1, GAS).some(e => e.boosted)).toBe(true)
    })

    it('leaves a car driving against it alone', () => {
        const car = carAt(t, 50, 70, TO_PLUS_Z, 20)
        expect(run(car, t, 1, GAS).some(e => e.boosted)).toBe(false)
    })
})

describe('field gates', () => {
    /** A gate on the left column, halfway along, crossed driving forward. */
    const t = fieldTrack([{ col: 0, row: 2, kind: 'checkpoint', dir: 0 }])
    const gate = t.lapLines.find(l => l.kind === 'checkpoint')!

    it('counts toward the lap like any checkpoint, and times every course with it', () => {
        expect(gate).toBeDefined()
        expect(t.checkpointCount).toBe(1)
        expect(t.k).toBe(1)
        // The straight line across now bends out to the gate.
        expect(t.minLapSeconds * SPEED_CEILING).toBeGreaterThan(fieldTrack().minLapSeconds * SPEED_CEILING + 10)
    })

    /** A timer at u = 10, v = `from`, or that timer moved a metre a step along v to `to`. */
    const timerAt = (from: number) => new LapTimer(t, world(10, from)[0], 0, world(10, from)[1])
    const across = (timer: LapTimer, from: number, to: number) => {
        const step = Math.sign(to - from)
        for (let v = from + step; v !== to + step; v += step) timer.update(world(10, v)[0], 0, world(10, v)[1], DT)
    }

    it('is touched crossing it its way, and kept crossing it back', () => {
        const timer = timerAt(40)
        across(timer, 40, 60)
        expect(timer.touched).toEqual([gate.id])
        across(timer, 60, 40)
        expect(timer.touched).toEqual([gate.id])
    })

    it('is touched crossing it backward, and kept crossing it again its way', () => {
        const timer = timerAt(60)
        across(timer, 60, 40)
        expect(timer.touched).toEqual([gate.id])
        across(timer, 40, 60)
        expect(timer.touched).toEqual([gate.id])
    })

    it('counts as driven anywhere on the field, even in the air', () => {
        const car = carAt(t, 10, 50, TO_MINUS_Z, 20)
        car.airborne = true
        car.y = 3
        expect(crossesLines(car, t)).toBe(true)
    })

    /** A ghost at 25 m/s along straight legs through field points. */
    const ghostAlong = (points: [number, number][]): Ghost => {
        const hz = 30
        const poses: number[] = []
        for (let i = 0; i + 1 < points.length; i++) {
            const [ax, az] = points[i]!
            const [bx, bz] = points[i + 1]!
            const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / (25 / hz)))
            for (let k = 0; k < n; k++) poses.push(ax + (bx - ax) * k / n, 0, az + (bz - az) * k / n, 0, 0, 0, 1)
        }
        const [x, z] = points[points.length - 1]!
        poses.push(x, 0, z, 0, 0, 0, 1)
        const data = Float32Array.from(poses)
        return { hz, end: (data.length / GHOST_POSE - 1) / hz, data }
    }

    it('stops a car at one of its posts', () => {
        const [, [u, v]] = gatePosts({ col: 0, row: 2, dir: 0 })
        const car = carAt(t, u, v - 8, TO_MINUS_Z, 15)
        expect(hit(run(car, t, 1, GAS))).toBe(true)
        expect(t.fields[0]!.local(car.x, car.z).v).toBeLessThan(v)
    })

    it('lets a car drive cleanly between its posts and counts it', () => {
        const car = carAt(t, 10, 30, TO_MINUS_Z, 15)
        const timer = new LapTimer(t, car.x, car.y, car.z)
        for (let i = 0; i < 2 * PHYSICS_HZ; i++) {
            const ev = stepCar(car, GAS, t, DT)
            expect(ev.wallImpact).toBe(0)
            timer.update(car.x, car.y, car.z, DT, crossesLines(car, t))
        }
        expect(t.fields[0]!.local(car.x, car.z).v).toBeGreaterThan(60)
        expect(timer.touched).toEqual([gate.id])
    })

    it('passes a lap through the gate and fails one that skips it', () => {
        expect(ghostDrivesTrack(t, ghostAlong([[0, -25], [0, -40], [-40, -70], [-40, -110], [0, -140], [0, -151]]))).toBe(true)
        expect(ghostDrivesTrack(t, ghostAlong([[0, -25], [0, -40], [0, -140], [0, -151]]))).toBe(false)
    })

    it('passes a lap that takes the gate backward', () => {
        // Past the gate on the open side, round, back down through it, then off clear of it to the exit.
        const lap = [world(50, -15), world(50, 0), world(30, 80), world(10, 80), world(10, 30), world(60, 40), world(50, 100), world(50, 111)]
        expect(ghostDrivesTrack(t, ghostAlong(lap))).toBe(true)
    })
})

describe('the wrong-way warning', () => {
    const t = fieldTrack()

    it('never warns on a field, free roam that it is', () => {
        const car = carAt(t, 50, 60, TO_PLUS_Z, 20)
        expect(car.proj.field).toBe(0)
        let held = 0
        for (let i = 0; i < 3 * PHYSICS_HZ; i++) held = wrongWayTime(car, held, DT)
        expect(held).toBe(0)
    })

    it('still warns on the road, as soon as the car is back on it', () => {
        const car = createCar(t, 10)
        car.heading = car.travel = TO_PLUS_Z
        car.speed = 20
        expect(car.proj.field).toBe(-1)
        let held = 0
        for (let i = 0; i < 2 * PHYSICS_HZ; i++) held = wrongWayTime(car, held, DT)
        expect(held).toBeGreaterThan(WRONG_WAY_DELAY)
        car.heading = car.travel = TO_MINUS_Z
        expect(wrongWayTime(car, held, DT)).toBe(0)
    })
})

describe('falling onto a field', () => {
    const t = fieldTrack()

    it('lands a falling car on the field', () => {
        const car = carAt(t, 30, 60, TO_MINUS_Z, 10)
        car.airborne = true
        car.y = 4
        car.leftY = 4
        car.vy = 0
        const evs = run(car, t, 1.5)
        expect(evs.some(e => e.fell)).toBe(false)
        expect(car.airborne).toBe(false)
        expect(car.proj.field).toBe(0)
    })

    it('respawns a car back onto the field', () => {
        const crossing = t.fields[0]!.crossings[0]!
        const car = createCar(t, (crossing.from + crossing.to) / 2, 0, crossing.branch)
        expect(car.proj.field).toBe(0)
        expect(hit(run(car, t, 0.5))).toBe(false)
    })
})
