import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ, WALL_PIVOT_SPEED, WALL_PRESS_HOLD, WALL_TOUCH_KEEP } from '../../app/utils/nitro-rush/config'
import { createCar, stepCar, wallLimit, type CarInput, type CarState } from '../../app/utils/nitro-rush/physics'
import { wrapAngle } from '#shared/utils/nitro-rush/track'
import { trackOf } from './bot-lap'

const DT = 1 / PHYSICS_HZ
const QUARTER_TURN = Math.PI / 2
const SPEEDS = [5, 15, 30, 60, 86]
const COAST: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false }
const GAS: CarInput = { ...COAST, throttle: 1 }
const track = trackOf(false, ['straight-20', 'start', 'straight-200', 'straight-200', 'straight-200', 'straight-200', 'finish', 'straight-200'])
const S = 300

const degrees = (d: number) => d * Math.PI / 180

/** A car a moment from the right-hand wall, `angle` degrees off the road and doing `speed`. */
function approach(angle: number, speed: number) {
    const car = createCar(track, S, wallLimit(track, createCar(track, S)) - 1 - Math.abs(speed) * 0.05 * Math.sin(degrees(angle)))
    car.heading = car.travel = wrapAngle(car.heading - degrees(angle))
    car.speed = speed
    return car
}

/** Rolls the car into the wall, and stops on the step it hits. */
function toHit(car: CarState) {
    for (let i = 0; i < PHYSICS_HZ * 2; i++) if (stepCar(car, COAST, track, DT).wallImpact > 0) return
    throw new Error('never reached the wall')
}

/** How far the nose swings, and how far the car is thrown off the wall, over the next `seconds` of `input`. */
function after(car: CarState, input: CarInput, seconds = 1.5) {
    const nose = car.heading
    const wall = car.proj.lateral
    let swing = 0
    let thrown = 0
    for (let i = 0; i < PHYSICS_HZ * seconds; i++) {
        stepCar(car, input, track, DT)
        swing = Math.max(swing, Math.abs(wrapAngle(car.heading - nose)))
        thrown = Math.max(thrown, wall - car.proj.lateral)
    }
    return { swing, thrown }
}

describe('a square wall hit', () => {
    it('leaves the nose where it was, at any speed, gas on or off', () => {
        for (const speed of SPEEDS) {
            for (const input of [COAST, GAS]) {
                const car = approach(90, speed)
                toHit(car)
                expect(after(car, input).swing, `${speed} m/s`).toBeLessThan(degrees(1))
            }
        }
    })

    it('takes nearly all the speed, and only rocks the car back', () => {
        for (const speed of SPEEDS) {
            const car = approach(90, speed)
            toHit(car)
            expect(car.speed, `${speed} m/s`).toBeLessThan(0)
            expect(car.speed, `${speed} m/s`).toBeGreaterThan(-speed * 0.1)
            expect(after(car, GAS).thrown, `${speed} m/s`).toBeLessThan(1)
        }
    })

    it('does the same to a car backing into the wall', () => {
        const car = createCar(track, S, wallLimit(track, createCar(track, S)) - 1)
        car.heading = car.travel = wrapAngle(car.heading + QUARTER_TURN)
        car.speed = -15
        for (let i = 0; i < PHYSICS_HZ && stepCar(car, COAST, track, DT).wallImpact === 0; i++);
        expect(car.speed).toBeGreaterThan(0)
        expect(car.speed).toBeLessThan(15 * 0.1)
        expect(after(car, COAST).swing).toBeLessThan(degrees(1))
    })
})

describe('an angled wall hit', () => {
    it('never swings the nose past a quarter turn', () => {
        for (const angle of [10, 20, 30, 45, 60, 75, 85]) {
            for (const speed of SPEEDS) {
                const car = approach(angle, speed)
                toHit(car)
                expect(after(car, GAS).swing, `${angle}° at ${speed} m/s`).toBeLessThanOrEqual(QUARTER_TURN)
            }
        }
    })

    it('turns the car along the wall the way it was going, not back up the road', () => {
        const car = approach(45, 40)
        toHit(car)
        after(car, GAS, 1)
        expect(Math.abs(wrapAngle(car.heading - createCar(track, S).heading))).toBeLessThan(degrees(35))
        expect(car.speed).toBeGreaterThan(0)
    })

    it('throws the car a good deal less far than it used to, keeping it on its side of the road', () => {
        for (const speed of SPEEDS) {
            const car = approach(45, speed)
            toHit(car)
            expect(after(car, GAS).thrown, `${speed} m/s`).toBeLessThan(track.halfWidth)
        }
    })

    it('costs more of the speed the steeper it is', () => {
        const kept = [10, 30, 60].map((angle) => {
            const car = approach(angle, 60)
            toHit(car)
            return car.speed
        })
        expect(kept[0]).toBeGreaterThan(kept[1]!)
        expect(kept[1]).toBeGreaterThan(kept[2]!)
    })
})

describe('touching a wall', () => {
    const WHEEL_IN: CarInput = { ...COAST, steer: 1 }

    /** A hair off the right-hand wall and barely angled at it, at speed. */
    function grazing() {
        const car = createCar(track, S, wallLimit(track, createCar(track, S)) - 0.05)
        car.heading = car.travel = wrapAngle(car.heading - degrees(0.5))
        car.speed = 60
        return car
    }

    /** Steps the car to its next touch, and gives the speed before it. */
    function touch(car: CarState, input = COAST) {
        for (let i = 0; i < PHYSICS_HZ * 2; i++) {
            const before = car.speed
            const ev = stepCar(car, input, track, DT)
            if (ev.wallImpact > 0) return { before, ev }
        }
        throw new Error('never reached the wall')
    }

    it('costs the set share of the speed, however light the touch', () => {
        const graze = grazing()
        const { before, ev } = touch(graze)
        expect(ev.wallTouched).toBe(true)
        expect(ev.wallImpact).toBeLessThan(1)
        expect(graze.speed).toBeLessThan(before * WALL_TOUCH_KEEP)
        expect(graze.speed).toBeGreaterThan(before * WALL_TOUCH_KEEP * 0.9)
    })

    it('charges once, not on every step of a rub', () => {
        const car = grazing()
        touch(car)
        const pressed = touch(car, WHEEL_IN)
        expect(pressed.ev.wallTouched).toBe(false)
        expect(car.speed).toBeGreaterThan(pressed.before * 0.9)
    })

    it('charges again for going back to the wall after leaving it', () => {
        const car = grazing()
        touch(car)
        car.wallPress = 0
        expect(touch(car, WHEEL_IN).ev.wallTouched).toBe(true)
    })
})

describe('a hit that leaves the car slow', () => {
    it('rolls along the face rather than back across the road', () => {
        const car = approach(45, 30)
        toHit(car)
        expect(wrapAngle(car.travel - createCar(track, S).heading)).toBeCloseTo(0, 5)
        expect(after(car, GAS, 1).thrown).toBeLessThan(0.1)
    })
})

describe('a car stopped on a wall', () => {
    const stopped = () => {
        const car = approach(90, 5)
        toHit(car)
        after(car, GAS, 0.5)
        return car
    }

    it('stays put with the wheel straight', () => {
        const car = stopped()
        const s = car.proj.s
        after(car, GAS, 2)
        expect(Math.abs(car.proj.s - s)).toBeLessThan(0.5)
    })

    it('pivots off with gas and wheel, and drives away up the road', () => {
        const car = stopped()
        const s = car.proj.s
        after(car, { ...GAS, steer: -1 }, 0.4)
        after(car, GAS, 2)
        expect(car.proj.s - s).toBeGreaterThan(20)
    })

    it('comes off pointing up the road, not across it at the far wall', () => {
        const car = stopped()
        const road = createCar(track, S).heading
        const wall = car.proj.lateral
        after(car, { ...GAS, steer: -1 }, 0.4)
        after(car, GAS, 0.5)
        expect(Math.abs(wrapAngle(car.heading - road))).toBeLessThan(degrees(35))
        expect(wall - car.proj.lateral).toBeLessThan(2)
    })

    it('needs the gas to pivot', () => {
        const car = stopped()
        car.wallPress = WALL_PRESS_HOLD
        const nose = car.heading
        stepCar(car, { ...COAST, steer: -1 }, track, DT)
        expect(car.heading).toBeCloseTo(nose, 9)
    })

    it('stops counting once the car is rolling', () => {
        const turnOf = (speed: number, wallPress = WALL_PRESS_HOLD) => {
            const car = createCar(track, S)
            car.speed = speed
            car.wallPress = wallPress
            stepCar(car, { ...GAS, steer: -1 }, track, DT)
            return Math.abs(wrapAngle(car.heading - createCar(track, S).heading))
        }
        expect(turnOf(WALL_PIVOT_SPEED / 2)).toBeGreaterThan(turnOf(WALL_PIVOT_SPEED / 2, 0))
        expect(turnOf(WALL_PIVOT_SPEED * 2)).toBeCloseTo(turnOf(WALL_PIVOT_SPEED * 2, 0), 9)
    })

    it('stops pivoting once it is off the wall', () => {
        const turnOf = (wallPress: number) => {
            const car = createCar(track, S)
            car.wallPress = wallPress
            stepCar(car, { ...GAS, steer: -1 }, track, DT)
            return car.heading
        }
        expect(turnOf(WALL_PRESS_HOLD / 2)).toBeCloseTo(turnOf(0), 9)
    })
})
