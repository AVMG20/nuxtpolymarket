import {
    BUG_TYPES,
    avgTickYield,
    deriveTrackModifiers,
    effectiveTickMs,
    getItem,
    socialSpeedBonusPct
} from '../shared/utils/colony'

function hourlyIncome(type: typeof BUG_TYPES[number], maxGlobal: boolean): number {
    const levels = maxGlobal ? { yield_boost: 12, speed_boost: 8 } : {}
    const modifiers = deriveTrackModifiers(levels)
    const averageSpeed = 12.5
    const averageYield = (type.yieldMin + type.yieldMax) / 2
    const intendedGroupSize = type.social ? 4 : 1
    const tickMs = effectiveTickMs(
        { typeId: type.id, speed: averageSpeed },
        modifiers.speedBonusPct + socialSpeedBonusPct(type.id, intendedGroupSize)
    )
    const sellValue = getItem(type.itemId)?.sellValue ?? 0
    return avgTickYield(averageYield + modifiers.yieldLevelBonus) * sellValue * (3_600_000 / tickMs)
}

function compact(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

const coinBugs = BUG_TYPES.filter(type => !type.producesGems)
const tiers = [...new Set(coinBugs.map(type => type.tier))].sort((a, b) => a - b)
const rows = tiers.map((tier) => {
    const bugs = coinBugs.filter(type => type.tier === tier)
    const base = bugs.map(type => hourlyIncome(type, false))
    const maxed = bugs.map(type => hourlyIncome(type, true))
    return {
        tier: `T${tier}`,
        species: bugs.length,
        'base avg/slot/hr': compact(base.reduce((sum, income) => sum + income, 0) / base.length),
        'base best/slot/hr': compact(Math.max(...base)),
        'max global avg/slot/hr': compact(maxed.reduce((sum, income) => sum + income, 0) / maxed.length),
        'max global best/slot/hr': compact(Math.max(...maxed))
    }
})

console.log('COLONY estimated sell income by tier (continuous nutrition, intended social setup, no gem-feed buff)')
console.table(rows)
