import { describe, expect, it } from 'vitest'
import { WEAPONS, buildChain } from '../../app/utils/meadowbrawl/weapons'
import { inArc, inCircle, inThrust, shapeHits } from '../../app/utils/meadowbrawl/geometry'

describe('weapons', () => {
    it('have the promised combo lengths and a finisher last', () => {
        expect(WEAPONS.sword.swings).toHaveLength(3)
        expect(WEAPONS.greataxe.swings).toHaveLength(2)
        expect(WEAPONS.spear.swings).toHaveLength(4)
        expect(WEAPONS.daggers.swings).toHaveLength(5)
        for (const w of Object.values(WEAPONS)) {
            const last = w.swings[w.swings.length - 1]!
            expect(last.finisher).toBe(true)
            expect(w.swings.slice(0, -1).every(s => !s.finisher)).toBe(true)
            expect(last.damage).toBeGreaterThan(Math.max(...w.swings.slice(0, -1).map(s => s.damage)))
            expect(last.knockback).toBeGreaterThan(Math.max(...w.swings.slice(0, -1).map(s => s.knockback)))
        }
    })

    it('+1 combo hit inserts swings before the finisher', () => {
        const chain = buildChain(WEAPONS.sword, 2)
        expect(chain).toHaveLength(5)
        expect(chain[4]!.finisher).toBe(true)
        expect(chain[3]!.name).toBe(WEAPONS.sword.extraSwing.name)
        expect(chain[2]!.sweep).not.toBe(chain[3]!.sweep)
    })

    it('feel different: the spear out-reaches the sword, the daggers are the fastest', () => {
        const reach = (id: keyof typeof WEAPONS) => {
            const s = WEAPONS[id].swings[0]!.shape
            return s.kind === 'circle' ? s.radius : s.reach
        }
        expect(reach('spear')).toBeGreaterThan(reach('sword'))
        expect(reach('sword')).toBeGreaterThan(reach('daggers'))
        const swingTime = (id: keyof typeof WEAPONS) => WEAPONS[id].swings[0]!.windup + WEAPONS[id].swings[0]!.active
        expect(swingTime('daggers')).toBeLessThan(swingTime('sword'))
        expect(swingTime('sword')).toBeLessThan(swingTime('greataxe'))
        expect(WEAPONS.greataxe.baseDamage).toBeGreaterThan(WEAPONS.sword.baseDamage * 2)
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
