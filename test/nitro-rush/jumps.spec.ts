import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botLapTime } from '../../app/utils/nitro-rush/medals'
import { createCar, crossesLines, stepCar, type CarState } from '../../app/utils/nitro-rush/physics'
import { drive, driveFlatOut, trackOf } from './bot-lap'
import { nextSection, type Construction } from '#shared/utils/nitro-rush/construct'
import { compileCustomTrack, draftTrackDef, lastPieceWalk, sectionFault, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { finishLoop } from '#shared/utils/nitro-rush/finish-loop'
import { GHOST_POSE, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { clearanceFault } from '#shared/utils/nitro-rush/road-checks'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { SPEED_CEILING, Track, wallFoot } from '#shared/utils/nitro-rush/track'
import { at, Path, rectangleLoop, sAt, straightSprint } from './fork-courses'

const DT = 1 / PHYSICS_HZ
const COAST = { throttle: 0, brake: 0, steer: 0, drift: false }
const course = (closed: boolean, sections: SectionId[]): CustomTrack => ({ id: 'custom-test', name: 'Test', closed, sections })
const sprint = (...sections: SectionId[]): SectionId[] => ['straight-20', 'start', 'straight-100', ...sections, 'straight-200', 'finish', 'straight-200']
const FLAT = { bank: 0, grade: 0 }

describe('jump sections', () => {
    it('lay the same road as the old jump piece', () => {
        const old = compileCustomTrack(course(false, sprint('jump'))).def!
        const split = compileCustomTrack(course(false, sprint('jump-ramp', 'empty-10', 'empty-20', 'landing-ramp'))).def!
        expect(split.points).toEqual(old.points)
        expect(split.heights).toEqual(old.heights)
        expect(split.gaps).toEqual(old.gaps)
    })

    it('carry the jump in the air from the ramp to the landing', () => {
        const walk = walkCustomTrack(course(false, ['straight-20', 'jump-ramp-big', 'empty-60', 'empty-100', 'landing-ramp', 'straight-20']))
        expect(walk.states.map(s => s.air)).toEqual([0, 0, 6, 6, 6, 0])
        expect(walk.gaps).toHaveLength(1)
        expect(walk.ys[walk.gaps[0]![0]]).toBe(6)
        expect(walk.end.y).toBe(0)
    })

    it('only let empty road and a landing ramp follow a jump ramp', () => {
        const air = { ...FLAT, air: 4 }
        expect(sectionFault('empty-20', air)).toBeNull()
        expect(sectionFault('landing-ramp', air)).toBeNull()
        for (const id of ['straight-20', 'left-tight', 'jump-ramp', 'checkpoint', 'width-wide'] as SectionId[]) expect(sectionFault(id, air)).toMatch(/can follow a jump ramp/)
        expect(sectionFault('empty-20', { ...FLAT, air: 0 })).toMatch(/needs a jump ramp before it/)
        expect(sectionFault('landing-ramp', { ...FLAT, air: 0 })).toMatch(/needs a jump ramp before it/)
        expect(sectionFault('jump-ramp', { bank: 0, grade: 0.1, air: 0 })).toMatch(/a jump ramp needs flat, unbanked road/)
    })

    it('make a course that never lands no course', () => {
        expect(compileCustomTrack(course(false, ['straight-20', 'start', 'straight-100', 'finish', 'straight-200', 'jump-ramp', 'empty-60'])).error).toMatch(/land the jump before the road ends/)
        expect(compileCustomTrack(course(false, sprint('jump-ramp', 'straight-20', 'landing-ramp'))).error).toMatch(/can follow a jump ramp/)
    })

    it('build empty road from a straight while in the air', () => {
        const choice: Construction = { curve: 'straight', size: 'medium', length: 60, slope: 'slope-flat', bank: 'bank-flat', width: 'width-normal' }
        expect(nextSection(choice, { ...FLAT, halfWidth: 9, air: 4 })).toBe('empty-60')
        expect(nextSection(choice, { ...FLAT, halfWidth: 9, air: 0 })).toBe('straight-60')
    })

    it('finish a loop by landing the jump first', () => {
        const t = course(true, ['start', 'straight-100', 'jump-ramp', 'empty-20'])
        const { sections, error } = finishLoop(t)
        expect(error).toBeNull()
        expect(sections![0]).toBe('landing-ramp')
        expect(compileCustomTrack({ ...t, sections: [...t.sections, ...sections!] }).error).toBeNull()
    })

    it('fly over road below without clashing with it', () => {
        // Back out of a wide hairpin and a turn, then a big jump straight over the first straight.
        const over = course(false, ['straight-20', 'start', 'straight-200', 'right-hairpin-wide', 'straight-100', 'right-tight', 'jump-ramp-big', 'empty-100', 'landing-ramp', 'straight-100', 'finish', 'straight-200'])
        expect(compileCustomTrack(over).error).toBeNull()
    })

    it('let the bot drive them, and the server take its lap', () => {
        const track = trackOf(false, sprint('jump-ramp', 'empty-20', 'empty-10', 'landing-ramp', 'straight-100', 'jump-ramp-big', 'empty-60', 'landing-ramp'))
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
    })

    it('count a line the car flies over along the road', () => {
        // The bot lands past the finish line.
        const track = trackOf(false, ['straight-20', 'start', 'straight-100', 'jump-ramp', 'empty-20', 'landing-ramp', 'straight-10', 'finish', 'straight-200'])
        expect(botLapTime(track)).not.toBeNull()
        expect(ghostDrivesTrack(track, drive(track))).toBe(true)
    })

    it('need room under road above empty road, but not over road below it', () => {
        expect(clearanceFault(crossing(3), false)).toMatch(/passes 3.0 m from another stretch/)
        expect(clearanceFault(crossing(-3), false)).toBeNull()
        expect(clearanceFault(crossing(8), false)).toBeNull()
    })

    it('preview an empty piece as empty road', () => {
        const walk = walkCustomTrack(course(false, ['straight-20', 'jump-ramp', 'empty-20']))
        const piece = lastPieceWalk(walk)
        expect(piece.gaps).toEqual([[0, piece.pts.length]])
        expect(draftTrackDef(piece, false)!.gaps).toEqual([[0, piece.pts.length]])
        expect(lastPieceWalk(walkCustomTrack(course(false, ['straight-20', 'jump-ramp', 'empty-20', 'landing-ramp']))).gaps).toEqual([])
    })
})

/** A road east at height 0 with empty road where it's crossed, then round and back south across it at height `h`. */
function crossing(h: number) {
    const pts: [number, number][] = []
    const ys: number[] = []
    const line = (x0: number, z0: number, x1: number, z1: number, y: number) => {
        const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 2)
        for (let i = 0; i < n; i++) {
            pts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n])
            ys.push(y)
        }
    }
    line(0, 0, 200, 0, 0)
    line(200, 0, 200, 100, h)
    line(200, 100, 100, 100, h)
    line(100, 100, 100, -100, h)
    return { pts, ys, lifts: ys.map(() => 0), walls: ys.map(() => 10), gaps: [[30, 70]] as [number, number][] }
}

describe('flying over the walls', () => {
    // Road A runs up the screen; a hairpin brings road B back down beside it, 60 m to the right.
    const track = trackOf(false, ['straight-20', 'start', 'straight-200', 'right-hairpin', 'straight-200', 'finish', 'straight-200'])
    const B = track.def.runUp! + 10 + 200 + Math.PI * 30
    /** A car in the air above road A at `s`, `lateral` across it, turned `angle` to the right of the road. */
    const launched = (s: number, lateral: number, angle: number, speed: number, y: number, vy: number): CarState => {
        const car = createCar(track, s, lateral)
        car.heading = car.travel = car.heading - angle
        car.speed = speed
        car.airborne = true
        car.y = y
        car.vy = vy
        return car
    }

    it('carries a car high enough over the wall and onto other road', () => {
        const car = launched(track.def.runUp! + 60, 8, 0.6, 55, 3, 6)
        let fell = false
        for (let i = 0; i < PHYSICS_HZ * 4 && car.airborne; i++) fell ||= stepCar(car, COAST, track, DT).fell
        expect(fell).toBe(false)
        expect(car.airborne).toBe(false)
        expect(car.proj.s).toBeGreaterThan(B)
        expect(Math.abs(car.proj.lateral)).toBeLessThanOrEqual(wallFoot(track.wallAt(car.proj.s)))
    })

    it('still stops a car in the air lower than the wall', () => {
        const car = launched(track.def.runUp! + 60, 8, 0.6, 30, 0.3, 0)
        let hit = false
        for (let i = 0; i < PHYSICS_HZ; i++) {
            hit ||= stepCar(car, COAST, track, DT).wallImpact > 0
            expect(Math.abs(car.proj.lateral)).toBeLessThanOrEqual(track.wallAt(car.proj.s) + 1e-6)
        }
        expect(hit).toBe(true)
    })

    it('drops a car that misses all road to the ground, where it falls', () => {
        const car = launched(track.def.runUp! + 60, -8, -1.2, 30, 3, 4)
        let fell = false
        for (let i = 0; i < PHYSICS_HZ * 3 && !fell; i++) fell = stepCar(car, COAST, track, DT).fell
        expect(fell).toBe(true)
        expect(car.y).toBeLessThan(0)
    })

    it('counts lines in the air only over the road', () => {
        const over = launched(track.def.runUp! + 60, 8, 0, 55, 3, 0)
        expect(crossesLines(over, track)).toBe(true)
        const beside = launched(track.def.runUp! + 60, 8, 0, 55, 3, 0)
        beside.proj.lateral = wallFoot(track.wallAt(beside.proj.s)) + 2
        expect(crossesLines(beside, track)).toBe(false)
    })

    it('flies a real ghost of a car over the wall only off a kicker', () => {
        const jumpy = trackOf(false, sprint('jump-ramp-big', 'empty-60', 'landing-ramp'))
        const run = driveFlatOut(jumpy, 60)
        // Lifted mid-flight, as if the car hovered: higher than any kicker throws it.
        const data = run.data.slice()
        for (let k = 0; k < data.length / GHOST_POSE; k++) if (data[k * GHOST_POSE + 1]! > 6.5) data[k * GHOST_POSE + 1]! += 8
        expect(ghostDrivesTrack(jumpy, run)).toBe(true)
        expect(ghostDrivesTrack(jumpy, { ...run, data })).toBe(false)
    })
})

describe('mandatory checkpoints', () => {
    const L = 1000
    /** Where the car is `s` metres on from the start line. */
    const spot = (track: Track, s: number) => at(track, track.wrapS(track.startS + s))
    /** Drives from `from` to `to` in steps of `ds` metres, 0.1 s apart. */
    const drive = (track: Track, timer: LapTimer, from: number, to: number, ds = 10) => {
        const events = []
        for (let s = from + ds; s <= to; s += ds) events.push(...timer.update(...spot(track, s), 0.1))
        return events
    }
    const timerAt = (track: Track, s: number) => new LapTimer(track, ...spot(track, s))
    /** A respawn `by` metres back along the road from `from`, as the engine puts it: whatever the car crossed since `since` is taken back. */
    const respawn = (track: Track, timer: LapTimer, from: number, by: number, since = timer.clock) => {
        const to = track.back(0, track.wrapS(track.startS + from), by)
        timer.rewind(since, to.legs, ...at(track, to.s))
    }

    it('leaves a lap open when a flight skips a checkpoint, until the car drives across it', () => {
        const track = rectangleLoop([500])
        const timer = timerAt(track, 0)
        drive(track, timer, 0, 300)
        // Landing past the checkpoint crosses nothing.
        expect(timer.update(...spot(track, 700), 0.1, false)).toEqual([])
        expect(drive(track, timer, 700, 1000)).toEqual([])
        expect(timer.lap).toBe(0)
        // Round again, through the checkpoint this time.
        expect(drive(track, timer, 0, 1000).map(e => e.type)).toEqual(['split', 'lap'])
    })

    it('counts a flight that skips no line', () => {
        const track = rectangleLoop([800])
        const timer = timerAt(track, 0)
        drive(track, timer, 0, 300)
        timer.update(...spot(track, 600), 0.1, false)
        expect(drive(track, timer, 600, 1000).map(e => e.type)).toEqual(['split', 'lap'])
    })

    it('ends a sprint only through every checkpoint', () => {
        const track = straightSprint(620, [200, 400])
        const timer = timerAt(track, -14)
        drive(track, timer, -14, 250)
        timer.update(...spot(track, 450), 0.1, false)
        expect(drive(track, timer, 450, 700)).toEqual([])
        expect(timer.finished).toBe(false)
    })

    it('takes back a checkpoint the car backs over, so a U-turn over the line is no lap', () => {
        const track = rectangleLoop([200])
        const timer = timerAt(track, -14)
        expect(drive(track, timer, -14, 216, 2).map(e => e.type)).toEqual(['split'])
        const events = []
        for (let s = 216; s > -24; s -= 2) events.push(...timer.update(...spot(track, s), 0.05))
        events.push(...drive(track, timer, -24, 10, 2))
        expect(events).toEqual([])
        expect(drive(track, timer, 10, 1000).map(e => e.type)).toEqual(['split', 'lap'])
    })

    it('takes back a checkpoint a respawn puts the car behind, and counts it again', () => {
        const track = rectangleLoop([500])
        const timer = timerAt(track, 0)
        expect(drive(track, timer, 0, 520).map(e => e.type)).toEqual(['split'])
        respawn(track, timer, 520, 120)
        expect(timer.touched).toEqual([])
        expect(drive(track, timer, 400, 1000).map(e => e.type)).toEqual(['split', 'lap'])
    })

    it('owes the line again when a flight over it ends in a fall', () => {
        const track = rectangleLoop()
        const timer = timerAt(track, -14)
        drive(track, timer, -14, 980)
        // Off the lip at 980, over the line in the air, then down off the road at 1030.
        const tookOff = timer.clock
        expect(drive(track, timer, 980, 1030).map(e => e.type)).toEqual(['lap'])
        respawn(track, timer, 980, 120, tookOff)
        expect(drive(track, timer, 860, 1100)).toEqual([])
        expect(drive(track, timer, 1100, 2000).map(e => e.type)).toEqual(['lap'])
    })

    it('counts nothing on a jump to other road, even over it', () => {
        const track = rectangleLoop([500])
        const timer = timerAt(track, 0)
        drive(track, timer, 0, 300)
        expect(timer.update(...spot(track, 700), 0.1, true)).toEqual([])
        expect(drive(track, timer, 700, 1000)).toEqual([])
    })

    it('owes the line again after a respawn puts the car back over it', () => {
        const track = rectangleLoop()
        const timer = timerAt(track, 0)
        drive(track, timer, 0, 30)
        respawn(track, timer, 30, 120)
        expect(drive(track, timer, 910, 1100).filter(e => e.type === 'lap')).toEqual([])
    })

    it('runs on rectangle laps of exactly L', () => {
        expect(rectangleLoop().length).toBeCloseTo(L, 9)
    })
})

describe('the server check on a course with jumps', () => {
    const HZ = 15
    /** A ghost through `points`, `HZ` a second. */
    const ghostOf = (points: (readonly [number, number, number])[]): Ghost => {
        const data = new Float32Array(points.length * GHOST_POSE)
        points.forEach((p, k) => {
            data.set(p, k * GHOST_POSE)
            data[k * GHOST_POSE + 6] = 1
        })
        return { hz: HZ, end: (points.length - 1) / HZ, data }
    }
    /** On the centreline at `s`, level with the lip over a gap, `lateral` to the right and `lift` above. */
    const at = (track: Track, s: number, lateral = 0, lift = 0) => {
        const p = track.pointAt(s)
        return [p.x - p.tz * lateral, p.y + lift, p.z + p.tx * lateral] as const
    }
    /** Poses down the road from the grid to just past the finish, at `speed(s)` metres a second, placed by `place`. */
    const run = (track: Track, speed: (s: number) => number, place = (s: number) => at(track, s), stop = track.finishS) => {
        const out: (readonly [number, number, number])[] = []
        let s = track.startS - 14
        for (;;) {
            out.push(place(s))
            if (s >= stop) return out
            s += speed(s) / HZ
        }
    }
    const jumpy = trackOf(false, sprint('jump-ramp', 'empty-20', 'landing-ramp'))
    const [lip, foot] = jumpy.gaps[0]!

    it('takes a run that stops a hair short of the finish line', () => {
        expect(ghostDrivesTrack(jumpy, ghostOf(run(jumpy, () => 80)))).toBe(true)
        const short = run(jumpy, () => 80)
        short[short.length - 1] = at(jumpy, jumpy.finishS - 0.05)
        expect(ghostDrivesTrack(jumpy, ghostOf(short))).toBe(true)
        expect(ghostDrivesTrack(jumpy, ghostOf(run(jumpy, () => 80, s => at(jumpy, s), jumpy.finishS - 30)))).toBe(false)
    })

    it('takes a real lap whose last pose stops a hair short of the finish line', () => {
        const g = drive(jumpy)
        const data = g.data.slice()
        const i = data.length - GHOST_POSE
        const p = i - GHOST_POSE
        const len = Math.hypot(data[i]! - data[p]!, data[i + 2]! - data[p + 2]!)
        data[i] = data[i]! - (data[i]! - data[p]!) / len * 0.05
        data[i + 2] = data[i + 2]! - (data[i + 2]! - data[p + 2]!) / len * 0.05
        expect(ghostDrivesTrack(jumpy, { ...g, data })).toBe(true)
    })

    it('fails a flight faster than the car', () => {
        expect(ghostDrivesTrack(jumpy, ghostOf(run(jumpy, s => s > lip && s < foot ? 140 : 80)))).toBe(false)
    })

    it('fails a flight that leaves the road anywhere but a lip', () => {
        const from = foot + 80
        const hop = (s: number) => {
            const f = (s - from) / 120
            return f > 0 && f < 1 ? at(jumpy, s, 20 * Math.sin(Math.PI * f), 2 * Math.sin(Math.PI * f)) : at(jumpy, s)
        }
        expect(ghostDrivesTrack(jumpy, ghostOf(run(jumpy, () => 80, hop)))).toBe(false)
    })

    it('fails a hop across to other road', () => {
        // A jump early on, then a hairpin brings road B back beside road A.
        const track = trackOf(false, ['straight-20', 'start', 'straight-60', 'jump-ramp', 'empty-20', 'landing-ramp', 'straight-200', 'right-hairpin', 'straight-200', 'finish', 'straight-200'])
        expect(ghostDrivesTrack(track, ghostOf(run(track, () => 60)))).toBe(true)
        const a = track.gaps[0]![1] + 120
        const [ax, , az] = at(track, a)
        let b = a + 100
        for (let s = b; s < track.finishS; s += 0.5) {
            const [x, , z] = at(track, s)
            const [bx, , bz] = at(track, b)
            if (Math.hypot(x - ax, z - az) < Math.hypot(bx - ax, bz - az)) b = s
        }
        const before = run(track, () => 60, s => at(track, s), a)
        const after = run(track, () => 60).filter((_, k, all) => k > 0 && track.project(all[k]![0], all[k]![2], -1, undefined, all[k]![1]).s > b)
        const [bx, by, bz] = at(track, b)
        const across = Array.from({ length: 7 }, (_, k) => [ax + (bx - ax) * (k + 1) / 8, by, az + (bz - az) * (k + 1) / 8] as const)
        expect(ghostDrivesTrack(track, ghostOf([...before, ...across, ...after]))).toBe(false)
    })

    it('floors a loop with a jump at its best real skip, not a flight back over the start line', () => {
        const sections: SectionId[] = ['start', 'straight-200', 'jump-ramp', 'empty-20', 'landing-ramp', 'straight-100']
        const track = trackOf(true, [...sections, ...finishLoop(course(true, sections)).sections!])
        // Flying back off the landing ramp over the line priced it at 580 m; the best real way is a hop off the lip onto the road coming back 60 m across.
        const [lip] = track.gaps[0]!
        const foot = wallFoot(track.walls[0]!)
        const hop = lip + Math.hypot(60, foot) - foot + track.length - track.project(-60, track.pointAt(lip).z + foot).s
        expect(track.minLapSeconds * SPEED_CEILING).toBeGreaterThan(hop - 1)
        expect(track.minLapSeconds * SPEED_CEILING).toBeLessThan(hop + 3)
        expect(botLapTime(track)!).toBeGreaterThan(track.minLapSeconds)
    })

    it('floors a sprint at a skip onto road ahead of the lip, though the checkpoint it then drives over is behind it', () => {
        // Off the lip 130 m up, a U-turn brings the road back down beside it, over a checkpoint and to the finish.
        const { pts } = new Path(0, 0).straight(230).arc(1, 40, Math.PI).straight(550)
        const track = new Track({ id: 'u-turn', name: 'U-turn', group: 'sprints', points: pts, halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 30, runOff: 150, gaps: [[65, 75]], checkpoints: [sAt(pts, 80, 50)] })
        // 100 m to the lip, a flight onto the near edge of the road back just ahead of it, then 120 m from the checkpoint to the finish.
        const foot = wallFoot(10.6)
        const skip = 100 + Math.hypot(80, foot) - foot + 50 + 130 - foot + 120
        expect(track.minLapSeconds * SPEED_CEILING).toBeGreaterThan(skip - 1)
        expect(track.minLapSeconds * SPEED_CEILING).toBeLessThan(skip + 3)
        expect(track.minLapSeconds * SPEED_CEILING).toBeLessThan(track.lapLength - 200)
    })

    it('checks a long lap without scanning the whole course for every pose', () => {
        const sections: SectionId[] = ['straight-20', 'start', 'jump-ramp', 'empty-20', 'landing-ramp']
        for (let k = 0; sections.length < 76; k++) sections.push('straight-200', k % 2 ? 'left-eighth' : 'right-eighth')
        const long = trackOf(false, [...sections, 'finish', 'straight-200'])
        const parked = Array.from({ length: 299 * 60 + 1 }, () => at(long, long.startS))
        const t0 = performance.now()
        expect(ghostDrivesTrack(long, { ...ghostOf(parked), hz: 60 })).toBe(false)
        expect(performance.now() - t0).toBeLessThan(300)
    })
})
