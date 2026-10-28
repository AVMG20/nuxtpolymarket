import { describe, expect, it } from 'vitest'
import { DRIFT_MIN_SPEED, ENGINE_TOP_SPEED, NITRO_DURATION, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, createCar, fireNitro, stepCar, wallLimit, type CarInput } from '../../app/utils/nitro-rush/physics'
import { buildTrack, POLYTOWN_OVAL } from '#shared/utils/nitro-rush/layout'
import { LapTimer, Track, type LapEvent, type TrackDef } from '#shared/utils/nitro-rush/track'

const track = new Track(buildTrack(POLYTOWN_OVAL))
const DT = 1 / PHYSICS_HZ
const input = (o: Partial<CarInput> = {}): CarInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...o })

/** An 800 m point-to-point sprint with a gentle S in it. */
function sprintDef(): TrackDef {
    const points: [number, number][] = []
    for (let z = 0; z >= -800; z -= 2) points.push([Math.sin(-z / 800 * Math.PI * 2) * 30, z])
    return { id: 'test-sprint', name: 'Test Sprint', points, halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 30, runOff: 150 }
}
const sprint = new Track(sprintDef())

describe('car physics', () => {
    it('reaches 100 km/h in a few seconds and tops out below the engine limit', () => {
        const car = createCar(track, -100)
        let t = 0
        while (car.speed < 100 / 3.6) {
            stepCar(car, input({ throttle: 1 }), track, DT)
            t += DT
        }
        expect(t).toBeGreaterThan(1)
        expect(t).toBeLessThan(2.5)
        for (let i = 0; i < PHYSICS_HZ * 20; i++) stepCar(car, input({ throttle: 1 }), track, DT)
        expect(car.speed).toBeLessThan(ENGINE_TOP_SPEED)
    })

    it('stops on the brakes and then reverses', () => {
        const car = createCar(track, 0)
        car.speed = 30
        for (let i = 0; i < PHYSICS_HZ * 3; i++) stepCar(car, input({ brake: 1 }), track, DT)
        expect(car.speed).toBeLessThan(0)
    })

    it('keeps the car inside the walls when it drives straight at one', () => {
        const car = createCar(track, 0)
        car.speed = 60
        let impact = 0
        for (let i = 0; i < PHYSICS_HZ * 2; i++) {
            const ev = stepCar(car, input({ throttle: 1, steer: 1 }), track, DT)
            impact = Math.max(impact, ev.wallImpact)
            expect(Math.abs(car.proj.lateral)).toBeLessThanOrEqual(wallLimit(track, car) + 1e-6)
        }
        expect(impact).toBeGreaterThan(0)
        // A glancing blow scrapes speed off but keeps the car rolling forward.
        expect(car.speed).toBeGreaterThan(0)
    })

    it('drifts on brake plus steer at speed, and banks nitro when it straightens out', () => {
        // Walls far out of reach, so this tests the drift and not a driving line.
        const track = new Track({ ...buildTrack(POLYTOWN_OVAL), wallOffset: 400 })
        const car = createCar(track, 0)
        car.speed = 40
        const started = stepCar(car, input({ brake: 1, steer: -1 }), track, DT)
        // The wheel eases in, so the drift waits until it is turned far enough.
        expect(started.driftStarted).toBe(false)
        let began = false
        for (let i = 0; i < PHYSICS_HZ && !began; i++) began = stepCar(car, input({ brake: 1, steer: -1 }), track, DT).driftStarted
        expect(began).toBe(true)
        expect(car.drifting).toBe(true)
        expect(car.driftDir).toBe(1)
        for (let i = 0; i < PHYSICS_HZ * 1.2; i++) stepCar(car, input({ throttle: 1, steer: -0.6 }), track, DT)
        let ended = 0
        let earned = 0
        for (let i = 0; i < PHYSICS_HZ * 3 && car.drifting; i++) {
            const ev = stepCar(car, input({ throttle: 1, steer: 1 }), track, DT)
            ended = ev.driftEnded
            earned = ev.nitroEarned
        }
        expect(car.drifting).toBe(false)
        expect(ended).toBeGreaterThan(1)
        expect(earned).toBeGreaterThan(0)
        expect(car.nitro).toBeCloseTo(earned)
    })

    it('straightens out of a drift soon after the wheel is let go', () => {
        const track = new Track({ ...buildTrack(POLYTOWN_OVAL), wallOffset: 400 })
        const car = createCar(track, 0)
        car.speed = 45
        for (let i = 0; i < PHYSICS_HZ && !car.drifting; i++) stepCar(car, input({ brake: 1, steer: -1 }), track, DT)
        for (let i = 0; i < PHYSICS_HZ; i++) stepCar(car, input({ throttle: 1, steer: -1 }), track, DT)
        expect(car.drifting).toBe(true)
        let t = 0
        let earned = 0
        while (car.drifting && t < 2) {
            earned = stepCar(car, input({ throttle: 1 }), track, DT).nitroEarned
            t += DT
        }
        expect(car.drifting).toBe(false)
        expect(t).toBeLessThan(0.6)
        expect(earned).toBeGreaterThan(0)
    })

    it('holds a drift while the wheel is kept or tapped into it', () => {
        const track = new Track({ ...buildTrack(POLYTOWN_OVAL), wallOffset: 400 })
        for (const tapped of [false, true]) {
            const car = createCar(track, 0)
            car.speed = 45
            for (let i = 0; i < PHYSICS_HZ && !car.drifting; i++) stepCar(car, input({ brake: 1, steer: -1 }), track, DT)
            for (let i = 0; i < PHYSICS_HZ * 2; i++) {
                const on = !tapped || i % 48 < 30
                stepCar(car, input({ throttle: 1, steer: on ? -1 : 0 }), track, DT)
            }
            expect(car.drifting).toBe(true)
        }
    })

    it('never drifts below the minimum speed', () => {
        const car = createCar(track, 0)
        car.speed = DRIFT_MIN_SPEED - 2
        for (let i = 0; i < PHYSICS_HZ; i++) stepCar(car, input({ handbrake: true, steer: -1 }), track, DT)
        expect(car.drifting).toBe(false)
    })

    it('fires nitro only from a full meter, once at a time', () => {
        const car = createCar(track, 0)
        car.nitro = 0.9
        expect(fireNitro(car)).toBe(false)
        car.nitro = 1
        expect(fireNitro(car)).toBe(true)
        expect(car.nitroTime).toBe(NITRO_DURATION)
        car.nitro = 1
        expect(fireNitro(car)).toBe(false)
    })
})

describe('demo bot', () => {
    it('laps the oval cleanly, lap after lap, with laps in a sane window', () => {
        const car = createCar(track, -14)
        const timer = new LapTimer(track.lapLength, true, -14, track.checkpointDistances)
        const events: LapEvent[] = []
        let hits = 0
        for (let i = 0; i < PHYSICS_HZ * 180 && timer.lap < 4; i++) {
            if (stepCar(car, botInput(car, track), track, DT).wallImpact > 0) hits++
            events.push(...timer.update(car.proj.s, DT))
        }
        expect(timer.finished).toBe(false)
        expect(hits).toBe(0)
        const laps = events.filter(e => e.type === 'lap').map(e => e.time)
        expect(laps).toHaveLength(4)
        for (const t of laps) {
            expect(t).toBeGreaterThan(18)
            expect(t).toBeLessThan(30)
        }
        // Flying laps match: nothing carries over from one lap into the next.
        expect(laps[3]).toBeCloseTo(laps[2]!, 1)
    })

    it('runs a sprint from the grid to the finish, then pulls up before the end barrier', () => {
        const car = createCar(sprint, sprint.startS - 14)
        const timer = new LapTimer(sprint.lapLength, false, -14)
        const laps: number[] = []
        let hits = 0
        for (let i = 0; i < PHYSICS_HZ * 60; i++) {
            if (stepCar(car, botInput(car, sprint), sprint, DT).wallImpact > 0) hits++
            for (const e of timer.update(car.proj.s - sprint.startS, DT)) if (e.type === 'lap') laps.push(e.time)
        }
        expect(laps).toHaveLength(1)
        expect(timer.finished).toBe(true)
        expect(laps[0]).toBeGreaterThan(sprint.minLapSeconds)
        expect(laps[0]).toBeLessThan(40)
        expect(hits).toBe(0)
        expect(car.speed).toBeLessThan(1)
        expect(car.proj.s).toBeGreaterThan(sprint.finishS)
        expect(car.proj.s).toBeLessThan(sprint.length)
    })
})

describe('open course barriers', () => {
    it('stops a car driven flat out into the far end', () => {
        const car = createCar(sprint, sprint.finishS)
        car.speed = 60
        let impact = 0
        for (let i = 0; i < PHYSICS_HZ * 6; i++) {
            impact = Math.max(impact, stepCar(car, input({ throttle: 1 }), sprint, DT).wallImpact)
            expect(car.proj.s).toBeLessThanOrEqual(sprint.length - 0.9)
        }
        expect(impact).toBeGreaterThan(30)
    })

    it('stops a car reversing out past the start', () => {
        const car = createCar(sprint, 10)
        for (let i = 0; i < PHYSICS_HZ * 6; i++) {
            stepCar(car, input({ brake: 1 }), sprint, DT)
            expect(car.proj.s).toBeGreaterThanOrEqual(0.9)
        }
        expect(car.speed).toBeLessThanOrEqual(0)
    })
})
