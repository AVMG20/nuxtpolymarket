import { describe, expect, it } from 'vitest'
import { ghostPose, GhostRecorder, ghostTime } from '../../app/utils/nitro-rush/ghost'
import { decodeGhost, encodeGhost, ghostSampleCount, replacesGhost, type Ghost } from '#shared/utils/nitro-rush/ghost'
import type { CarPose } from '../../app/utils/nitro-rush/types'
import { keptGhost, withGhost } from '../../app/utils/nitro-rush/record'

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

describe('ghost playback', () => {
    const g = ghostOf(10.03)

    it('lands on the samples', () => {
        expectNear(ghostPose(g, 0, blank()), poseAt(0), 1e-3, 1e-3)
        expectNear(ghostPose(g, 2, blank()), poseAt(2), 1e-3, 1e-3)
        expectNear(ghostPose(g, 10.03, blank()), poseAt(10.03), 1e-3, 1e-3)
    })

    it('blends between samples: lerped position, slerped orientation', () => {
        const t = 2 + 0.5 / 15
        const p = ghostPose(g, t, blank())
        const a = poseAt(2)
        const b = poseAt(2 + 1 / 15)
        expect(p.x).toBeCloseTo((a.x + b.x) / 2, 3)
        expect(p.z).toBeCloseTo((a.z + b.z) / 2, 3)
        // Spinning at a steady rate, the halfway orientation is the true one.
        expectNear(p, poseAt(t), 1, 1e-3)
        expect(Math.hypot(p.qx, p.qy, p.qz, p.qw)).toBeCloseTo(1, 5)
    })

    it('blends into the last sample at the lap end, off the grid', () => {
        const t = 10.015
        expect(ghostPose(g, t, blank()).x).toBeCloseTo((poseAt(10).x + poseAt(10.03).x) / 2, 3)
    })

    it('holds the first and last pose outside the lap', () => {
        expectNear(ghostPose(g, -3, blank()), poseAt(0), 1e-3, 1e-3)
        expectNear(ghostPose(g, 99, blank()), poseAt(10.03), 1e-3, 1e-3)
    })
})

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

    it('keeps a minute-long lap small', () => {
        const json = JSON.stringify(encodeGhost(ghostOf(60)))
        expect(json.length).toBeLessThan(40_000)
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

    it('carries on into the next lap from the line', () => {
        const r = new GhostRecorder(15)
        drive(r, 0, 9.99)
        expect(r.lap(10)).not.toBeNull()
        // The next lap's clock starts at the line; frames carry over in its time.
        const next = (t: number) => poseAt(t + 10)
        drive(r, 0.006, 8.99, 60, next)
        const g = r.lap(9)!
        expect(g).not.toBeNull()
        for (const t of [0, 4, 9]) expectNear(ghostPose(g, t, blank()), next(t), 0.05, 0.01)
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

    it('starts over on reset', () => {
        const r = new GhostRecorder(15)
        drive(r, 0, 5)
        r.reset()
        drive(r, 0, 9.99)
        expect(r.lap(10)).not.toBeNull()
        r.reset()
        expect(r.lap(10)).toBeNull()
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

describe('ghost lap time', () => {
    it('carries a flying ghost on into its lap again past the line', () => {
        expect(ghostTime(12, 60, true)).toBe(12)
        expect(ghostTime(65, 60, true)).toBeCloseTo(5)
        expect(ghostTime(125, 60, true)).toBeCloseTo(5)
    })

    it('holds a ghost that does not carry on at its lap time', () => {
        expect(ghostTime(65, 60, false)).toBe(65)
    })
})

describe('a record\'s ghost', () => {
    const stored = { v: 1 as const, hz: 15, end: 61_000, o: [0, 0, 0, 0, 0, 0, 16383], d: '' }

    it('marks a standing lap, and drops the mark for a flying one', () => {
        const standing = withGhost({ bestLap: 60, bestSplits: null }, stored, true)
        expect(standing).toEqual({ bestLap: 60, bestSplits: null, ghost: stored, ghostStanding: true })
        expect(withGhost(standing, stored, false)).not.toHaveProperty('ghostStanding')
        expect(keptGhost(standing)).toEqual({ end: 61_000, standing: true })
        expect(keptGhost(undefined)).toBeNull()
    })
})
