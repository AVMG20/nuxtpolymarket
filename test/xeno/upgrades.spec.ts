import { describe, expect, it } from 'vitest'
import {
    ARTIFACT_TYPES,
    PLANT_TYPES,
    XENO_UPGRADE_TRACKS,
    getEffectValue,
    getPlantOrThrow,
    xenoMutationBoost,
    xenoSpeedBoost,
    xenoUpgradeCost,
    xenoYieldBonus
} from '../../shared/utils/xeno'

describe('XENO global upgrades', () => {
    it('caps the three global tracks at their intended bonuses', () => {
        expect(xenoMutationBoost(10)).toBe(0.10)
        expect(xenoYieldBonus(10)).toBe(10)
        expect(xenoSpeedBoost(10)).toBe(0.50)
        expect(XENO_UPGRADE_TRACKS.every(track => track.maxLevel === 10)).toBe(true)
    })

    it('makes the final yield level cost 500 billion', () => {
        expect(xenoUpgradeCost('yield', 9)).toBe(500_000_000_000)
        expect(xenoUpgradeCost('yield', 10)).toBeNull()
    })

    it('makes the final speed level cost 250 billion', () => {
        expect(xenoUpgradeCost('speed', 9)).toBe(250_000_000_000)
        expect(xenoUpgradeCost('speed', 10)).toBeNull()
    })

    it('gives every existing mutation artifact one additional mutation level', () => {
        const mutationArtifacts = ARTIFACT_TYPES.filter(artifact => artifact.effects.some(effect => effect.type === 'breeder_mutation_boost'))
        expect(mutationArtifacts.length).toBeGreaterThan(0)
        expect(Math.min(...mutationArtifacts.map(artifact => getEffectValue(artifact, 'breeder_mutation_boost')))).toBe(0.10)
    })
})

describe('XENO upper tiers', () => {
    it('adds five plants to both T8 and T9', () => {
        expect(PLANT_TYPES.filter(plant => plant.tier === 8)).toHaveLength(5)
        expect(PLANT_TYPES.filter(plant => plant.tier === 9)).toHaveLength(5)
        expect(getPlantOrThrow('omega-core').yield).toBe(9)
    })

    it('adds a Tier V artifact to every family using both T8 and T9 plants', () => {
        const tierFiveArtifacts = ARTIFACT_TYPES.filter(artifact => artifact.level === 5)
        expect(tierFiveArtifacts).toHaveLength(6)
        for (const artifact of tierFiveArtifacts) {
            const costTiers = artifact.cost.map(cost => getPlantOrThrow(cost.plantTypeId).tier)
            expect(costTiers).toContain(8)
            expect(costTiers).toContain(9)
        }
    })
})
