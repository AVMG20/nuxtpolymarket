import { describe, expect, it } from 'vitest'
import { DRIFT_MIN_SPEED, NITRO_DURATION, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { createCar, fireNitro, stepCar, wallLimit, type CarInput, type CarState } from '../../app/utils/nitro-rush/physics'
import { compileCustomTrack } from '#shared/utils/nitro-rush/custom'
import { buildTrack } from '#shared/utils/nitro-rush/layout'
import { Track, type TrackDef } from '#shared/utils/nitro-rush/track'
import { POLYTOWN_OVAL } from '#shared/utils/nitro-rush/tracks'

const track = new Track(buildTrack(POLYTOWN_OVAL))
const DT = 1 / PHYSICS_HZ
const input = (o: Partial<CarInput> = {}): CarInput => ({ throttle: 0, brake: 0, steer: 0, drift: false, ...o })

/** An 800 m point-to-point sprint with a gentle S in it. */
function sprintDef(): TrackDef {
    const points: [number, number][] = []
    for (let z = 0; z >= -800; z -= 2) points.push([Math.sin(-z / 800 * Math.PI * 2) * 30, z])
    return { id: 'test-sprint', name: 'Test Sprint', group: 'sprints', points, halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 30, runOff: 150 }
}
const sprint = new Track(sprintDef())

describe('car physics', () => {
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

    describe('wall contact', () => {
        // The oval's main straight, on the right-hand wall.
        const atWall = (speed: number) => {
            const car = createCar(track, 40, wallLimit(track, createCar(track, 40)))
            car.speed = speed
            return car
        }
        const flatOut = (car: CarState, steer: number) => {
            let scraped = false
            for (let i = 0; i < PHYSICS_HZ; i++) scraped = stepCar(car, input({ throttle: 1, steer }), track, DT).scraping || scraped
            return scraped
        }

        it('drags on a car pressed along a wall', () => {
            const rubbing = atWall(50)
            const free = createCar(track, 40)
            free.speed = 50
            expect(flatOut(rubbing, 0.15)).toBe(true)
            expect(flatOut(free, 0)).toBe(false)
            expect(rubbing.speed).toBeLessThan(free.speed)
        })

        it('leaves a car alone that only runs alongside a wall or stands by it', () => {
            expect(flatOut(atWall(50), 0)).toBe(false)
            const parked = atWall(0)
            expect(stepCar(parked, input(), track, DT).scraping).toBe(false)
        })

        it('does not drag on a car in the air', () => {
            const car = atWall(50)
            car.airborne = true
            car.wallPress = 1
            expect(stepCar(car, input(), track, DT).scraping).toBe(false)
        })

        it('keeps some of the speed along the wall after a big hit', () => {
            const car = createCar(track, 40)
            car.speed = 70
            car.travel = car.heading -= 0.5
            let hit = 0
            for (let i = 0; i < PHYSICS_HZ && !hit; i++) hit = stepCar(car, input(), track, DT).wallImpact
            expect(hit).toBeGreaterThan(0)
            const along = -Math.sin(car.travel) * car.proj.tx - Math.cos(car.travel) * car.proj.tz
            expect(along * car.speed).toBeGreaterThan(5)
        })

        it('is gentler on rails, where there is no bend to cut', () => {
            const looping = new Track(compileCustomTrack({ id: 'custom-rail', name: 'Rail', closed: false, sections: ['straight-20', 'start', 'straight-100', 'looping-right', 'straight-100', 'finish', 'straight-200'] }).def!)
            const car = createCar(looping, looping.rails[0]![0] + 5)
            car.speed = 60
            car.rel = -0.3
            let hit = 0
            for (let i = 0; i < PHYSICS_HZ && !hit; i++) hit = stepCar(car, input({ throttle: 1 }), looping, DT).wallImpact
            expect(hit).toBeGreaterThan(0)
            expect(car.speed).toBeGreaterThan(30)
        })
    })

    describe('drifting', () => {
        // Walls far out of reach, so these test the drift and not a driving line.
        const open = new Track({ ...buildTrack(POLYTOWN_OVAL), wallOffset: 400 })
        /** A car thrown into a left drift with the button held. */
        const drifting = () => {
            const car = createCar(open, 0)
            car.speed = 45
            for (let i = 0; i < PHYSICS_HZ && !car.drifting; i++) stepCar(car, input({ throttle: 1, drift: true, steer: -1 }), open, DT)
            expect(car.drifting).toBe(true)
            return car
        }

        it('starts on the drift button with the wheel turned, lasts while it is held and banks nitro on release', () => {
            const car = createCar(open, 0)
            car.speed = 40
            // The wheel eases in, so the drift waits until it is turned far enough.
            expect(stepCar(car, input({ drift: true, steer: -1 }), open, DT).driftStarted).toBe(false)
            let began = false
            for (let i = 0; i < PHYSICS_HZ && !began; i++) began = stepCar(car, input({ drift: true, steer: -1 }), open, DT).driftStarted
            expect(began).toBe(true)
            expect(car.driftDir).toBe(1)
            for (let i = 0; i < PHYSICS_HZ * 2; i++) stepCar(car, input({ throttle: 1, drift: true }), open, DT)
            expect(car.drifting).toBe(true)
            const ev = stepCar(car, input({ throttle: 1 }), open, DT)
            expect(car.drifting).toBe(false)
            expect(ev.driftEnded).toBeGreaterThan(2)
            expect(ev.nitroEarned).toBeGreaterThan(0)
            expect(car.nitro).toBeCloseTo(ev.nitroEarned)
        })

        it('never starts on the brake alone', () => {
            const car = createCar(open, 0)
            car.speed = 40
            for (let i = 0; i < PHYSICS_HZ; i++) stepCar(car, input({ brake: 1, steer: -1 }), open, DT)
            expect(car.drifting).toBe(false)
        })

        it('keeps the brakes off mid-drift, so the touch pedal can hold one', () => {
            const speedAfter = (brake: number) => {
                const car = drifting()
                for (let i = 0; i < PHYSICS_HZ; i++) stepCar(car, input({ throttle: 1, brake, drift: true }), open, DT)
                return car.speed
            }
            expect(speedAfter(1)).toBeCloseTo(speedAfter(0))
        })

        it('needs the button let go before the next drift once one breaks', () => {
            const car = drifting()
            car.speed = DRIFT_MIN_SPEED * 0.5
            expect(stepCar(car, input({ drift: true, steer: -1 }), open, DT).driftEnded).toBeGreaterThan(0)
            car.speed = 40
            for (let i = 0; i < PHYSICS_HZ / 2; i++) stepCar(car, input({ drift: true, steer: -1 }), open, DT)
            expect(car.drifting).toBe(false)
            stepCar(car, input({ steer: -1 }), open, DT)
            expect(stepCar(car, input({ drift: true, steer: -1 }), open, DT).driftStarted).toBe(true)
        })

        it('drifts again after a release of a single step', () => {
            const car = drifting()
            expect(stepCar(car, input({ throttle: 1, steer: -1 }), open, DT).driftEnded).toBeGreaterThan(0)
            expect(stepCar(car, input({ throttle: 1, drift: true, steer: -1 }), open, DT).driftStarted).toBe(true)
        })

        it('needs the button let go after a hard wall hit breaks the drift', () => {
            const car = createCar(track, 0)
            car.speed = 45
            let broke = false
            for (let i = 0; i < PHYSICS_HZ * 3 && !broke; i++) {
                const ev = stepCar(car, input({ throttle: 1, drift: true, steer: -1 }), track, DT)
                broke = ev.driftEnded > 0 && ev.nitroEarned === 0
            }
            expect(broke).toBe(true)
            expect(car.driftSpent).toBe(true)
        })

        it('never starts below the minimum speed', () => {
            const car = createCar(track, 0)
            car.speed = DRIFT_MIN_SPEED - 2
            for (let i = 0; i < PHYSICS_HZ; i++) stepCar(car, input({ drift: true, steer: -1 }), track, DT)
            expect(car.drifting).toBe(false)
        })
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
