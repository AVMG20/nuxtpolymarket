import {
    PLANT_TYPES,
    ARTIFACT_TYPES,
    effectiveGrowTime,
    getEffectValueFor,
    xenoSpeedBoost,
    xenoYieldBonus
} from '../shared/utils/xeno'

function hourlyIncome(plant: typeof PLANT_TYPES[number], speedLevel: number, yieldLevel: number): number {
    const growSeconds = effectiveGrowTime(plant) * (1 - xenoSpeedBoost(speedLevel))
    const averageHarvest = 1 + plant.yield / 2 + xenoYieldBonus(yieldLevel)
    return plant.value * averageHarvest * (3600 / growSeconds)
}

function bestArtifactIncome(plant: typeof PLANT_TYPES[number]): number {
    const gridArtifacts = ARTIFACT_TYPES.filter(artifact => artifact.effects.some(effect => effect.type.startsWith('grid_')))
    return Math.max(...gridArtifacts.map((artifact) => {
        const artifactSpeed = getEffectValueFor(artifact, 'grid_speed_boost', true)
        const artifactYield = getEffectValueFor(artifact, 'grid_yield_bonus', true)
        const growSeconds = effectiveGrowTime(plant) * (1 - xenoSpeedBoost(10)) * (1 - artifactSpeed)
        const averageHarvest = 1 + plant.yield / 2 + xenoYieldBonus(10) + artifactYield
        return plant.value * averageHarvest * (3600 / growSeconds)
    }))
}

function compact(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

const tiers = [...new Set(PLANT_TYPES.map(plant => plant.tier))].sort((a, b) => a - b)
const rows = tiers.map((tier) => {
    const plants = PLANT_TYPES.filter(plant => plant.tier === tier)
    const base = plants.map(plant => hourlyIncome(plant, 0, 0))
    const maxed = plants.map(plant => hourlyIncome(plant, 10, 10))
    const maxBuild = plants.map(plant => bestArtifactIncome(plant))
    return {
        tier: `T${tier}`,
        plants: plants.length,
        'base avg/slot/hr': compact(base.reduce((sum, income) => sum + income, 0) / base.length),
        'base best/slot/hr': compact(Math.max(...base)),
        'max global avg/slot/hr': compact(maxed.reduce((sum, income) => sum + income, 0) / maxed.length),
        'max global best/slot/hr': compact(Math.max(...maxed)),
        'max build avg/slot/hr': compact(maxBuild.reduce((sum, income) => sum + income, 0) / maxBuild.length),
        'max build best/slot/hr': compact(Math.max(...maxBuild))
    }
})

console.log('XENO estimated sell income by tier (continuous harvesting; max build chooses the best gem-crafted grid artifact)')
console.table(rows)
