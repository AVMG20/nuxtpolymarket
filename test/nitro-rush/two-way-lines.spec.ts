import { describe, expect, it } from 'vitest'
import { compileCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { defaultFieldPlan, type FieldTile } from '#shared/utils/nitro-rush/field'
import { GRID_BACK } from '#shared/utils/nitro-rush/field-plan'
import { LapTimer, type LapEvent } from '#shared/utils/nitro-rush/timing'
import { SPEED_CEILING, Track, type LapLine } from '#shared/utils/nitro-rush/track'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { createCar, respawnCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { bestSplit } from '../../app/utils/nitro-rush/record'
import { RECTANGLE } from './bot-lap'
import { at, forkLoopDef, rectangleLoop, straightSprint } from './fork-courses'

/** Every checkpoint, start and finish counts whichever way it's driven through, and a loop can be lapped either way round. */

/** Steps along the main line from `from` to `to`, either way, `speed` metres a second in 1/PHYSICS_HZ s steps. */
function walk(track: Track, timer: LapTimer, from: number, to: number, speed = 40) {
    const events: LapEvent[] = []
    const step = speed / PHYSICS_HZ * Math.sign(to - from)
    const count = Math.floor((to - from) / step)
    for (let i = 1; i <= count; i++) {
        const p = track.pointAt(track.wrapS(from + step * i))
        events.push(...timer.update(p.x, p.y, p.z, 1 / PHYSICS_HZ))
    }
    return events
}

/** Steps a timer straight through `line`, `way` 1 along it and -1 back. */
function cross(timer: LapTimer, line: LapLine, way: 1 | -1) {
    const events: LapEvent[] = []
    for (let d = -10; d <= 10; d++) events.push(...timer.update(line.x + line.tx * d * way, line.y, line.z + line.tz * d * way, 1 / PHYSICS_HZ))
    return events
}

const laps = (events: LapEvent[]) => events.filter((e): e is Extract<LapEvent, { type: 'lap' }> => e.type === 'lap')

/** A timer for a car on a road loop's grid, a run-up behind the start. */
function onGrid(track: Track) {
    const [x, y, z] = at(track, track.startS - GRID_BACK)
    return new LapTimer(track, x, y, z)
}

const built = (t: CustomTrack) => {
    const { def, error } = compileCustomTrack(t)
    expect(error).toBeNull()
    return new Track(def!)
}
/** A loop round the rectangle whose start block and first 20 m are a 100 m field with `tiles` on it. */
const LOOP: SectionId[] = ['field', 'straight-20', ...RECTANGLE.slice(2)]
const fieldLoop = (tiles: FieldTile[]) => built({ id: 'custom-test', name: 'Test', closed: true, sections: LOOP, fields: [{ at: { branch: 0, at: 0 }, ...defaultFieldPlan(), tiles }] })

describe('a road loop lapped the other way round', () => {
    it('counts each lap, with every checkpoint touched backward', () => {
        const track = rectangleLoop([250, 750])
        const timer = onGrid(track)
        const L = track.length
        const first = walk(track, timer, track.startS - GRID_BACK, track.startS - L - 10)
        expect(laps(first)).toHaveLength(1)
        expect(laps(first)[0]).toMatchObject({ lap: 0, splits: [expect.any(Number), expect.any(Number)] })
        const second = walk(track, timer, track.startS - L - 10, track.startS - 2 * L - 10)
        expect(laps(second)).toHaveLength(1)
        expect(timer.lap).toBe(2)
    })

    it('still enforces a required checkpoint', () => {
        const def = forkLoopDef()
        def.branches![1]!.requiredCheckpoints = def.branches![1]!.checkpoints
        const track = new Track(def)
        const required = track.lapLines.find(l => l.required)!
        expect(track.requiredIds).toEqual([required.id])
        // The main line's own checkpoints make K, but skip the required one on the branch.
        const timer = onGrid(track)
        const missed = walk(track, timer, track.startS - GRID_BACK, track.startS - track.length - 10)
        expect(missed.filter(e => e.type !== 'split')).toEqual([{ type: 'missed', lap: 0, required: true }])
        const driven = onGrid(track)
        expect(cross(driven, required, -1)).toMatchObject([{ type: 'split', sector: required.id }])
        expect(laps(walk(track, driven, track.startS - GRID_BACK, track.startS - track.length - 10))).toHaveLength(1)
    })

    it('never takes less than the shortest lap, even from the grid at the speed ceiling', () => {
        const track = rectangleLoop([250, 750])
        const timer = onGrid(track)
        const [lap] = laps(walk(track, timer, track.startS - GRID_BACK, track.startS - track.length - 10, SPEED_CEILING))
        // Float slack only: the standing lap backward is exactly the grid's run-up short of a full round.
        expect(lap!.time).toBeGreaterThanOrEqual(track.minLapSeconds - 1e-6)
    })
})

describe('no lap for going back over the line', () => {
    it('counts no lap for a start crossed, a U-turn and a cross again on a loop with no checkpoint', () => {
        const track = rectangleLoop()
        const timer = onGrid(track)
        const s = track.startS
        expect(walk(track, timer, s - GRID_BACK, s + 20)).toEqual([])
        expect(walk(track, timer, s + 20, s - 20)).toEqual([])
        expect(walk(track, timer, s - 20, s + 20)).toEqual([])
        // Half way round and back is no lap either, whichever way the car comes back over the line.
        expect(walk(track, timer, s + 20, s + track.length / 2)).toEqual([])
        expect(walk(track, timer, s + track.length / 2, s - 20)).toEqual([])
        expect(laps(walk(track, timer, s - 20, s - track.length - 10))).toHaveLength(1)
    })

    it('counts no second lap for a U-turn back over the line just after one', () => {
        const track = rectangleLoop()
        const timer = onGrid(track)
        const s = track.startS
        expect(laps(walk(track, timer, s - GRID_BACK, s + track.length + 20))).toHaveLength(1)
        expect(walk(track, timer, s + track.length + 20, s + track.length - 20)).toEqual([])
        expect(walk(track, timer, s + track.length - 20, s + track.length + 20)).toEqual([])
    })

    it('counts no lap for circling or U-turning through a field start with no checkpoint', () => {
        const track = fieldLoop([{ col: 2, row: 2, kind: 'start', dir: 0 }])
        const start = track.lapLines[0]!
        const timer = new LapTimer(track, start.x - start.tx * GRID_BACK, start.y, start.z - start.tz * GRID_BACK)
        expect(cross(timer, start, 1)).toEqual([])
        expect(cross(timer, start, -1)).toEqual([])
        expect(cross(timer, start, 1)).toEqual([])
        // Off the field but short of the far side of the course, a U-turn back through it still ends no lap.
        const near = track.pointAt(track.length / 4)
        timer.update(near.x, near.y, near.z, 1 / PHYSICS_HZ)
        expect(cross(timer, start, -1)).toEqual([])
    })
})

describe('a field start', () => {
    it('ends a lap crossed backward, once the car has been round the course and through the checkpoint', () => {
        const track = fieldLoop([{ col: 2, row: 2, kind: 'start', dir: 0 }, { col: 4, row: 1, kind: 'checkpoint', dir: 0 }])
        const [start, gate] = [track.lapLines[0]!, track.lapLines.find(l => l.kind === 'checkpoint')!]
        const timer = new LapTimer(track, start.x - start.tx * GRID_BACK, start.y, start.z - start.tz * GRID_BACK)
        for (let lap = 0; lap < 2; lap++) {
            // Round the road the other way, from where it comes into the field to where it leaves.
            walk(track, timer, track.length - 60, 60)
            expect(cross(timer, gate, -1)).toMatchObject([{ type: 'split', sector: gate.id }])
            expect(laps(cross(timer, start, -1))).toMatchObject([{ lap }])
        }
    })
})

describe('a sprint finish', () => {
    it('ends the run crossed backward, once the checkpoints are touched', () => {
        const track = straightSprint(500, [250])
        const [x, y, z] = at(track, track.startS - 10)
        const timer = new LapTimer(track, x, y, z)
        expect(walk(track, timer, track.startS - 10, track.startS + 300)).toMatchObject([{ type: 'split' }])
        // Carried past the finish without driving it, then back over it.
        const past = track.pointAt(track.finishS + 30)
        expect(timer.update(past.x, past.y, past.z, 1 / PHYSICS_HZ, false)).toEqual([])
        expect(laps(walk(track, timer, track.finishS + 30, track.finishS - 10))).toHaveLength(1)
        expect(timer.finished).toBe(true)
    })

    it('misses crossed backward without the checkpoints', () => {
        const track = straightSprint(500, [250])
        const past = track.pointAt(track.finishS + 30)
        const timer = new LapTimer(track, past.x, past.y, past.z)
        expect(walk(track, timer, track.finishS + 30, track.finishS - 10)).toEqual([{ type: 'missed', lap: 0, required: false }])
        expect(timer.finished).toBe(false)
    })
})

describe('a respawn while driving a loop backward', () => {
    it('puts the car back the way it came and takes back the start it crossed', () => {
        const track = rectangleLoop()
        const timer = onGrid(track)
        const L = track.length
        expect(laps(walk(track, timer, track.startS - GRID_BACK, track.startS - L - 10))).toHaveLength(1)
        // Back the way it came is on along the road, over the start it just crossed backward.
        const to = track.forth(0, track.wrapS(track.startS - 10), 30)
        expect(to.s).toBeCloseTo(track.wrapS(track.startS + 20))
        const p = track.pointAt(to.s)
        timer.rewind(timer.clock, to.legs, p.x, p.y, p.z)
        expect(laps(walk(track, timer, track.startS + 20, track.startS - L - 10))).toHaveLength(1)
    })

    it('never counts being carried over the start as a crossing', () => {
        const track = rectangleLoop()
        const timer = onGrid(track)
        const L = track.length
        expect(laps(walk(track, timer, track.startS - GRID_BACK, track.startS + L - 10))).toHaveLength(0)
        // Put back on along the road, over the start it hasn't reached yet, then driven back over it.
        const to = track.forth(0, track.wrapS(track.startS - 10), 30)
        const p = track.pointAt(to.s)
        timer.rewind(timer.clock, to.legs, p.x, p.y, p.z)
        expect(laps(walk(track, timer, track.startS + 20, track.startS - 10))).toHaveLength(0)
        expect(laps(walk(track, timer, track.startS - 10, track.startS + L + 10))).toHaveLength(1)
    })

    it('puts the car back the way it was driving, not the way it was moving as it fell', () => {
        const track = rectangleLoop()
        const fallen = createCar(track, 300)
        fallen.leftS = 300
        fallen.speed = -20
        fallen.way = 10
        expect(respawnCar(track, fallen).car.proj.s).toBeLessThan(300)
        fallen.speed = 20
        fallen.way = -10
        const { car } = respawnCar(track, fallen)
        expect(car.proj.s).toBeGreaterThan(300)
        expect(Math.cos(car.heading - fallen.heading)).toBeCloseTo(-1)
    })

    it('learns the way the car drives from its travel along the road', () => {
        const track = rectangleLoop()
        const car = createCar(track, 300)
        car.speed = 30
        for (let i = 0; i < PHYSICS_HZ / 2; i++) stepCar(car, { throttle: 0, brake: 0, steer: 0, drift: false }, track, 1 / PHYSICS_HZ)
        expect(car.way).toBeGreaterThan(0)
    })
})

describe('a split against the best lap', () => {
    it('shows only where the best lap touched that checkpoint as many checkpoints in', () => {
        const best = [10, 20, 30]
        expect(bestSplit(best, 2, 0, 1)).toBe(10)
        expect(bestSplit(best, 2, 1, 2)).toBe(20)
        // Round the other way, the best lap's first checkpoint is this lap's second.
        expect(bestSplit(best, 2, 0, 2)).toBeNull()
        expect(bestSplit([null, 20, 30], 2, 0, 1)).toBeNull()
        expect(bestSplit([10, 30], 2, 0, 1)).toBeNull()
        expect(bestSplit(null, 2, 0, 1)).toBeNull()
    })
})
