import { describe, expect, it } from 'vitest'
import { DRIFT_MIN_SPEED, ENGINE_TOP_SPEED, NITRO_DURATION, PHYSICS_HZ, RACE_LAPS } from '../../app/utils/nitro-rush/config'
import { botInput, createCar, fireNitro, stepCar, wallLimit, type CarInput } from '../../app/utils/nitro-rush/physics'
import { LapTimer, ovalTrack, Track, type LapEvent } from '../../app/utils/nitro-rush/track'

const track = new Track(ovalTrack())
const DT = 1 / PHYSICS_HZ
const input = (o: Partial<CarInput> = {}): CarInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...o })

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
        const track = new Track({ ...ovalTrack(), wallOffset: 400 })
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
        const track = new Track({ ...ovalTrack(), wallOffset: 400 })
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
        const track = new Track({ ...ovalTrack(), wallOffset: 400 })
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
    it('finishes a race cleanly with laps in a sane window', () => {
        const car = createCar(track, -14)
        const timer = new LapTimer(track.length, RACE_LAPS, -14)
        const events: LapEvent[] = []
        let hits = 0
        for (let i = 0; i < PHYSICS_HZ * 180 && !timer.finished; i++) {
            if (stepCar(car, botInput(car, track), track, DT).wallImpact > 0) hits++
            events.push(...timer.update(car.proj.s, DT))
        }
        expect(timer.finished).toBe(true)
        expect(hits).toBe(0)
        const laps = events.filter(e => e.type === 'lap').map(e => e.time)
        expect(laps).toHaveLength(RACE_LAPS)
        for (const t of laps) {
            expect(t).toBeGreaterThan(18)
            expect(t).toBeLessThan(30)
        }
    })
})
