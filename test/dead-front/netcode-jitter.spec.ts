import { describe, expect, it } from 'vitest'
import { DF_MAX_INTERP_DELAY_MS, DfSnapBuffer } from '../../app/utils/dead-front/engine/interp'
import type { DfSnapshot } from '#shared/utils/dead-front/protocol'

function snap(time: number): DfSnapshot {
    return { time, zombies: [], players: [] } as unknown as DfSnapshot
}

describe('DfSnapBuffer jitter', () => {
    it('keeps the base delay on a steady 20 Hz stream', () => {
        const b = new DfSnapBuffer()
        for (let i = 0; i < 100; i++) b.push(snap(i * 0.05), 1000 + i * 50 + 40)
        expect(b.targetDelay(100, 50)).toBe(100)
    })

    it('grows the delay when arrivals are late by up to 70 ms', () => {
        const b = new DfSnapBuffer()
        for (let i = 0; i < 200; i++) b.push(snap(i * 0.05), 1000 + i * 50 + 35 + (i % 3) * 35)
        const d = b.targetDelay(100, 50)
        expect(d).toBeGreaterThan(150)
        expect(d).toBeLessThanOrEqual(DF_MAX_INTERP_DELAY_MS)
    })

    it('keeps two snapshots ahead of the render clock under that jitter', () => {
        const b = new DfSnapBuffer()
        let underruns = 0
        for (let i = 0; i < 400; i++) {
            const arrive = 1000 + i * 50 + 35 + ((i * 7) % 5) * 9
            b.push(snap(i * 0.05), arrive)
            if (i < 40) continue
            const now = arrive + 25
            const t = b.renderTime(now, b.targetDelay(100, 50))
            if (t > b.latest!.s.time) underruns++
        }
        expect(underruns).toBe(0)
    })
})
