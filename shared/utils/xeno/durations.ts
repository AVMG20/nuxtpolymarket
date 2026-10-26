import { getArtifact, getEffectValueFor } from './artifacts'
import { getPlantDisplay } from './hybrids'
import { breedDuration, effectiveGrowTime, getPlant } from './plants'
import { xenoSpeedBoost } from './upgrades'

/**
 * Grow time in seconds for a planted instance: its speed stat, a grid speed
 * artifact on the slot and the global speed upgrade. Null for an unknown type.
 * The server wraps this with dev mode; the client uses it to show a timer
 * before the plant request returns.
 */
export function gridGrowSecs(
    plant: { typeId: string; speed: number },
    artifactTypeId: string | null | undefined,
    gemCrafted = false,
    globalSpeedLevel = 0
): number | null {
    const base = getPlantDisplay(plant.typeId)
    if (!base) return null
    let secs = effectiveGrowTime({ baseTime: base.baseTime, speed: plant.speed })
    const art = artifactTypeId ? getArtifact(artifactTypeId) : undefined
    if (art) {
        const speedBoost = getEffectValueFor(art, 'grid_speed_boost', gemCrafted)
        if (speedBoost > 0) secs = Math.round(secs * (1 - speedBoost))
    }
    return Math.round(secs * (1 - xenoSpeedBoost(globalSpeedLevel)))
}

/** Breed time in seconds from the parents, a breeder speed artifact and the global speed upgrade. Null for an unknown parent. */
export function breedSecs(
    p1: { typeId: string },
    p2: { typeId: string },
    artifactTypeId?: string | null,
    gemCrafted = false,
    globalSpeedLevel = 0
): number | null {
    const t1 = getPlant(p1.typeId)
    const t2 = getPlant(p2.typeId)
    if (!t1 || !t2) return null
    let secs = breedDuration({ baseTime: t1.baseTime }, { baseTime: t2.baseTime })
    const art = artifactTypeId ? getArtifact(artifactTypeId) : undefined
    if (art) {
        const speedBoost = getEffectValueFor(art, 'breeder_speed_boost', gemCrafted)
        if (speedBoost > 0) secs = Math.round(secs * (1 - speedBoost))
    }
    return Math.round(secs * (1 - xenoSpeedBoost(globalSpeedLevel)))
}
