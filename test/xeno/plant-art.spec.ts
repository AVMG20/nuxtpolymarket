import { describe, expect, it } from 'vitest'
import { getPlantArt, plantGenome, plantGrowScale, plantStageForProgress } from '../../shared/utils/xeno'

// Only the logic around the plant art: the icon's fallback and the growth
// stages. The drawings themselves are checked by eye, not by tests.
describe('xeno plant art', () => {
    it('returns null for unknown ids so the icon falls back', () => {
        for (const id of [null, undefined, '', 'not-a-plant', 'hybrid:', 'hybrid:nope~1~1']) {
            expect(plantGenome(id)).toBeNull()
            expect(getPlantArt(id)).toBeNull()
        }
        // Unknown resources inside a hybrid are skipped.
        expect(plantGenome('hybrid:nope~1~1+bloom~1~1')!.genes.map(g => g.id)).toEqual(['bloom'])
    })

    it('maps progress to stages and a growth scale', () => {
        expect(plantStageForProgress(0)).toBe('seedling')
        expect(plantStageForProgress(0.5)).toBe('growing')
        expect(plantStageForProgress(1)).toBe('ready')
        expect(plantGrowScale('ready', 0.3)).toBe(1)
        expect(plantGrowScale('growing')).toBe(1)
        expect(plantGrowScale('seedling', 0)).toBeLessThan(plantGrowScale('seedling', 0.1))
        expect(plantGrowScale('growing', 0.3)).toBeLessThan(plantGrowScale('growing', 0.9))
        expect(plantGrowScale('growing', 2)).toBe(1)
    })
})
