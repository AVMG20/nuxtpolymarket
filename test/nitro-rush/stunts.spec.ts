import { describe, expect, it } from 'vitest'
import { buildTrack, corkscrew, corner, finish, jump, looping, LOOPING_SHIFT, start, straight, type TrackLayout } from '#shared/utils/nitro-rush/layout'
import { Track, wrapAngle } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'
import { botInput, createCar, stepCar, type CarState, type StepEvents } from '../../app/utils/nitro-rush/physics'

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
    it('leaves the courses from before stunts without frames, rails or gaps', () => {
        for (const t of TRACKS) {
            expect(t.ups).toBeUndefined()
            expect(t.rails).toBeUndefined()
            expect(t.gaps).toBeUndefined()
        }
    })

    it('keeps plain road on the plan: right is the plan right, up is straight up', () => {
        const t = new Track(TRACKS[0]!)
        for (const s of [0, 100, 400]) {
            const f = t.frameAt(s)
            const p = t.pointAt(s)
            expect(f.uy).toBeCloseTo(1)
            expect(f.ry).toBeCloseTo(0)
            expect(f.rx * p.tx + f.rz * p.tz).toBeCloseTo(0, 1)
        }
    })

    it('turns a looping upside down at the top and brings it out to the side', () => {
        const t = sprint([straight(30), start, straight(100), looping('right', 22), straight(100), finish, straight(100)])
        const [a, b] = t.rails[0]!
        const top = t.frameAt((a + b) / 2)
        expect(top.uy).toBeLessThan(-0.95)
        expect(top.y).toBeCloseTo(44, 0)
        const before = t.frameAt(a - 1)
        const after = t.frameAt(b + 1)
        expect(after.x - before.x).toBeCloseTo(LOOPING_SHIFT, 0)
    })

    it('rolls a corkscrew over halfway through', () => {
        const t = sprint([straight(30), start, straight(100), corkscrew('left', 200), straight(100), finish, straight(100)])
        const [a, b] = t.rails[0]!
        expect(t.frameAt((a + b) / 2).uy).toBeLessThan(-0.95)
    })

    it('tips a banked corner into the turn', () => {
        const t = sprint([straight(30), start, straight(100), corner('right', 60, 90, 25), straight(100), finish, straight(100)])
        const mid = t.length / 2
        let tilted = false
        for (let s = 0; s < t.length; s += 4) {
            const f = t.frameAt(s)
            // A right turn's centre is to the right: up leans that way.
            if (f.ux * f.rx + f.uz * f.rz > 0.3) tilted = true
        }
        expect(tilted).toBe(true)
        expect(t.frameAt(mid - 300).uy).toBeCloseTo(1)
    })

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
    it('never flies or rides rails on the courses from before stunts', () => {
        for (const def of TRACKS) {
            const t = new Track(def)
            const car = createCar(t, t.startS)
            drive(car, t, 25, c => botInput(c, t), c => {
                expect(c.airborne).toBe(false)
                expect(c.onRail).toBe(false)
                return false
            })
        }
    }, 60_000)

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
