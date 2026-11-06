import { describe, expect, it } from 'vitest'
import { BOOST_DURATION, ENGINE_TOP_SPEED, NITRO_DURATION, NITRO_TOP_SPEED_MULT, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { createCar, fireNitro, stepCar, surging, type CarState } from '../../app/utils/nitro-rush/physics'
import { compileCustomTrack, sectionFault, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { SPEED_CEILING, Track } from '#shared/utils/nitro-rush/track'
import { drive, trackOf } from './bot-lap'

const DT = 1 / PHYSICS_HZ
const COAST = { throttle: 0, brake: 0, steer: 0, drift: false }
const GAS = { ...COAST, throttle: 1 }
const sprint = (...sections: SectionId[]): SectionId[] => ['straight-20', 'start', 'straight-60', ...sections, 'straight-200', 'finish', 'straight-200']
const padOf = (t: Track) => t.boostPads[0]!

/** A car rolling at `speed`, a little before the first pad and `lateral` across the road. */
function carBefore(t: Track, speed: number, lateral = 0): CarState {
    const car = createCar(t, padOf(t).from - 10, lateral)
    car.speed = speed
    return car
}

/** Steps the car past the end of the first pad; counts the kicks. */
function runOver(t: Track, car: CarState, input = COAST) {
    let kicks = 0
    const end = padOf(t).to + 5
    for (let i = 0; i < PHYSICS_HZ * 5 && car.proj.s < end; i++) if (stepCar(car, input, t, DT).boosted) kicks++
    return kicks
}

describe('boost pad road', () => {
    it('covers the whole road, or the half it says', () => {
        const hw = trackOf(false, sprint('boost-pad')).halfWidth
        expect(padOf(trackOf(false, sprint('boost-pad')))).toMatchObject({ latFrom: -hw, latTo: hw })
        expect(padOf(trackOf(false, sprint('boost-pad-left')))).toMatchObject({ latFrom: -hw, latTo: 0 })
        expect(padOf(trackOf(false, sprint('boost-pad-right')))).toMatchObject({ latFrom: 0, latTo: hw })
    })

    it('goes on any bank or slope', () => {
        for (const id of ['boost-pad', 'boost-pad-left', 'boost-pad-right'] as const) {
            expect(sectionFault(id, { bank: 25, grade: 0.1 })).toBeNull()
        }
        const { def, error } = compileCustomTrack({ id: 'custom-t', name: 'T', closed: false, sections: sprint('bank-left', 'boost-pad', 'bank-flat', 'slope-up', 'boost-pad', 'slope-flat') })
        expect(error).toBeNull()
        expect(def!.boosts).toHaveLength(2)
    })

    it('stays where it was laid when a loop is rotated to begin at its start line', () => {
        const t = trackOf(true, ['boost-pad', 'start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'straight-20', 'right-tight', 'right-tight'])
        const { from, to } = padOf(t)
        expect(to - from).toBeCloseTo(12, 0)
        // The first piece sets off from the origin up the map, and the pad is in its middle.
        const middle = t.pointAt((from + to) / 2)
        expect(middle.x).toBeCloseTo(0)
        expect(middle.z).toBeCloseTo(-10)
    })
})

describe('boost pad physics', () => {
    it('kicks once per pass, and the surge outlasts the pad', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const car = carBefore(t, 40)
        expect(runOver(t, car)).toBe(1)
        expect(car.speed).toBeGreaterThan(45)
        expect(car.boostTime).toBeGreaterThan(BOOST_DURATION - 0.5)
        expect(surging(car)).toBe(true)
        for (let i = 0; i < PHYSICS_HZ * BOOST_DURATION; i++) stepCar(car, COAST, t, DT)
        expect(car.boostTime).toBe(0)
        expect(surging(car)).toBe(false)
    })

    it('keeps pulling after the kick, even off the gas', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const car = carBefore(t, 40)
        runOver(t, car)
        const off = car.speed
        for (let i = 0; i < PHYSICS_HZ / 2; i++) stepCar(car, COAST, t, DT)
        expect(car.speed).toBeGreaterThan(off + 1)
    })

    it('kicks again on the next pad', () => {
        const t = trackOf(false, sprint('boost-pad', 'boost-pad'))
        const car = carBefore(t, 40)
        let kicks = 0
        const end = t.boostPads[1]!.to + 5
        for (let i = 0; i < PHYSICS_HZ * 5 && car.proj.s < end; i++) if (stepCar(car, COAST, t, DT).boosted) kicks++
        expect(kicks).toBe(2)
    })

    it('only works in the lane it covers', () => {
        const t = trackOf(false, sprint('boost-pad-right'))
        expect(runOver(t, carBefore(t, 40, 4))).toBe(1)
        expect(runOver(t, carBefore(t, 40, -4))).toBe(0)
    })

    it('gives nothing reversing or driving the wrong way', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const reversing = createCar(t, padOf(t).to + 5)
        reversing.speed = -10
        const wrongWay = createCar(t, padOf(t).to + 5)
        wrongWay.heading = wrongWay.travel = wrongWay.heading + Math.PI
        wrongWay.speed = 30
        for (const car of [reversing, wrongWay]) {
            for (let i = 0; i < PHYSICS_HZ; i++) expect(stepCar(car, COAST, t, DT).boosted).toBe(false)
            expect(car.boostTime).toBe(0)
        }
    })

    it('gives nothing to a car flying over', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const car = carBefore(t, 40)
        car.airborne = true
        car.y += 20
        expect(runOver(t, car)).toBe(0)
    })

    it('never takes the car past nitro\'s top speed, or slows one already beyond it', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const limit = ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT
        expect(limit).toBeLessThan(SPEED_CEILING)
        const fast = carBefore(t, limit - 1)
        expect(runOver(t, fast, GAS)).toBe(1)
        expect(fast.speed).toBeLessThanOrEqual(limit)
        expect(fast.speed).toBeGreaterThan(limit - 3)
        // Off a long downhill: the pad gives nothing, and takes no more than the step's own drag.
        const beyond = carBefore(t, limit + 4)
        let before = beyond.speed
        while (!stepCar(beyond, COAST, t, DT).boosted) before = beyond.speed
        expect(beyond.speed).toBeGreaterThan(before - 0.2)
        expect(beyond.speed).toBeLessThanOrEqual(before)
    })

    it('leaves the nitro tank alone and doesn\'t stop it firing', () => {
        const t = trackOf(false, sprint('boost-pad'))
        const car = carBefore(t, 40)
        car.nitro = 1
        runOver(t, car)
        expect(car.nitro).toBe(1)
        expect(car.nitroTime).toBe(0)
        expect(fireNitro(car)).toBe(true)
        expect(car.nitroTime).toBe(NITRO_DURATION)
    })

    it('makes a course quicker, and a lap over it still passes the ghost check', () => {
        const plain = trackOf(false, sprint('straight-20'))
        const boosted = trackOf(false, sprint('boost-pad'))
        expect(boosted.length).toBeCloseTo(plain.length, 3)
        const plainLap = drive(plain)
        const boostedLap = drive(boosted)
        expect(boostedLap.end).toBeLessThan(plainLap.end)
        expect(ghostDrivesTrack(boosted, boostedLap)).toBe(true)
    })
})
