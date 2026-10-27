import { describe, expect, it } from 'vitest'
import { findTrack, formatLapTime, LapTimer, ovalTrack, Track, TRACKS } from '#shared/utils/nitro-rush/track'

const oval = new Track(ovalTrack())

describe('oval track', () => {
    it('measures two straights and two half circles', () => {
        expect(oval.length).toBeCloseTo(2 * 360 + 2 * Math.PI * 75, -1)
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
    const sprint = new Track({ id: 'straight', name: 'Straight', points, halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 30, runOff: 150 })

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

describe('track registry', () => {
    it('has unique ids, and finds courses by them', () => {
        expect(new Set(TRACKS.map(t => t.id)).size).toBe(TRACKS.length)
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
        const timer = new LapTimer(L, true, -14)
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
