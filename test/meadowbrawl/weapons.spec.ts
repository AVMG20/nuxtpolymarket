import { describe, expect, it } from 'vitest'
import { WEAPONS, buildChain } from '../../app/utils/meadowbrawl/weapons'
import { inArc, inCircle, inThrust, shapeHits } from '../../app/utils/meadowbrawl/geometry'

describe('weapons', () => {
    it('end every combo on its one finisher', () => {
        for (const w of Object.values(WEAPONS)) {
            expect(w.swings[w.swings.length - 1]!.finisher).toBe(true)
            expect(w.swings.slice(0, -1).every(s => !s.finisher)).toBe(true)
        }
    })

    it('+1 combo hit inserts swings before the finisher', () => {
        const chain = buildChain(WEAPONS.sword, 2)
        expect(chain).toHaveLength(WEAPONS.sword.swings.length + 2)
        expect(chain[chain.length - 1]!.finisher).toBe(true)
        expect(chain[chain.length - 2]!.name).toBe(WEAPONS.sword.extraSwing.name)
    })
})

describe('hit shapes', () => {
    const origin = { x: 0, y: 0 }
    it('arcs respect reach and angle, with tolerance for the target radius', () => {
        expect(inArc(origin, 0, 0.8, 60, { x: 50, y: 0 }, 10)).toBe(true)
        expect(inArc(origin, 0, 0.8, 60, { x: 80, y: 0 }, 10)).toBe(false)
        expect(inArc(origin, 0, 0.8, 60, { x: -40, y: 0 }, 10)).toBe(false)
        // Just outside the angular edge, but its body still overlaps the arc.
        expect(inArc(origin, 0, 0.8, 60, { x: 30, y: 33 }, 12)).toBe(true)
    })
    it('thrusts are long and narrow', () => {
        expect(inThrust(origin, 0, 120, 30, { x: 110, y: 0 }, 8)).toBe(true)
        expect(inThrust(origin, 0, 120, 30, { x: 60, y: 40 }, 8)).toBe(false)
        expect(inThrust(origin, Math.PI / 2, 120, 30, { x: 0, y: 100 }, 8)).toBe(true)
    })
    it('circles and reach scaling', () => {
        expect(inCircle(origin, 50, { x: 55, y: 0 }, 10)).toBe(true)
        expect(shapeHits({ kind: 'arc', reach: 60, halfAngle: 1 }, origin, 0, 1, { x: 80, y: 0 }, 10)).toBe(false)
        expect(shapeHits({ kind: 'arc', reach: 60, halfAngle: 1 }, origin, 0, 1.5, { x: 80, y: 0 }, 10)).toBe(true)
    })
})
