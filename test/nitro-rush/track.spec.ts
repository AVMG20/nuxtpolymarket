import { describe, expect, it } from 'vitest'
import { buildTrack, checkpoint, climbAt, corner, finish, LINE_BLOCK_LENGTH, MIN_CLEARANCE, ramp, spiral, start, straight, TrackLayoutError, type TrackLayout } from '#shared/utils/nitro-rush/layout'
import { formatLapTime, LapTimer } from '#shared/utils/nitro-rush/timing'
import { Track } from '#shared/utils/nitro-rush/track'
import { findTrack, POLYTOWN_OVAL, TRACK_GROUPS, TRACKS } from '#shared/utils/nitro-rush/tracks'

const oval = new Track(buildTrack(POLYTOWN_OVAL))

/** Bare layouts for the block tests: a loop, or an open course. */
const base = { group: 'circuits' as const, halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 } }
const loop = (pieces: TrackLayout['pieces']): TrackLayout => ({ ...base, id: 'loop', name: 'Loop', pieces })
const sprint = (pieces: TrackLayout['pieces']): TrackLayout => ({ ...base, id: 'sprint', name: 'Sprint', closed: false, pieces })

/** The oval as it was drawn before blocks: leaderboard times were set on exactly this line. */
function legacyOval() {
    const pts: [number, number][] = []
    const line = (x: number, z0: number, z1: number) => {
        const n = Math.round(Math.abs(z1 - z0) / 2)
        for (let i = 0; i < n; i++) pts.push([x, z0 + (z1 - z0) * i / n])
    }
    const arc = (cz: number, a0: number) => {
        const n = Math.round(Math.PI * 75 / 2)
        for (let i = 0; i < n; i++) pts.push([Math.cos(a0 + Math.PI * i / n) * 75, cz - Math.sin(a0 + Math.PI * i / n) * 75])
    }
    line(75, 0, -180)
    arc(-180, 0)
    line(-75, -180, 180)
    arc(180, Math.PI)
    line(75, 180, 0)
    return pts
}

describe('oval track', () => {
    it('measures two straights and two half circles', () => {
        expect(oval.length).toBeCloseTo(2 * 360 + 2 * Math.PI * 75, -1)
    })

    it('lies on exactly the line the leaderboard times were set on', () => {
        const legacy = legacyOval()
        expect(oval.def.points).toHaveLength(legacy.length)
        oval.def.points.forEach(([x, z], i) => {
            expect(x).toBeCloseTo(legacy[i]![0], 6)
            expect(z).toBeCloseTo(legacy[i]![1], 6)
        })
    })

    it('has one checkpoint, halfway down the back straight', () => {
        expect(oval.checkpoints).toHaveLength(1)
        const p = oval.pointAt(oval.checkpoints[0]!)
        expect(p.x).toBeCloseTo(-75)
        expect(p.z).toBeCloseTo(0)
        expect(oval.checkpointDistances[0]).toBeCloseTo(oval.length / 2)
    })

    it('starts on the main straight heading up the screen', () => {
        const p = oval.pointAt(0)
        expect(p.x).toBeCloseTo(75)
        expect(p.z).toBeCloseTo(0)
        expect(p.tz).toBeCloseTo(-1)
    })

    it('projects a point to its distance and a signed offset, + to the right', () => {
        const right = oval.project(78, -10)
        expect(right.s).toBeCloseTo(10, 5)
        expect(right.lateral).toBeCloseTo(3, 5)
        const left = oval.project(72, -10, right.seg)
        expect(left.lateral).toBeCloseTo(-3, 5)
    })

    it('finds the right segment from a stale hint', () => {
        const far = oval.pointAt(600)
        const p = oval.project(far.x, far.z, 0)
        expect(p.s).toBeCloseTo(600, 3)
    })

    it('wraps distances onto one lap', () => {
        expect(oval.wrapS(-14)).toBeCloseTo(oval.length - 14)
        expect(oval.wrapS(oval.length + 5)).toBeCloseTo(5)
    })
})

describe('open course', () => {
    const points: [number, number][] = Array.from({ length: 401 }, (_, i) => [0, -i * 2])
    const sprint = new Track({ id: 'straight', name: 'Straight', group: 'sprints', points, halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 30, runOff: 150 })

    it('measures end to end without closing back to the start', () => {
        expect(sprint.closed).toBe(false)
        expect(sprint.length).toBeCloseTo(800)
        expect(sprint.startS).toBe(30)
        expect(sprint.finishS).toBeCloseTo(650)
        expect(sprint.lapLength).toBeCloseTo(620)
        expect(sprint.curvature[0]).toBe(0)
        expect(sprint.curvature[400]).toBe(0)
    })

    it('clamps distances onto the course instead of wrapping them', () => {
        expect(sprint.wrapS(-10)).toBe(0)
        expect(sprint.wrapS(900)).toBe(800)
        expect(sprint.segmentAt(800)).toBe(399)
        expect(sprint.pointAt(900).z).toBeCloseTo(-800)
    })

    it('projects past either end to a distance off the course, for the barriers', () => {
        expect(sprint.project(1, 5).s).toBeCloseTo(-5)
        expect(sprint.project(1, -806, 399).s).toBeCloseTo(806)
        expect(sprint.project(1, -806).lateral).toBeCloseTo(1)
    })
})

describe('track blocks', () => {
    /** A rounded square, short of the first side's straight so line blocks can fill it. */
    const square = [corner('right', 50), straight(100), corner('right', 50), straight(100), corner('right', 50), straight(100), corner('right', 50)]

    it('turns right on a right-hand corner, starting the lap on the start line', () => {
        const t = new Track(buildTrack(loop([start, straight(80), ...square])))
        const p = t.pointAt(0)
        expect(p.x).toBeCloseTo(0)
        expect(p.z).toBeCloseTo(-LINE_BLOCK_LENGTH / 2)
        expect(t.length).toBeCloseTo(400 + 2 * Math.PI * 50, 0)
        // Clockwise seen from above: the first bend swings the car toward +x.
        expect(t.pointAt(LINE_BLOCK_LENGTH / 2 + 80 + Math.PI * 25).tx).toBeCloseTo(1, 1)
    })

    it('puts checkpoints in driving order, measured from the start line', () => {
        const t = new Track(buildTrack(loop([checkpoint, start, straight(40), checkpoint, ...square])))
        expect(t.checkpointDistances).toHaveLength(2)
        expect(t.checkpointDistances[0]).toBeCloseTo(LINE_BLOCK_LENGTH / 2 + 40 + LINE_BLOCK_LENGTH / 2)
        expect(t.checkpointDistances[1]).toBeCloseTo(t.length - LINE_BLOCK_LENGTH)
    })

    it('builds an open course with its run-up and run-off from the blocks around the lines', () => {
        const def = buildTrack(sprint([straight(30), start, straight(200), checkpoint, corner('left', 60), straight(200), finish, straight(100)]))
        const t = new Track(def)
        expect(t.closed).toBe(false)
        expect(t.startS).toBeCloseTo(30 + LINE_BLOCK_LENGTH / 2)
        expect(t.length - t.finishS).toBeCloseTo(100 + LINE_BLOCK_LENGTH / 2)
        expect(t.checkpoints[0]).toBeGreaterThan(t.startS)
        expect(t.checkpoints[0]).toBeLessThan(t.finishS)
        expect(t.pointAt(t.length).tx).toBeCloseTo(-1)
    })

    it('rejects layouts a track cannot be built from', () => {
        expect(() => buildTrack(loop([straight(100), ...square]))).toThrow(/one start/)
        expect(() => buildTrack(loop([start, ...square]))).toThrow(/closing the loop/)
        expect(() => buildTrack(loop([start, finish, straight(60), ...square]))).toThrow(/no finish/)
        expect(() => buildTrack(sprint([straight(30), start, straight(200)]))).toThrow(/one finish/)
        expect(() => buildTrack(sprint([start, straight(200), finish, straight(100)]))).toThrow(/before the start line/)
        expect(() => buildTrack(sprint([straight(30), start, straight(200), finish]))).toThrow(/after the finish line/)
        expect(() => buildTrack(sprint([straight(30), finish, straight(200), start, straight(100)]))).toThrow(/finish comes before/)
        expect(() => buildTrack(sprint([checkpoint, straight(30), start, straight(200), finish, straight(100)]))).toThrow(/between the start and the finish/)
        expect(() => buildTrack(loop([start, corner('left', 8)]))).toThrow(/wider than the track/)
    })

    it('throws a TrackLayoutError carrying the bare reason, for a track builder to show', () => {
        let error: unknown
        try {
            buildTrack(sprint([straight(30), start, straight(200)]))
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(TrackLayoutError)
        const { trackId, reason, message } = error as TrackLayoutError
        expect(trackId).toBe('sprint')
        expect(reason).toBe('an open course needs exactly one finish block')
        expect(message).toBe(`Track sprint: ${reason}`)
    })

    it('turns an eighth onto the diagonal, and two eighths make a quarter', () => {
        const t = new Track(buildTrack(sprint([straight(30), start, corner('right', 60, 45), straight(100), finish, straight(100)])))
        const p = t.pointAt(t.startS + LINE_BLOCK_LENGTH / 2 + Math.PI / 4 * 60 + 50)
        expect(p.tx).toBeCloseTo(Math.SQRT1_2, 6)
        expect(p.tz).toBeCloseTo(-Math.SQRT1_2, 6)
        // Building at all proves the eighths close the loop exactly as the quarter did.
        const quarter = new Track(buildTrack(loop([start, straight(80), ...square])))
        const eighths = new Track(buildTrack(loop([start, straight(80), corner('right', 50, 45), corner('right', 50, 45), ...square.slice(1)])))
        expect(eighths.length).toBeCloseTo(quarter.length, 1)
        expect(() => buildTrack(loop([start, corner('right', 50, 60)]))).toThrow(/steps of 45/)
    })

    it('pads a bend off a diagonal back onto the grid, so a loop with a diagonal closes on round lengths', () => {
        // The jog ends 105.9 m across and 279.7 m up; padding takes it to 110 and 280.
        const jog = [corner('right', 60, 45), straight(100), corner('left', 60, 45)]
        const pieces = [start, straight(100), ...jog, straight(100), corner('right', 50), straight(100), corner('right', 50), straight(380), corner('right', 50), straight(210), corner('right', 50)]
        const t = new Track(buildTrack(loop(pieces)))
        // Mirrored or facing another way, the padding runs the other way and the loop still closes.
        expect(() => buildTrack(loop(pieces.map(p => 'turn' in p ? { ...p, turn: p.turn === 'right' ? 'left' as const : 'right' as const } : p)))).not.toThrow()
        for (const heading of [Math.PI / 2, Math.PI, -Math.PI / 2]) expect(() => buildTrack({ ...loop(pieces), origin: { x: 5, z: -3, heading } })).not.toThrow()
        const laid = LINE_BLOCK_LENGTH + 100 * 4 + 380 + 210 + Math.PI / 4 * 60 * 2 + Math.PI / 2 * 50 * 4
        // 4.1 m across takes 5.9 m on the diagonal, then 0.3 m up the straight.
        expect(t.length - laid).toBeCloseTo(4.142 * Math.SQRT2 + 0.295, 1)
    })
})

describe('ramps and spirals', () => {
    /** A rounded square that climbs one side and comes back down the next. */
    const hill = [start, straight(80), corner('right', 50), ramp(100, 8), corner('right', 50), ramp(100, -8), corner('right', 50), straight(100), corner('right', 50)]
    const helix = (rise: number) => sprint([straight(30), start, straight(100), spiral('right', 40, 450, rise), straight(100), finish, straight(100)])

    it('eases a slope in and out, so pieces meet without a kink', () => {
        expect(climbAt(0, 100)).toBe(0)
        expect(climbAt(100, 100)).toBeCloseTo(1, 12)
        expect(climbAt(50, 100)).toBeCloseTo(0.5, 12)
        for (let d = 1; d <= 100; d++) expect(climbAt(d, 100)).toBeGreaterThan(climbAt(d - 1, 100))
        // Level at both ends: the first and last metre barely rise.
        expect(climbAt(1, 100)).toBeLessThan(0.001)
        expect(1 - climbAt(99, 100)).toBeLessThan(0.001)
    })

    it('climbs a ramp and comes back down to the ground', () => {
        const t = new Track(buildTrack(loop(hill)))
        expect(t.elevated).toBe(true)
        expect(Math.max(...t.ys)).toBeCloseTo(8, 6)
        expect(t.pointAt(0).y).toBe(0)
        // Halfway up the climb, the road rises in the driving direction.
        const up = t.pointAt(LINE_BLOCK_LENGTH / 2 + 80 + Math.PI * 25 + 50)
        expect(up.y).toBeCloseTo(4, 1)
        expect(up.grade).toBeGreaterThan(0.08)
        const down = t.pointAt(LINE_BLOCK_LENGTH / 2 + 80 + Math.PI * 50 + 150)
        expect(down.y).toBeCloseTo(4, 1)
        expect(down.grade).toBeLessThan(-0.08)
    })

    it('starts a course up on a raised road', () => {
        const t = new Track(buildTrack(sprint([ramp(100, 5), start, straight(100), finish, straight(100)])))
        expect(t.pointAt(t.startS).y).toBeCloseTo(5, 6)
    })

    it('leaves a flat course without heights', () => {
        expect(buildTrack(POLYTOWN_OVAL).heights).toBeUndefined()
        expect(oval.elevated).toBe(false)
        expect(oval.pointAt(300).y).toBe(0)
    })

    it('stacks a spiral with room to drive under its upper level', () => {
        const t = new Track(buildTrack(helix(12)))
        const into = t.startS + LINE_BLOCK_LENGTH / 2 + 100
        const below = t.pointAt(into)
        const above = t.pointAt(into + Math.PI * 2 * 40)
        // The sampled line is a polygon, a hair shorter round than the true circle.
        expect(Math.hypot(above.x - below.x, above.z - below.z)).toBeLessThan(0.05)
        expect(above.y - below.y).toBeGreaterThan(MIN_CLEARANCE)
        expect(t.pointAt(t.length).y).toBeCloseTo(12, 6)
    })

    it('projects onto the level a height picks where a spiral passes over itself', () => {
        const t = new Track(buildTrack(helix(12)))
        const into = t.startS + LINE_BLOCK_LENGTH / 2 + 100
        const p = t.pointAt(into + 10)
        const lower = t.project(p.x, p.z, -1, undefined, p.y)
        const upper = t.project(p.x, p.z, -1, undefined, t.pointAt(into + 10 + Math.PI * 2 * 40).y)
        expect(lower.s).toBeCloseTo(into + 10, 1)
        expect(upper.s).toBeCloseTo(into + 10 + Math.PI * 2 * 40, 0)
        // A hint keeps the search on its own level whatever the height says.
        expect(t.project(p.x, p.z, t.segmentAt(into + 10)).s).toBeCloseTo(into + 10, 1)
    })

    it('lets a road pass over a line block with the clearance any other road gets', () => {
        // The spiral's top level runs back over the checkpoint just before it, under 11 m up.
        const t = new Track(buildTrack(sprint([straight(30), start, straight(100), checkpoint, spiral('right', 40, 360, 8), straight(100), finish, straight(100)])))
        const line = t.checkpoints[0]!
        const at = t.pointAt(line)
        const over = t.project(at.x, at.z, -1, undefined, 8)
        expect(Math.abs(over.s - line)).toBeGreaterThan(100)
        expect(t.pointAt(over.s).y - at.y).toBeGreaterThan(MIN_CLEARANCE)
    })

    it('rejects heights a road cannot be built with', () => {
        expect(() => buildTrack(helix(6))).toThrow(/passes .* m from another stretch/)
        expect(() => buildTrack(loop([...hill.slice(0, 5), straight(100), ...hill.slice(6)]))).toThrow(/off the ground/)
        expect(() => buildTrack(loop([start, straight(80), corner('right', 50), ramp(100, -8), corner('right', 50), ramp(100, 8), corner('right', 50), straight(100), corner('right', 50)]))).toThrow(/below the ground/)
        expect(() => buildTrack(loop([start, straight(80), corner('right', 50), ramp(50, 8), straight(50), corner('right', 50), ramp(100, -8), corner('right', 50), straight(100), corner('right', 50)]))).toThrow(/longer than/)
        expect(() => buildTrack(sprint([straight(30), start, straight(100), spiral('right', 40, 100, 4), straight(100), finish, straight(100)]))).toThrow(/steps of 45/)
    })
})

describe('track registry', () => {
    it('has unique ids, and finds courses by them', () => {
        expect(new Set(TRACKS.map(t => t.id)).size).toBe(TRACKS.length)
        expect(TRACKS.every(t => TRACK_GROUPS.some(g => g.id === t.group))).toBe(true)
        expect(findTrack('polytown-oval')?.name).toBe('Polytown Oval')
        expect(findTrack('nowhere')).toBeNull()
    })
})

describe('formatLapTime', () => {
    it('formats lap and gap times', () => {
        expect(formatLapTime(62.345)).toBe('1:02.345')
        expect(formatLapTime(23.1)).toBe('0:23.100')
        expect(formatLapTime(-0.42, true)).toBe('-0.420')
        expect(formatLapTime(1.5, true)).toBe('+1.500')
    })
})

describe('LapTimer', () => {
    const L = 1000
    /** Drives `ds` metres a step from `from`, wrapped onto a loop of L. */
    const drive = (timer: LapTimer, from: number, ds: number, dt: number, steps: number) => {
        const events = []
        let s = from
        for (let i = 0; i < steps; i++) {
            s += ds
            events.push(...timer.update(timer.closed ? ((s % L) + L) % L : s, dt))
        }
        return events
    }

    it('reports splits and laps with interpolated times, and never stops on a loop', () => {
        const timer = new LapTimer(L, true, -14, [L / 3, L * 2 / 3])
        // 100 m/s: 10 s a lap, and lap 1 also covers the 14 m from the grid (a standing start).
        const events = drive(timer, -14, 10, 0.1, 1010)
        const laps = events.filter(e => e.type === 'lap').map(e => e.time)
        expect(events.filter(e => e.type === 'split')).toHaveLength(20)
        expect(laps).toHaveLength(10)
        expect(laps[0]).toBeCloseTo(10.14, 6)
        for (const t of laps.slice(1)) expect(t).toBeCloseTo(10, 6)
        expect(timer.finished).toBe(false)
        expect(timer.lap).toBe(10)
    })

    it('ends an open run at the finish line, timed from the start', () => {
        const timer = new LapTimer(620, false, -14)
        const events = drive(timer, -14, 10, 0.1, 200)
        const laps = events.filter(e => e.type === 'lap').map(e => e.time)
        expect(laps).toHaveLength(1)
        expect(laps[0]).toBeCloseTo(6.34, 6)
        expect(timer.finished).toBe(true)
        expect(timer.clock).toBeCloseTo(6.34, 6)
    })

    it('closes a sector at each checkpoint, and has none without them', () => {
        const timer = new LapTimer(L, true, 0, [250])
        const events = drive(timer, 0, 10, 0.1, 100)
        expect(events.map(e => e.type)).toEqual(['split', 'lap'])
        expect(events[0]!.time).toBeCloseTo(2.5, 6)
        expect(drive(new LapTimer(L, true, 0), 0, 10, 0.1, 100).map(e => e.type)).toEqual(['lap'])
    })

    it('does not close a lap when the car first crosses the line from the grid', () => {
        const timer = new LapTimer(L, true, -14)
        const events = drive(timer, -14, 10, 0.1, 5)
        expect(events.filter(e => e.type === 'lap')).toHaveLength(0)
        expect(timer.lap).toBe(0)
    })

    it('never counts a lap for reversing over the line and back', () => {
        const timer = new LapTimer(L, true, 5)
        drive(timer, 5, -1, 0.1, 20)
        const events = drive(timer, -15, 1, 0.1, 20)
        expect(events).toHaveLength(0)
        expect(timer.lap).toBe(0)
    })
})
