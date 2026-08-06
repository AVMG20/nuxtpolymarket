import { describe, it, expect } from 'vitest'
import { deriveWearSpec, LOSSINESS } from '#server/utils/tcg/condition-render'
import { mintCondition } from '#shared/utils/tcg/condition'
import type { TcgCondition } from '#shared/utils/tcg/grading-model-types'

// Deterministic rng stub for minting fixture conditions: xorshift32 in [0, 1)
function seededRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        s >>>= 0
        return s / 0x100000000
    }
}

const CORNERS = ['tl', 'tr', 'bl', 'br']
const EDGES = ['top', 'right', 'bottom', 'left']

/** Crafted condition: every corner/edge site (both faces) at `value`, plus one front and one back surface defect at `value`. */
function uniformCondition(value: number, centeringF = value): TcgCondition {
    const sites = []
    for (const face of ['f', 'b']) {
        for (const c of CORNERS) sites.push({ id: `corner_${c}_${face}`, category: face === 'f' ? 2 : 3, value })
        for (const e of EDGES) sites.push({ id: `edge_${e}_${face}`, category: face === 'f' ? 4 : 5, value })
    }
    return {
        sites,
        surface: [
            { id: 'surface_f_0', category: 6, value, x: 0.3, y: 0.7, angle: 1.1, type: 'scratch' },
            { id: 'surface_b_0', category: 7, value, x: 0.5, y: 0.2, angle: 0.4, type: 'dimple' }
        ],
        subs: [centeringF, 10, value, value, value, value, value, value]
    }
}

describe('deriveWearSpec', () => {
    it('is deterministic: two calls with identical inputs are deep-equal', () => {
        const condition = mintCondition(seededRng(1234))
        const a = deriveWearSpec('copy-abc', condition)
        const b = deriveWearSpec('copy-abc', condition)
        expect(a).toEqual(b)
        // and a different copyId gives a different centering direction
        const c = deriveWearSpec('copy-xyz', condition)
        expect(Math.atan2(a.centering.dy, a.centering.dx))
            .not.toBeCloseTo(Math.atan2(c.centering.dy, c.centering.dx), 6)
    })

    it('near-mint condition yields a zero-or-cosmetically-tiny spec', () => {
        const spec = deriveWearSpec('copy-nm', uniformCondition(9.6, 9.8))
        const severities = [
            ...spec.corners.map(f => f.severity),
            ...spec.edges.map(f => f.severity),
            ...spec.surface.map(f => f.severity)
        ]
        // severityRaw ≈ 0.108 — anything that survives the threshold lands in
        // the lowest band, well under 0.2
        for (const s of severities) expect(s).toBeLessThan(0.2)
        expect(Math.hypot(spec.centering.dx, spec.centering.dy)).toBeLessThan(0.008)
    })

    it('a beaten condition renders every front flaw', () => {
        const spec = deriveWearSpec('copy-beaten', uniformCondition(7))
        expect(spec.corners.map(f => f.corner).sort()).toEqual([...CORNERS].sort())
        expect(spec.edges.map(f => f.edge).sort()).toEqual([...EDGES].sort())
        expect(spec.surface).toHaveLength(1)
        for (const f of [...spec.corners, ...spec.edges, ...spec.surface]) {
            expect(f.severity).toBeGreaterThan(0.5)
        }
    })

    it('never emits back-face flaws', () => {
        // Front face pristine, back face wrecked: nothing should render
        const condition: TcgCondition = {
            sites: uniformCondition(10).sites.map(s =>
                s.id.endsWith('_b') ? { ...s, value: 6.3 } : s),
            surface: [{ id: 'surface_b_0', category: 7, value: 6.3, x: 0.1, y: 0.1, angle: 0, type: 'scratch' }],
            subs: [10, 6.3, 10, 6.3, 10, 6.3, 10, 6.3]
        }
        const spec = deriveWearSpec('copy-backonly', condition)
        expect(spec.corners).toHaveLength(0)
        expect(spec.edges).toHaveLength(0)
        expect(spec.surface).toHaveLength(0)
    })

    it('monotonicity-ish: a worse value never yields a smaller severity for the same site', () => {
        let prev = 0
        // value descending 10 → 6.3, severity (absent = 0) must never decrease
        for (let value = 10; value >= 6.3; value -= 0.05) {
            const spec = deriveWearSpec('copy-mono', uniformCondition(value))
            const tl = spec.corners.find(f => f.corner === 'tl')
            const severity = tl?.severity ?? 0
            expect(severity).toBeGreaterThanOrEqual(prev - 1e-12)
            prev = severity
        }
    })

    it('big flaws always render, for every copyId (threshold bypass)', () => {
        for (let i = 0; i < 100; i++) {
            const spec = deriveWearSpec(`copy-bypass-${i}`, uniformCondition(6.5))
            expect(spec.corners.map(f => f.corner)).toContain('tl')
            expect(spec.edges.map(f => f.edge)).toContain('top')
            expect(spec.surface).toHaveLength(1)
        }
    })

    it('centering is exact: magnitude carries subs[0] with no noise, direction is per-copy only', () => {
        for (const subs0 of [10, 9.4, 8.1, 6.3]) {
            const spec = deriveWearSpec('copy-cent', uniformCondition(9, subs0))
            const expected = Math.pow(Math.min((10 - subs0) / 3.7, 1), LOSSINESS.centerCurve) * LOSSINESS.maxCenterOffset
            expect(Math.hypot(spec.centering.dx, spec.centering.dy)).toBeCloseTo(expected, 12)
        }
        // direction depends only on copyId, not on the rest of the condition
        const a = deriveWearSpec('copy-cent', uniformCondition(9, 8))
        const b = deriveWearSpec('copy-cent', uniformCondition(6.5, 8))
        expect(a.centering).toEqual(b.centering)
    })

    it('flaw seeds are stable per copy+site and differ between copies', () => {
        const condition = uniformCondition(6.5)
        const a = deriveWearSpec('copy-seed-a', condition)
        const b = deriveWearSpec('copy-seed-b', condition)
        const aTl = a.corners.find(f => f.corner === 'tl')!
        const bTl = b.corners.find(f => f.corner === 'tl')!
        expect(aTl.seed).toBe(deriveWearSpec('copy-seed-a', condition).corners.find(f => f.corner === 'tl')!.seed)
        expect(aTl.seed).not.toBe(bTl.seed)
        expect(Number.isInteger(aTl.seed)).toBe(true)
        expect(aTl.seed).toBeGreaterThanOrEqual(0)
        expect(aTl.seed).toBeLessThan(2 ** 32)
    })
})
