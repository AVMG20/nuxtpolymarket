import { describe, expect, it, vi } from 'vitest'
import {
    createPathwardenMapPlan,
    createPathwardenSeededRandom,
    hashPathwardenMapPlan,
    serializePathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map'

describe('Pathwarden seeded map model', () => {
    it('reproduces canonical plans for 1,000 seeds', () => {
        for (let seed = 0; seed < 1_000; seed++) {
            const first = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            const second = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            expect(serializePathwardenMapPlan(first)).toBe(serializePathwardenMapPlan(second))
            expect(hashPathwardenMapPlan(first)).toBe(hashPathwardenMapPlan(second))
        }
    })

    it('round-trips through JSON without changing canonical output', () => {
        const plan = createPathwardenMapPlan({ seed: 4_294_967_295, realm: 5 })
        const restored = JSON.parse(JSON.stringify(plan))
        expect(serializePathwardenMapPlan(restored)).toBe(serializePathwardenMapPlan(plan))
    })

    it('uses the seed to create different initial layouts', () => {
        const hashes = new Set(
            Array.from({ length: 64 }, (_, seed) => hashPathwardenMapPlan(
                createPathwardenMapPlan({ seed, realm: 1 })
            ))
        )
        expect(hashes.size).toBeGreaterThan(8)
    })

    it('does not depend on global Math.random', () => {
        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('Global randomness is forbidden')
        })
        expect(() => createPathwardenMapPlan({ seed: 42, realm: 1 })).not.toThrow()
        expect(random).not.toHaveBeenCalled()
        random.mockRestore()
    })

    it('can resume an explicit random state', () => {
        const first = createPathwardenSeededRandom(73)
        first.next()
        first.next()
        const resumed = createPathwardenSeededRandom(first.state)
        expect(resumed.next()).toBe(first.next())
        expect(resumed.state).toBe(first.state)
    })
})
