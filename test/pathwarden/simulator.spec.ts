import { describe, expect, it } from 'vitest'
import {
    pathwardenRouteHealthMultiplier,
    runPathwardenSimulations
} from '../../shared/utils/gamelogic/pathwarden-simulator'

describe('Pathwarden software simulator', () => {
    it('scales route health sub-linearly and caps extreme roads', () => {
        expect(pathwardenRouteHealthMultiplier(8)).toBeLessThan(pathwardenRouteHealthMultiplier(20))
        expect(pathwardenRouteHealthMultiplier(20)).toBeLessThan(pathwardenRouteHealthMultiplier(40))
        expect(pathwardenRouteHealthMultiplier(1000)).toBe(1.55)
    })

    it('runs the requested deterministic population', () => {
        const left = runPathwardenSimulations({
            difficulty: 2,
            strategy: 'balanced',
            runs: 1000,
            seed: 42
        })
        const right = runPathwardenSimulations({
            difficulty: 2,
            strategy: 'balanced',
            runs: 1000,
            seed: 42
        })
        expect(left).toEqual(right)
        expect(left.runs).toBe(1000)
        expect(left.waves).toHaveLength(12)
    })

    it('makes high difficulty materially harder', () => {
        const easy = runPathwardenSimulations({
            difficulty: 1,
            strategy: 'balanced',
            runs: 1000,
            seed: 73
        })
        const hard = runPathwardenSimulations({
            difficulty: 5,
            strategy: 'balanced',
            runs: 1000,
            seed: 73
        })
        expect(easy.successRate).toBeGreaterThan(hard.successRate)
        expect(easy.averageFinalLives).toBeGreaterThan(hard.averageFinalLives)
    })

    it('models aether preservation as a distinct doctrine', () => {
        const reserve = runPathwardenSimulations({
            difficulty: 2,
            strategy: 'aether-reserve',
            runs: 1000,
            seed: 91
        })
        const rush = runPathwardenSimulations({
            difficulty: 2,
            strategy: 'damage-rush',
            runs: 1000,
            seed: 91
        })
        expect(reserve.averageAetherPreserved).not.toBe(rush.averageAetherPreserved)
        expect(reserve.upgradePriorities).toContain('Interest')
        expect(rush.upgradePriorities).not.toContain('Interest')
    })
})
