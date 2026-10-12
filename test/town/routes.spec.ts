import { describe, expect, it } from 'vitest'
import { townRouteBand, townRouteCurve, townRouteRibbon } from '../../app/utils/town/routes'

describe('Polytown supply route line', () => {
    it('collapses a straight run to its two ends', () => {
        const line = townRouteCurve([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }])
        expect(line).toEqual([{ x: 0, z: 0 }, { x: 3, z: 0 }])
    })
    it('rounds a corner without cutting through it', () => {
        const line = townRouteCurve([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], 0.35)
        expect(line[0]).toEqual({ x: 0, z: 0 })
        expect(line[line.length - 1]).toEqual({ x: 2, z: 2 })
        // Every point stays inside the corner's box and none sits on the sharp tip.
        for (const p of line) {
            expect(p.x).toBeLessThanOrEqual(2 + 1e-9)
            expect(p.z).toBeGreaterThanOrEqual(-1e-9)
            expect(Math.hypot(p.x - 2, p.z)).toBeGreaterThan(0.05)
        }
    })
    it('keeps two turns one tile apart from overlapping', () => {
        const line = townRouteCurve([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }, { x: 4, z: 1 }], 0.9)
        for (let i = 1; i < line.length; i++) {
            expect(line[i]!.x).toBeGreaterThanOrEqual(line[i - 1]!.x - 1e-9)
            expect(line[i]!.z).toBeGreaterThanOrEqual(line[i - 1]!.z - 1e-9)
        }
    })
    it('lays a ribbon whose distance runs from supplier to workshop', () => {
        const geo = townRouteRibbon([{ x: 0, z: 0 }, { x: 3, z: 0 }], 0.1, 0.36)
        const dist = geo.getAttribute('aDist').array as Float32Array
        const pos = geo.getAttribute('position').array as Float32Array
        expect(Math.min(...dist)).toBeCloseTo(-0.1)
        expect(Math.max(...dist)).toBeCloseTo(3.1)
        for (let i = 1; i < pos.length; i += 3) expect(pos[i]).toBeCloseTo(0.36)
        expect(geo.index!.count % 3).toBe(0)
        expect([...geo.index!.array].every(n => n < pos.length / 3)).toBe(true)
    })
    it('draws nothing for a single point', () => {
        expect(townRouteRibbon([{ x: 0, z: 0 }], 0.1, 0).getAttribute('position')).toBeUndefined()
    })
})

describe('Polytown supply route bands', () => {
    it('stays green through full range, then orange, then red', () => {
        const bands = Array.from({ length: 14 }, (_, tiles) => townRouteBand(tiles, 4, 16))
        expect(bands).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2])
    })
    it('pushes the green stretch out with a monument bonus', () => {
        expect(townRouteBand(6, 6, 16)).toBe(0)
        expect(townRouteBand(7, 6, 16)).toBe(1)
    })
    it('always leaves at least one orange tile', () => {
        expect(townRouteBand(16, 15, 16)).toBe(1)
        expect(townRouteBand(17, 15, 16)).toBe(2)
    })
})
