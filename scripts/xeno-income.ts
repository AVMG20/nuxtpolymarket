// XENO income by plant tier, whole-farm (36 grid tiles) and net of replanting.
//
// The properties the numbers in shared/utils/xeno/ are fitted to:
//  1. Net income climbs a steady 2.5-5x per tier all the way from T1 to T9.
//     It used to be flat through T7 and then jump 40x into T8, which made every
//     tier below the endgame pointless to actually farm.
//  2. No lower-tier plant ever out-earns the best plant of the highest tier a
//     player has unlocked. The global yield upgrade is a FLAT +N plants per
//     harvest, which disproportionately favours short-cycle plants, so a cheap
//     3-minute T1 filler can overtake a real crop if values drift.
//  3. Every global upgrade level costs a sane number of hours of the income a
//     player actually has when buying it.
//
// NET, not gross: harvesting deletes the planted instance, so one plant per
// cycle goes back into the ground and never reaches the market.
//
// Re-run after touching plant values, grow times, or XENO_UPGRADE_TRACKS.
// Cross-check against COLONY with `bun run balance:compare`.

import {
    XENO_TIERS,
    xenoBestPlant,
    xenoDaysForTier,
    xenoGlobalLevelAt,
    xenoStage,
    xenoTileIncome
} from './lib/economy-stages'
import {
    ARTIFACT_TYPES,
    PLANT_TYPES,
    XENO_MAX_GRID_SLOTS,
    XENO_UPGRADE_MAX_LEVEL,
    XENO_UPGRADE_TRACKS,
    getEffectValueFor
} from '../shared/utils/xeno'

function compact(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

/** Best gem-crafted grid artifact for this plant — the strongest sustainable build. */
function bestArtifactIncome(tier: number, globalLevel: number): number {
    const gridArtifacts = ARTIFACT_TYPES.filter(artifact => artifact.effects.some(effect => effect.type.startsWith('grid_')))
    const plants = PLANT_TYPES.filter(plant => plant.tier <= tier)
    return Math.max(...gridArtifacts.flatMap(artifact => plants.map(plant => xenoTileIncome(
        plant,
        globalLevel,
        getEffectValueFor(artifact, 'grid_yield_bonus', true),
        getEffectValueFor(artifact, 'grid_speed_boost', true)
    ))))
}

const rows = XENO_TIERS.map((tier) => {
    const plausible = xenoGlobalLevelAt(tier)
    const base = xenoStage(tier, 0)
    const now = xenoStage(tier, plausible)
    const maxed = xenoStage(tier, XENO_UPGRADE_MAX_LEVEL)
    return {
        tier: `T${tier}`,
        days: base.days.toFixed(1),
        plant: xenoBestPlant(tier, 0)?.plant.name ?? '—',
        'no upgrades': compact(base.coinsPerHour),
        'plausible globals': `L${plausible.toFixed(0)} — ${compact(now.coinsPerHour)}`,
        'global maxed': compact(maxed.coinsPerHour),
        'best build': compact(bestArtifactIncome(tier, XENO_UPGRADE_MAX_LEVEL) * XENO_MAX_GRID_SLOTS)
    }
})

console.log(`XENO coins/hr across all ${XENO_MAX_GRID_SLOTS} grid tiles, net of the plant replanted each cycle`)
console.table(rows)

const climb = XENO_TIERS.slice(1).map((tier) => {
    const previous = xenoStage(tier - 1, 0).coinsPerHour
    const current = xenoStage(tier, 0).coinsPerHour
    const ratio = current / previous
    if (ratio < 2.5 || ratio > 5) {
        console.log(`WARNING T${tier - 1} -> T${tier} is ${ratio.toFixed(2)}x, outside the intended 2.5-5x climb`)
    }
    return { step: `T${tier - 1} -> T${tier}`, ratio: `${ratio.toFixed(2)}x`, 'days added': xenoDaysForTier(tier).toFixed(1) }
})
console.table(climb)

// A lower-tier plant winning here means the flat yield bonus has outgrown the
// value curve and the best farm is a cheap fast filler, not a real crop.
for (const globalLevel of [0, 5, XENO_UPGRADE_MAX_LEVEL]) {
    for (const tier of XENO_TIERS) {
        const best = xenoBestPlant(tier, globalLevel)
        if (best && best.plant.tier !== tier) {
            console.log(`WARNING at T${tier}/global ${globalLevel} the best plant is ${best.plant.name} (T${best.plant.tier}) — a lower tier out-earns the current one`)
        }
    }
}

// Upgrade ladders priced in hours of the income a player has at that level.
const upgradeRows = XENO_UPGRADE_TRACKS.flatMap(track => track.costs.map((cost, index) => {
    const level = index + 1
    // Tier a player is plausibly on when buying this level.
    const tier = Math.min(9, 4 + Math.floor(index / 2))
    const income = xenoStage(tier, index).coinsPerHour
    const hours = cost / income
    if (hours > 400) {
        console.log(`WARNING ${track.id} L${level} costs ${hours.toFixed(0)}h of income at T${tier} — over the 400h ceiling`)
    }
    return { track: track.id, level, cost: compact(cost), 'assumed tier': `T${tier}`, 'income/hr': compact(income), hours: hours.toFixed(0) }
}))
console.table(upgradeRows)
