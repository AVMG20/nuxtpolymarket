import { describe, expect, it } from 'vitest'
import { formatLapTime, LapTimer, ovalTrack, Track } from '../../app/utils/nitro-rush/track'

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
    /** Drives `ds` metres a step from `from` until the timer finishes or the steps run out. */
    const drive = (timer: LapTimer, from: number, ds: number, dt: number, steps: number) => {
        const events = []
        let s = from
        for (let i = 0; i < steps && !timer.finished; i++) {
            s += ds
            events.push(...timer.update(((s % L) + L) % L, dt))
        }
        return events
    }

    it('reports splits, laps and the finish with interpolated times', () => {
        const timer = new LapTimer(L, 3, -14)
        // 100 m/s: 10 s a lap, and lap 1 also covers the 14 m from the grid (a standing start).
        const events = drive(timer, -14, 10, 0.1, 10000)
        const laps = events.filter(e => e.type === 'lap').map(e => e.time)
        const splits = events.filter(e => e.type === 'split')
        expect(splits).toHaveLength(6)
        expect(laps).toHaveLength(3)
        expect(laps[0]).toBeCloseTo(10.14, 6)
        expect(laps[1]).toBeCloseTo(10, 6)
        expect(laps[2]).toBeCloseTo(10, 6)
        const finish = events.find(e => e.type === 'finish')
        expect(finish?.type === 'finish' && finish.total).toBeCloseTo(30.14, 6)
        expect(timer.finished).toBe(true)
    })

    it('does not close a lap when the car first crosses the line from the grid', () => {
        const timer = new LapTimer(L, 3, -14)
        const events = drive(timer, -14, 10, 0.1, 5)
        expect(events.filter(e => e.type === 'lap')).toHaveLength(0)
        expect(timer.lap).toBe(0)
    })

    it('never counts a lap for reversing over the line and back', () => {
        const timer = new LapTimer(L, 3, 5)
        drive(timer, 5, -1, 0.1, 20)
        const events = drive(timer, -15, 1, 0.1, 20)
        expect(events).toHaveLength(0)
        expect(timer.lap).toBe(0)
    })
})
