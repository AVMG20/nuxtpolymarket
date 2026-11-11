import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botLapTime, medalRoutes, medalTimes, medalTimesFor } from '../../app/utils/nitro-rush/medals'
import { botInput, createCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { drive } from './bot-lap'
import { at, bridgeSprintDef, forkLoopDef, forkSprintDef, Path } from './fork-courses'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { GHOST_HZ, GHOST_POSE, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { LapTimer } from '#shared/utils/nitro-rush/timing'
import { MAX_ROUTES, newProjection, SPEED_CEILING, Track, TrackGraphError, type BranchDef, type RouteLeg, type TrackDef } from '#shared/utils/nitro-rush/track'

const DT = 1 / PHYSICS_HZ
const COAST = { throttle: 0, brake: 0, steer: 0, drift: false }
const loop = new Track(forkLoopDef())
const sprint = new Track(forkSprintDef())
const bridge = new Track(bridgeSprintDef())

/** The fork loop's main line with other `branches` hung off it. */
const withBranches = (branches: BranchDef[]): TrackDef => ({ ...forkLoopDef(), branches })

/** A side road off the main straight at `from` that steps 30 m left and back, rejoining it further up. */
function sideRoad(from: number): BranchDef {
    const p = new Path(0, -from).straight(2).shift(-1, 30)
    p.straight(10).shift(1, 30)
    return { points: p.pts, from: { branch: 0, at: from }, to: { branch: 0, at: -p.z } }
}

/** Drives the stretches of road in `legs` 5 m a step, 20 m/s faster than the clock: a lap the timer can read. */
function driveLegs(track: Track, timer: LapTimer, legs: readonly RouteLeg[], through = 10) {
    const events = []
    for (const [i, leg] of legs.entries()) {
        const to = leg.to + (i === legs.length - 1 ? through : 0)
        for (let s = leg.from; s <= to; s += 5) events.push(...timer.update(...at(track, s, leg.branch), 0.05))
    }
    return events
}

/** A ghost down the main line from `from` to `to` metres along it, `lateral` off the centreline, 4 m a pose. */
function mainLineGhost(track: Track, from: number, to: number, lateral = 0): Ghost {
    const spots: number[] = []
    for (let s = from; s < to; s += 4) spots.push(s)
    spots.push(to)
    const data = new Float32Array(spots.length * GHOST_POSE)
    spots.forEach((s, k) => {
        data.set(at(track, track.wrapS(s), 0, lateral), k * GHOST_POSE)
        data[k * GHOST_POSE + 6] = 1
    })
    return { hz: GHOST_HZ, end: (spots.length - 1) / GHOST_HZ, data }
}

describe('the fork graph', () => {
    it('finds every route, and K as the fewest checkpoints on any', () => {
        expect(loop.routes.map(r => r.legs.map(l => l.branch))).toEqual([[0], [0, 1, 0], [0, 1, 3, 0], [0, 1, 2, 1, 0], [0, 1, 2, 1, 3, 0]])
        expect(loop.routes.map(r => r.checkpoints)).toEqual([[0, 1], [1, 2], [1, 4], [1, 2, 3], [1, 3, 4]])
        expect(loop.checkpointCount).toBe(5)
        expect(loop.k).toBe(2)
        expect(sprint.routes.map(r => r.legs.map(l => l.branch))).toEqual([[0], [0, 1]])
        expect(sprint.k).toBe(2)
    })

    it('numbers the main line\'s checkpoints first, in order, as a course without forks does', () => {
        expect(loop.checkpointIds).toEqual([[0, 1], [2], [3], [4]])
    })

    it('labels progress from 0 at the start to 1 at every finish, rising along every route', () => {
        expect(loop.progressAt(0, 0)).toBe(0)
        expect(loop.progressAt(0, loop.length)).toBe(1)
        expect(sprint.progressAt(0, sprint.finishS)).toBe(1)
        expect(sprint.progressAt(1, sprint.branches[1]!.finishS)).toBe(1)
        expect(sprint.progressAt(1, sprint.branches[1]!.length)).toBe(1)
        expect(sprint.progressAt(0, 0)).toBe(0)
        for (const track of [loop, sprint]) {
            for (const route of track.routes) {
                let last = -1
                for (const leg of route.legs) {
                    for (let s = leg.from; s <= leg.to; s += 10) {
                        const p = track.progressAt(leg.branch, s)
                        expect(p).toBeGreaterThanOrEqual(last - 1e-9)
                        last = p
                    }
                }
            }
        }
    })

    it('opens the inner walls over each shared deck and puts a cushion at each nose and tail', () => {
        const main = loop.branches[0]!
        // Branch 1 leaves to the left at 40 m.
        expect(main.wallOn(60, -1)).toBe(Infinity)
        expect(main.wallOn(60, 1)).toBe(main.wallAt(60))
        expect(loop.branches[1]!.wallOn(10, 1)).toBe(Infinity)
        expect(loop.branches[1]!.wallOn(10, -1)).toBeCloseTo(10.6, 9)
        // Well past the nose both walls stand again.
        expect(main.wallOn(300, -1)).toBeCloseTo(10.6, 9)
        expect(loop.cushions).toHaveLength(6)
        expect(sprint.cushions).toHaveLength(1)
        // A branch end that meets other road has no barrier; a finish's does.
        expect(loop.branches[1]!.barrierStart).toBe(false)
        expect(loop.branches[1]!.barrierEnd).toBe(false)
        expect(sprint.branches[1]!.barrierEnd).toBe(true)
    })

    it('refuses a join upstream of its fork', () => {
        const p = new Path(0, -500).straight(2).arc(-1, 40, Math.PI / 2).arc(-1, 40, Math.PI / 2).straight(400).arc(-1, 40, Math.PI / 2).arc(-1, 40, Math.PI / 2).straight(2)
        expect(() => new Track(withBranches([{ points: p.pts, from: { branch: 0, at: 500 }, to: { branch: 0, at: -p.z } }]))).toThrow(/rejoin before its fork/)
    })

    it('refuses a finish on a loop, a join that misses its road, and too many routes', () => {
        const side = sideRoad(100)
        expect(() => new Track(withBranches([{ ...side, to: 'finish' }]))).toThrow(TrackGraphError)
        const off = { ...side, points: side.points.map(([x, z], i) => [i === side.points.length - 1 ? x - 1 : x, z] as [number, number]) }
        expect(() => new Track(withBranches([off]))).toThrow(/must end on the road it joins/)
        const four = [40, 240, 440, 640].map(sideRoad)
        expect(new Track(withBranches(four)).routes).toHaveLength(MAX_ROUTES)
        expect(() => new Track(withBranches([...four, sideRoad(840)]))).toThrow(/Too many routes \(16 max\)/)
    })

    it('leaves a course without forks a single route over its whole lap', () => {
        const plain = new Track({ ...forkLoopDef(), branches: undefined })
        expect(plain.routes).toHaveLength(1)
        expect(plain.routes[0]!.legs).toEqual([{ branch: 0, from: 0, to: plain.length }])
        expect(plain.k).toBe(2)
        expect(plain.minLapSeconds).toBe(plain.lapLength / SPEED_CEILING)
    })
})

describe('driving through a fork', () => {
    it('changes branch once on the way through, never back and forth', () => {
        const car = createCar(loop, -14 + loop.length)
        car.proj.s = loop.wrapS(car.proj.s)
        const runs: { branch: number, steps: number }[] = []
        for (let i = 0; i < PHYSICS_HZ * 25; i++) {
            stepCar(car, botInput(car, loop, 1, loop.routes[1]!), loop, DT)
            const last = runs[runs.length - 1]
            if (last?.branch === car.proj.branch) last.steps++
            else runs.push({ branch: car.proj.branch, steps: 1 })
        }
        expect(runs.map(r => r.branch)).toEqual([0, 1, 0])
    })

    it('holds a car driving the shared deck on one road at a time, with no flicker as it parts', () => {
        const car = createCar(loop, 45, -9)
        car.speed = 30
        const runs: { branch: number, steps: number }[] = []
        for (let i = 0; i < PHYSICS_HZ * 3; i++) {
            car.speed = 30
            stepCar(car, COAST, loop, DT)
            const last = runs[runs.length - 1]
            if (last?.branch === car.proj.branch) last.steps++
            else runs.push({ branch: car.proj.branch, steps: 1 })
        }
        expect(runs.length).toBeLessThanOrEqual(3)
        for (const r of runs.slice(0, -1)) expect(r.steps).toBeGreaterThan(20)
        expect(runs[runs.length - 1]!.branch).toBe(0)
    })

    it('stops a car driven head on into the nose, like any wall', () => {
        const nose = loop.cushions[0]!
        const car = createCar(loop, -nose.z - 15, nose.x)
        car.speed = 25
        let hit = 0
        let nearest = Infinity
        for (let i = 0; i < PHYSICS_HZ * 2; i++) {
            hit = Math.max(hit, stepCar(car, COAST, loop, DT).wallImpact)
            nearest = Math.min(nearest, Math.hypot(car.x - nose.x, car.z - nose.z))
        }
        expect(hit).toBeGreaterThan(10)
        expect(nearest).toBeGreaterThan(0.9)
    })

    it('keeps a car on its own road under a bridge, and lands one from above on the bridge', () => {
        const z = -416.85
        const out = newProjection()
        expect(bridge.locate(0, z, 0, -1, out, 12).branch).toBe(1)
        expect(bridge.locate(0, z, 0, -1, out, 0).branch).toBe(0)
        expect(bridge.landing(0, 13, z, out) && out.branch).toBe(1)
        expect(out.y).toBeCloseTo(12, 3)
        expect(bridge.landing(0, 6, z, out) && out.branch).toBe(0)
        for (const [r, branches] of [[0, [0]], [1, [0, 1]]] as const) {
            const car = createCar(bridge, bridge.startS - 14)
            const seen: number[] = []
            for (let i = 0; i < PHYSICS_HZ * 20; i++) {
                stepCar(car, botInput(car, bridge, 1, bridge.routes[r]!), bridge, DT)
                if (seen[seen.length - 1] !== car.proj.branch) seen.push(car.proj.branch)
            }
            expect(seen).toEqual(branches)
        }
    })
})

describe('laps on a forked course', () => {
    it('closes a lap on every route once K checkpoints are touched, with splits by checkpoint id', () => {
        loop.routes.forEach((route) => {
            const timer = new LapTimer(loop, ...at(loop, 0))
            const laps = driveLegs(loop, timer, route.legs).filter(e => e.type === 'lap')
            expect(laps).toHaveLength(1)
            const splits = laps[0]!.type === 'lap' ? laps[0]!.splits : []
            expect(splits).toHaveLength(loop.checkpointCount)
            expect(splits.flatMap((t, id) => t === null ? [] : [id])).toEqual(route.checkpoints)
        })
    })

    it('counts a skip onto another branch, in any order, as long as K checkpoints are touched', () => {
        const timer = new LapTimer(loop, ...at(loop, 0))
        const events = driveLegs(loop, timer, [{ branch: 0, from: 0, to: 300 }], 5)
        // Landing on branch 2 crosses nothing on the way.
        events.push(...timer.update(...at(loop, 100, 2), 0.05, false))
        const two = loop.routes[3]!.legs
        events.push(...driveLegs(loop, timer, [{ branch: 2, from: 100, to: two[2]!.to }, two[3]!, two[4]!]))
        const lap = events.find(e => e.type === 'lap')
        expect(events.filter(e => e.type === 'split').map(e => e.type === 'split' && e.sector)).toEqual([0, 3, 2, 1])
        expect(lap?.type === 'lap' && lap.splits.map(t => t !== null)).toEqual([true, true, true, true, false])
    })

    it('leaves the lap open with fewer than K checkpoints touched', () => {
        const timer = new LapTimer(loop, ...at(loop, 0))
        const events = driveLegs(loop, timer, [{ branch: 0, from: 0, to: 250 }], 0)
        events.push(...timer.update(...at(loop, 350), 0.05, false))
        events.push(...driveLegs(loop, timer, [{ branch: 0, from: 350, to: loop.length }]))
        expect(events.filter(e => e.type === 'lap')).toEqual([])
        expect(timer.touched).toEqual([1])
    })

    it('respawns back along the road the car left, onto the road its branch came off', () => {
        const back = loop.back(1, 10, 120)
        expect(back.branch).toBe(0)
        expect(back.s).toBeCloseTo(loop.length - 70, 6)
        expect(back.legs).toEqual([{ branch: 1, from: 10, to: 0 }, { branch: 0, from: 40, to: -70 }])
        // Put back over the start line, the car owes it again.
        const timer = new LapTimer(loop, ...at(loop, 0))
        driveLegs(loop, timer, [{ branch: 0, from: 0, to: 40 }, { branch: 1, from: 0, to: 10 }], 0)
        timer.rewind(timer.clock, back.legs, ...at(loop, back.s))
        const events = driveLegs(loop, timer, [{ branch: 0, from: back.s, to: loop.length }, ...loop.routes[0]!.legs])
        expect(events.filter(e => e.type === 'lap')).toHaveLength(1)
    })

    it('sets the minimum lap by the shortest way through K checkpoints', () => {
        expect(loop.minLapSeconds * SPEED_CEILING).toBeCloseTo(Math.min(...loop.routes.map(r => r.length)), 6)
        expect(sprint.minLapSeconds * SPEED_CEILING).toBeCloseTo(sprint.routes[0]!.length, 6)
        // The bridge's branch is the shorter way to a finish.
        expect(bridge.minLapSeconds * SPEED_CEILING).toBeCloseTo(bridge.routes[1]!.length, 6)
    })
})

describe('the bot and the ghost check on a forked course', () => {
    it('drives every route of both fixtures, and medals take the fastest', () => {
        for (const def of [forkLoopDef(), forkSprintDef()]) {
            const track = new Track(def)
            const laps = medalRoutes(track).map(r => botLapTime(track, r))
            for (const lap of laps) expect(lap).not.toBeNull()
            expect(medalTimes(def)).toEqual(medalTimesFor(Math.min(...laps as number[]), track.closed))
        }
    })

    it('accepts an honest lap on every route, and refuses one lifted off the road or cut short', () => {
        for (const track of [sprint, loop]) {
            track.routes.forEach((route) => {
                const ghost = drive(track, 0, route)
                expect(ghostDrivesTrack(track, ghost)).toBe(true)
                if (route !== track.routes[0]) return
                const lifted = ghost.data.slice()
                for (let k = 20; k < lifted.length / GHOST_POSE; k++) lifted[k * GHOST_POSE + 1]! += 6
                expect(ghostDrivesTrack(track, { ...ghost, data: lifted })).toBe(false)
                const short = ghost.data.slice(0, Math.floor(ghost.data.length / GHOST_POSE / 2) * GHOST_POSE)
                expect(ghostDrivesTrack(track, { ...ghost, data: short })).toBe(false)
            })
        }
        expect(ghostDrivesTrack(loop, drive(loop, 1, loop.routes[2]!))).toBe(true)
    })

    it('accepts a flying lap that sets off a hair behind the line on a loop with no checkpoints', () => {
        const bare = new Track({ ...forkLoopDef(), checkpoints: [], branches: forkLoopDef().branches!.map(b => ({ ...b, checkpoints: [] })) })
        expect(bare.k).toBe(0)
        for (const behind of [0.05, 0.5, 1]) expect(ghostDrivesTrack(bare, mainLineGhost(bare, -behind, bare.length + 2))).toBe(true)
    })

    it('carries a last pose short of the finish over it where it is across the road', () => {
        for (const [short, lateral] of [[0.2, 6], [1, 6], [3, 7.5]] as const) {
            expect(ghostDrivesTrack(sprint, mainLineGhost(sprint, sprint.startS - 14, sprint.finishS - short, lateral))).toBe(true)
        }
    })

    it('refuses a ghost that jumps from one branch to another', () => {
        const ghost = drive(sprint, 0, sprint.routes[0]!)
        const data = ghost.data.slice()
        const count = data.length / GHOST_POSE
        // From 200 m on the main line, moved onto branch 1, 60 m across.
        for (let k = 0; k < count; k++) if (data[k * GHOST_POSE + 2]! < -200) data[k * GHOST_POSE]! -= 60
        expect(ghostDrivesTrack(sprint, { ...ghost, data })).toBe(false)
    })
})
