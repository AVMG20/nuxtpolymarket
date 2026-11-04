import { describe, expect, it } from 'vitest'
import { buildTrack, corner, finish, jump, looping, start, straight, type TrackLayout } from '#shared/utils/nitro-rush/layout'
import { Track, wrapAngle } from '#shared/utils/nitro-rush/track'
import { createCar, stepCar, type CarState, type StepEvents } from '../../app/utils/nitro-rush/physics'

const HZ = 120
const base = { group: 'sprints' as const, halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 } }
const sprint = (pieces: TrackLayout['pieces']) => new Track(buildTrack({ ...base, id: 'stunts', name: 'Stunts', closed: false, pieces }))

/** Runs the car for up to `seconds`, stopping once `until` holds; returns every step's events. */
function drive(car: CarState, track: Track, seconds: number, input: (c: CarState) => Parameters<typeof stepCar>[1], until?: (c: CarState, ev: StepEvents) => boolean) {
    const events: StepEvents[] = []
    for (let i = 0; i < seconds * HZ; i++) {
        const ev = stepCar(car, input(car), track, 1 / HZ)
        events.push(ev)
        expect(Number.isFinite(car.x + car.y + car.z + car.speed)).toBe(true)
        if (until?.(car, ev)) break
    }
    return events
}
const coast = () => ({ throttle: 0, brake: 0, steer: 0, drift: false })
const floor = () => ({ throttle: 1, brake: 0, steer: 0, drift: false })

describe('stunt geometry', () => {
    it('keeps rails and gaps on the right stretch when a loop is rotated to its start line', () => {
        const t = new Track(buildTrack({
            ...base, group: 'circuits', id: 'loop', name: 'Loop', pieces: [
                // Out up the left side, back down through a looping that steps 30 m out, and wider bends home.
                straight(100), corner('right', 40), corner('right', 40), straight(100), looping('left', 22), straight(70),
                corner('right', 55), corner('right', 55), start, straight(50)
            ]
        }))
        expect(t.rails).toHaveLength(1)
        const [a, b] = t.rails[0]!
        expect(t.railAt((a + b) / 2)).toBe(true)
        expect(t.frameAt((a + b) / 2).uy).toBeLessThan(-0.95)
        expect(t.railAt(0)).toBe(false)
    })
})

describe('stunt physics', () => {
    it('rides a looping on rails and comes out the far side', () => {
        const t = sprint([straight(30), start, straight(400), looping('right', 22), straight(150), finish, straight(100)])
        const [, end] = t.rails[0]!
        const car = createCar(t, t.startS)
        let rode = false
        let last = car.travel
        let sharpest = 0
        drive(car, t, 30, floor, (c) => {
            if (c.onRail) rode = true
            // The plan turns back on itself at the top; the car's bearing mustn't.
            sharpest = Math.max(sharpest, Math.abs(wrapAngle(c.travel - last)))
            last = c.travel
            return c.proj.s > end + 20
        })
        expect(rode).toBe(true)
        expect(sharpest).toBeLessThan(0.05)
        expect(car.proj.s).toBeGreaterThan(end)
        expect(car.onRail).toBe(false)
    })

    it('rolls back down a looping when too slow to get round', () => {
        const t = sprint([straight(30), start, straight(100), looping('right', 22), straight(100), finish, straight(100)])
        const [entry] = t.rails[0]!
        const car = createCar(t, entry - 2)
        car.speed = 15
        let rode = false
        drive(car, t, 15, coast, (c) => {
            if (c.onRail) rode = true
            return rode && !c.onRail
        })
        expect(rode).toBe(true)
        expect(car.onRail).toBe(false)
        expect(car.speed).toBeLessThan(0)
        expect(car.proj.s).toBeLessThan(entry)
    })

    it('flies a gap at speed and lands on the far side', () => {
        const t = sprint([straight(30), start, straight(400), jump(4, 30), straight(200), finish, straight(100)])
        const [, gapEnd] = t.gaps[0]!
        const car = createCar(t, t.startS)
        const events = drive(car, t, 30, floor, c => c.proj.s > gapEnd + 150)
        expect(events.some(e => e.tookOff)).toBe(true)
        expect(events.some(e => e.landed > 0)).toBe(true)
        expect(events.some(e => e.fell)).toBe(false)
        expect(car.airborne).toBe(false)
    })

    it('drops a car too slow for the gap into it', () => {
        const t = sprint([straight(30), start, straight(100), jump(4, 30), straight(200), finish, straight(100)])
        const [gapStart] = t.gaps[0]!
        const car = createCar(t, gapStart - 2)
        car.speed = 8
        const events = drive(car, t, 10, coast, (_, ev) => ev.fell)
        expect(events.at(-1)!.fell).toBe(true)
    })
})
