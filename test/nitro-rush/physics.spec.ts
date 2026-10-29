import { describe, expect, it } from 'vitest'
import { DRIFT_MIN_SPEED, ENGINE_TOP_SPEED, NITRO_DURATION, PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, createCar, fireNitro, slipAngle, stepCar, wallLimit, type CarInput } from '../../app/utils/nitro-rush/physics'
import { buildTrack, corner, LINE_BLOCK_LENGTH, ramp, start, straight } from '#shared/utils/nitro-rush/layout'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { Track, wrapAngle, type TrackDef } from '#shared/utils/nitro-rush/track'
import { POLYTOWN_OVAL, TRACKS } from '#shared/utils/nitro-rush/tracks'

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

        it('lets the wheel tighten or widen the line without ending the drift', () => {
            const slipAfter = (steer: number) => {
                const car = drifting()
                for (let i = 0; i < PHYSICS_HZ * 1.5; i++) stepCar(car, input({ throttle: 1, drift: true, steer }), open, DT)
                expect(car.drifting).toBe(true)
                return Math.abs(slipAngle(car))
            }
            const tight = slipAfter(-1)
            const middle = slipAfter(0)
            const wide = slipAfter(1)
            expect(tight).toBeGreaterThan(middle + 0.15)
            expect(middle).toBeGreaterThan(wide + 0.15)
            expect(wide).toBeGreaterThan(0.15)
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

describe('registered tracks', () => {
    it.each(TRACKS.map(def => [def.name, new Track(def)] as const))('the demo bot drives %s cleanly, splitting at every checkpoint', (_, t) => {
        const car = createCar(t, t.startS - 14)
        const timer = new LapTimer(t.lapLength, t.closed, -14, t.checkpointDistances)
        const events: LapEvent[] = []
        let hits = 0
        let lastY = car.proj.y
        let levelJumps = 0
        for (let i = 0; i < PHYSICS_HZ * 150 && timer.lap < 2; i++) {
            if (stepCar(car, botInput(car, t), t, DT).wallImpact > 0) hits++
            events.push(...timer.update(t.closed ? car.proj.s : car.proj.s - t.startS, DT))
            // Where the road stacks, the car stays on its own level.
            if (Math.abs(car.proj.y - lastY) > 0.2) levelJumps++
            lastY = car.proj.y
        }
        expect(levelJumps).toBe(0)
        // Past an open course's finish the bot brakes; let it pull up before the end barrier.
        for (let i = 0; !t.closed && i < PHYSICS_HZ * 10; i++) stepCar(car, botInput(car, t), t, DT)
        expect(hits).toBe(0)
        const laps = events.filter(e => e.type === 'lap')
        expect(laps).toHaveLength(t.closed ? 2 : 1)
        expect(events.filter(e => e.type === 'split')).toHaveLength(laps.length * t.checkpoints.length)
        if (!t.closed) {
            expect(car.speed).toBeLessThan(1)
            expect(car.proj.s).toBeLessThan(t.length)
        }
    })
})

describe('a keyboard drift round a spiral', () => {
    const helix = new Track(TRACKS.find(d => d.id === 'twin-helix')!)
    // The first spiral is the first long stretch of constant tight curvature.
    const from = helix.cum[helix.curvature.findIndex(k => Math.abs(k - 1 / 36) < 0.004)]!
    const length = Math.PI / 2 * 36 * 5

    it('holds one drift all the way round with the button held, tapping the line tighter or wider a few times a second at most', () => {
        const car = createCar(helix, from - 60)
        car.speed = 30
        let key = 0
        let since = Infinity
        let hits = 0
        let started = false
        for (let i = 0; i < PHYSICS_HZ * 20 && car.proj.s < from + length; i++) {
            const tan = Math.atan2(-car.proj.tx, -car.proj.tz)
            let steer: number
            let throttle = 1
            if (car.proj.s < from - 4) {
                steer = Math.max(-1, Math.min(1, -(wrapAngle(tan - car.travel) - car.proj.lateral * 0.04) * 3))
                throttle = car.speed < 30 ? 1 : 0
            } else if (!started) {
                started = stepCar(car, input({ throttle: 1, drift: true, steer: 1 }), helix, DT).driftStarted
                continue
            } else {
                // Tap in while the slide is too shallow for the line, away when too deep, otherwise centre the wheel; keys change at most every 0.3 s.
                const want = Math.max(0, car.speed / 36 + 2 * wrapAngle(car.travel - tan) - 0.025 * car.proj.lateral) / 1.5
                const slip = Math.abs(slipAngle(car))
                const next = slip < want - 0.02 ? 1 : slip > want + 0.15 ? -1 : 0
                since += DT
                if (next !== key && since >= 0.3) {
                    key = next
                    since = 0
                }
                steer = key
                expect(car.drifting).toBe(true)
            }
            if (stepCar(car, input({ throttle, steer, drift: started }), helix, DT).wallImpact > 0) hits++
        }
        expect(started).toBe(true)
        expect(car.proj.s).toBeGreaterThan(from + length)
        expect(car.drifting).toBe(true)
        expect(hits).toBe(0)
    })
})

describe('slopes', () => {
    /** A rounded square: a long flat straight, then a ramp up one side and down the next. */
    const hill = new Track(buildTrack({
        id: 'hill', name: 'Hill', group: 'circuits', halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 },
        pieces: [start, straight(280), corner('right', 50), ramp(300, 24), corner('right', 50), ramp(300, -24), corner('right', 50), straight(300), corner('right', 50)]
    }))
    const flatS = LINE_BLOCK_LENGTH / 2 + 60
    const upS = LINE_BLOCK_LENGTH / 2 + 280 + Math.PI * 25 + 100
    const downS = upS + 300 + Math.PI * 25
    /** Speed after coasting from 30 m/s for two seconds. */
    const coast = (s: number) => {
        const car = createCar(hill, s)
        car.speed = 30
        for (let i = 0; i < PHYSICS_HZ * 2; i++) stepCar(car, input(), hill, DT)
        return car.speed
    }

    it('slows a coasting car climbing and speeds it going down', () => {
        const flat = coast(flatS)
        expect(coast(upS)).toBeLessThan(flat - 1)
        expect(coast(downS)).toBeGreaterThan(flat + 1)
    })

    it('holds a car parked on the slope', () => {
        const car = createCar(hill, upS)
        for (let i = 0; i < PHYSICS_HZ * 2; i++) stepCar(car, input(), hill, DT)
        expect(car.speed).toBe(0)
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
