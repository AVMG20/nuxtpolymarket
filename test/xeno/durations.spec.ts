import { describe, expect, it } from 'vitest'
import {
    ARTIFACT_TYPES,
    breedSecs,
    effectiveGrowTime,
    getEffectValueFor,
    getPlantOrThrow,
    gridGrowSecs,
    xenoSpeedBoost
} from '../../shared/utils/xeno'

describe('XENO durations', () => {
    const plant = getPlantOrThrow('tendril')
    const gridArt = ARTIFACT_TYPES.find(a => a.effects.some(e => e.type === 'grid_speed_boost'))!
    const breederArt = ARTIFACT_TYPES.find(a => a.effects.some(e => e.type === 'breeder_speed_boost'))!

    it('grows from the speed stat, a grid speed artifact and the global speed upgrade', () => {
        const base = effectiveGrowTime({ baseTime: plant.baseTime, speed: 3 })
        expect(gridGrowSecs({ typeId: plant.id, speed: 3 }, null)).toBe(base)

        const boosted = Math.round(base * (1 - getEffectValueFor(gridArt, 'grid_speed_boost')))
        expect(gridGrowSecs({ typeId: plant.id, speed: 3 }, gridArt.id, false, 4))
            .toBe(Math.round(boosted * (1 - xenoSpeedBoost(4))))
    })

    it('breeds in twice the slower parent, ignoring grid artifacts', () => {
        const other = getPlantOrThrow('sprout')
        const base = Math.max(plant.baseTime, other.baseTime) * 2
        expect(breedSecs({ typeId: plant.id }, { typeId: other.id }, gridArt.id)).toBe(base)
        expect(breedSecs({ typeId: plant.id }, { typeId: other.id }, breederArt.id))
            .toBe(Math.round(base * (1 - getEffectValueFor(breederArt, 'breeder_speed_boost'))))
    })

    it('returns null for unknown plants', () => {
        expect(gridGrowSecs({ typeId: 'nope', speed: 0 }, null)).toBeNull()
        expect(breedSecs({ typeId: 'nope' }, { typeId: plant.id })).toBeNull()
    })
})
