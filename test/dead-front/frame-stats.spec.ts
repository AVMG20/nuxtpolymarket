import { describe, expect, it } from 'vitest'
import { dfFrameSummary, dfNewFrameStats, dfPushFrame } from '../../app/utils/dead-front/engine/frame-stats'

describe('dead front frame stats', () => {
    it('reads fps, p95 and p99 over the window', () => {
        const s = dfNewFrameStats()
        // older, slow frames fall outside the window
        for (let i = 0; i < 30; i++) dfPushFrame(s, 100)
        // a second of 60 fps: five frames miss one vsync, one hitches
        for (let i = 0; i < 54; i++) dfPushFrame(s, 1000 / 60)
        for (let i = 0; i < 5; i++) dfPushFrame(s, 2000 / 60)
        dfPushFrame(s, 80)
        const out = dfFrameSummary(s, { fps: 0, p95: 0, p99: 0 }, 1000)
        expect(out.fps).toBeGreaterThanOrEqual(50)
        expect(out.fps).toBeLessThanOrEqual(56)
        expect(out.p95).toBe(33)
        expect(out.p99).toBe(80)
    })

    it('wraps the ring and ignores bad intervals', () => {
        const s = dfNewFrameStats(8)
        dfPushFrame(s, 0)
        dfPushFrame(s, Number.NaN)
        expect(dfFrameSummary(s, { fps: 1, p95: 1, p99: 1 })).toEqual({ fps: 0, p95: 0, p99: 0 })
        for (let i = 0; i < 20; i++) dfPushFrame(s, 10)
        expect(s.count).toBe(8)
        expect(dfFrameSummary(s, { fps: 0, p95: 0, p99: 0 })).toEqual({ fps: 100, p95: 10, p99: 10 })
    })
})
