import { describe, expect, it, vi } from 'vitest'
import {
    createPathwardenMapPlan,
    createPathwardenSeededRandom,
    hashPathwardenMapPlan,
    serializePathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map'

// A march is resumed from the plan stored on its run row, so the plan has to
// survive storage and regenerate identically from its seed.
describe('Pathwarden seeded map model', () => {
    it('round-trips through JSON without changing canonical output', () => {
        const plan = createPathwardenMapPlan({ seed: 4_294_967_295, realm: 5 })
        const restored = JSON.parse(JSON.stringify(plan))
        expect(serializePathwardenMapPlan(restored)).toBe(serializePathwardenMapPlan(plan))
    })

    it('regenerates an identical plan from the same seed and realm', () => {
        // Determinism can only break in seed-independent ways (global randomness,
        // Map iteration order), so a handful of seeds proves it as well as a sweep.
        for (const seed of [0, 7, 571]) {
            const options = { seed, realm: seed % 5 + 1 }
            expect(hashPathwardenMapPlan(createPathwardenMapPlan(options)), `seed ${seed}`)
                .toBe(hashPathwardenMapPlan(createPathwardenMapPlan(options)))
        }
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
