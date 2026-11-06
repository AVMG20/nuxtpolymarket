import { describe, expect, it } from 'vitest'
import { ghostPose, GhostRecorder } from '../../app/utils/nitro-rush/ghost'
import { settleLap } from '../../app/utils/nitro-rush/record'
import { decodeGhost, encodeGhost, ghostSampleCount, replacesGhost, type Ghost } from '#shared/utils/nitro-rush/ghost'
import { EMPTY_RECORD, type CarPose, type TrackRecord } from '../../app/utils/nitro-rush/types'

const blank = (): CarPose => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 })

/** A car driving along x at `speed` while turning about y at `spin` rad/s. */
function poseAt(t: number, speed = 40, spin = 0.5): CarPose {
    const half = spin * t / 2
    return { x: 100 + speed * t, y: 2 + Math.sin(t), z: -50 + t * t, qx: 0, qy: Math.sin(half), qz: 0, qw: Math.cos(half) }
}

/** Feeds frames from `from` to `to` lap seconds at `fps`. */
function drive(r: GhostRecorder, from: number, to: number, fps = 60, pose = poseAt) {
    for (let t = from; t <= to + 1e-9; t += 1 / fps) r.add(t, pose(t))
}

/** A ghost straight from a pose function, sampled the recorder's way. */
function ghostOf(end: number, hz = 15, pose = poseAt): Ghost {
    const n = ghostSampleCount(end, hz)
    const data: number[] = []
    for (let k = 0; k < n; k++) {
        const p = pose(k === n - 1 ? end : k / hz)
        data.push(p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw)
    }
    return { hz, end, data: Float32Array.from(data) }
}

/** Angle between two orientations, in radians. */
function angleBetween(a: CarPose, b: CarPose) {
    const dot = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw)
    return 2 * Math.acos(Math.min(1, dot))
}

function expectNear(a: CarPose, b: CarPose, pos: number, angle: number) {
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(pos)
    expect(angleBetween(a, b)).toBeLessThan(angle)
}

describe('ghost storage', () => {
    it('round-trips within the quantization', () => {
        // Sharp turns, including a quaternion that crosses over to the other hemisphere.
        const g = ghostOf(61.7, 15, t => poseAt(t, 70, 2.5))
        // The same orientations, some written as the negated quaternion.
        for (let i = 0; i < g.data.length; i += 7 * 3) for (let j = 3; j < 7; j++) g.data[i + j] = -g.data[i + j]!
        const stored = encodeGhost(g)!
        expect(stored).not.toBeNull()
        const back = decodeGhost(JSON.parse(JSON.stringify(stored)))!
        expect(back).not.toBeNull()
        expect(back.hz).toBe(15)
        expect(back.end).toBeCloseTo(61.7, 3)
        expect(back.data.length).toBe(g.data.length)
        for (let t = 0; t <= 61.7; t += 0.37) expectNear(ghostPose(back, t, blank()), ghostPose(g, t, blank()), 0.02, 2e-3)
    })

    it('refuses a jump too long to pack', () => {
        const g = ghostOf(2, 15, t => ({ ...poseAt(t), x: t > 1 ? 1000 : 0 }))
        expect(encodeGhost(g)).toBeNull()
    })

    it('treats anything malformed as no ghost', () => {
        const good = encodeGhost(ghostOf(5))!
        const bad: unknown[] = [
            undefined, null, 'ghost', 42, [], {},
            { ...good, v: 2 },
            { ...good, hz: 0 },
            { ...good, hz: 1.5 },
            { ...good, end: -1 },
            { ...good, end: 'soon' },
            { ...good, end: good.end * 2 },
            { ...good, o: [1, 2, 3] },
            { ...good, o: [0, 0, 0, 0, 0, 0, 0] },
            { ...good, o: [0, 0, 0, 0, 0, 0, 'x'] },
            { ...good, d: '%%%not base64%%%' },
            { ...good, d: good.d.slice(0, -8) },
            { ...good, d: 123 }
        ]
        for (const raw of bad) expect(decodeGhost(raw)).toBeNull()
        expect(decodeGhost(good)).not.toBeNull()
    })

    it('keeps the car the lap was driven in, and drops one it does not know', () => {
        const stored = encodeGhost({ ...ghostOf(5), car: 'og' })!
        expect(decodeGhost(JSON.parse(JSON.stringify(stored)))?.car).toBe('og')
        expect(encodeGhost(ghostOf(5))).not.toHaveProperty('car')
        const unknown = decodeGhost({ ...stored, car: 'hovercraft' })
        expect(unknown).not.toBeNull()
        expect(unknown).not.toHaveProperty('car')
    })
})

describe('ghost recording', () => {
    it('makes a ghost of a whole lap, frames at any rate, on the fixed grid', () => {
        const r = new GhostRecorder(15)
        // The countdown holds the clock at 0, then the lap runs at an uneven frame rate.
        for (let i = 0; i < 10; i++) r.add(0, poseAt(0))
        drive(r, 1 / 144, 12.49, 47)
        const g = r.lap(12.5)!
        expect(g).not.toBeNull()
        expect(g.end).toBe(12.5)
        expect(g.data.length / 7).toBe(ghostSampleCount(12.5, 15))
        for (const t of [0, 3, 7.77, 12.5]) expectNear(ghostPose(g, t, blank()), poseAt(t), 0.05, 0.01)
    })

    it('makes no ghost of a lap it joined late', () => {
        const r = new GhostRecorder(15)
        drive(r, 2, 9.99)
        expect(r.lap(10)).toBeNull()
    })

    it('makes no ghost when frames stop well before the line', () => {
        const r = new GhostRecorder(15)
        drive(r, 0, 8)
        expect(r.lap(10)).toBeNull()
    })

    it('makes no ghost across a gap or a clock running back', () => {
        const gap = new GhostRecorder(15)
        drive(gap, 0, 4)
        drive(gap, 5, 9.99)
        expect(gap.lap(10)).toBeNull()

        const back = new GhostRecorder(15)
        drive(back, 0, 6)
        drive(back, 3, 9.99)
        expect(back.lap(10)).toBeNull()
    })
})

describe('which ghost a course keeps', () => {
    const flying = { end: 60, standing: false }
    const grid = { end: 64, standing: true }
    const lap = (time: number, standing = false) => ({ time, standing })

    it('keeps the fastest lap over every attempt', () => {
        expect(replacesGhost(null, lap(70))).toBe(true)
        expect(replacesGhost(flying, lap(59))).toBe(true)
        expect(replacesGhost(flying, lap(61))).toBe(false)
    })

    it('races a loop\'s flying lap, a standing one only until there is one', () => {
        expect(replacesGhost(null, lap(64, true))).toBe(true)
        // Any flying lap beats a standing one: it's the pace a lap runs at once under way.
        expect(replacesGhost(grid, lap(66))).toBe(true)
        expect(replacesGhost(flying, lap(58, true))).toBe(false)
        expect(replacesGhost(grid, lap(63, true))).toBe(true)
        expect(replacesGhost(grid, lap(65, true))).toBe(false)
    })
})

describe('what a lap changes on the record', () => {
    const rec: TrackRecord = { ...EMPTY_RECORD, bestLap: 60 }
    const kept = { end: 60, standing: false }
    const lap = (time: number, n = 1) => ({ type: 'lap' as const, lap: n, time, splits: [time / 2] })

    it('sets the best and its splits, and marks a loop\'s first lap as standing', () => {
        const { isBest, record } = settleLap(rec, lap(59, 0), true, null, ghostOf(59))
        expect(isBest).toBe(true)
        expect(record).toMatchObject({ bestLap: 59, bestSplits: [29.5, 59], ghostStanding: true })
        expect(record!.ghost).toBeTruthy()
    })

    it('changes nothing on a slower lap that doesn\'t replace the ghost', () => {
        expect(settleLap(rec, lap(61), true, kept, ghostOf(61)).record).toBeNull()
    })

    it('keeps the old ghost when a best lap recorded none', () => {
        const ghost = encodeGhost(ghostOf(60))!
        const { record, stored } = settleLap({ ...rec, ghost }, lap(59), true, kept, null)
        expect(stored).toBeNull()
        expect(record).toMatchObject({ bestLap: 59, ghost })
    })
})
