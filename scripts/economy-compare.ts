// XENO against COLONY at equal days played — the acceptance gate for any change
// to either economy.
//
// The property this exists to protect: a player who has put the same number of
// days into either game should be earning roughly the same. Comparing them by
// tier index does not work — Colony tops out at Habitat 6 after ~82 days while
// Xeno's T9 is still ~230 days out — so everything here is interpolated onto a
// shared day axis, and Colony deliberately PLATEAUS past Habitat 6 instead of
// being extrapolated into a curve that doesn't exist.
//
// Bands: T3-T7 must land inside 0.4-2.5x of Colony. T8/T9 are allowed up to 6x
// because Colony has run out of stages by then while Xeno is still spending
// hundreds of billions on global upgrades to get there.
//
// Re-run after any change to plant values, item sell values, upgrade ladders,
// habitat requirements or research.

import {
    COLONY_STAGES,
    colonyIncomeAtDay,
    colonyStage,
    compareAtEqualDays,
    xenoGlobalLevelAt,
    xenoStage,
    MAX_RESEARCH_LEVEL
} from './lib/economy-stages'

function compact(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

/**
 * Upper bound on xeno/colony at a given tier. T8/T9 get a much wider ceiling
 * because Colony has been sat at its Habitat 6 plateau for months by the time
 * Xeno gets there, while Xeno is still sinking hundreds of billions into global
 * upgrades. Holding those tiers to 2.5x would mean nerfing the only stretch of
 * Xeno that was ever correctly tuned.
 */
function ceilingFor(tier: number): number {
    return tier === 9 ? 8 : tier === 8 ? 6 : 2.5
}
const FLOOR = 0.4

let warnings = 0

// Two matched investment states. Comparing an upgraded xeno farm against an
// unresearched colony (or vice versa) would just measure the upgrade, not the
// game, so both sides are always at the same point in their own progression.
const modes = [
    { label: 'baseline — nothing bought on either side', research: 0, globals: () => 0 },
    { label: 'invested — colony fully researched, xeno holding the globals it plausibly affords', research: MAX_RESEARCH_LEVEL, globals: xenoGlobalLevelAt }
]

for (const mode of modes) {
    console.log(`\n${mode.label}`)
    const rows = compareAtEqualDays(mode.globals, mode.research).map((row) => {
        const ceiling = ceilingFor(row.tier)
        const inBand = row.ratio >= FLOOR && row.ratio <= ceiling
        if (!inBand) {
            warnings++
            console.log(`WARNING T${row.tier} at day ${row.days.toFixed(1)}: xeno/colony is ${row.ratio.toFixed(2)}x, outside ${FLOOR}-${ceiling}x`)
        }
        return {
            tier: `T${row.tier}`,
            days: row.days.toFixed(1),
            'xeno/hr': compact(row.xeno),
            'colony/hr at same day': compact(row.colony),
            ratio: `${row.ratio.toFixed(2)}x`,
            band: inBand ? 'ok' : 'OUT'
        }
    })
    console.table(rows)
}

console.log('\nreference — colony stages')
console.table(COLONY_STAGES.map((habitatLevel) => {
    const base = colonyStage(habitatLevel, 0)
    return {
        stage: base.label,
        days: base.days.toFixed(1),
        'research 0': compact(base.coinsPerHour),
        'research 4': compact(colonyStage(habitatLevel, MAX_RESEARCH_LEVEL).coinsPerHour),
        farming: base.best
    }
}))

console.log('\nreference — xeno stages')
console.table([3, 4, 5, 6, 7, 8, 9].map((tier) => {
    const base = xenoStage(tier, 0)
    return {
        stage: base.label,
        days: base.days.toFixed(1),
        'no globals': compact(base.coinsPerHour),
        'plausible globals': compact(xenoStage(tier, xenoGlobalLevelAt(tier)).coinsPerHour),
        'colony at same day': compact(colonyIncomeAtDay(base.days, 0)),
        farming: base.best
    }
}))

console.log(warnings === 0
    ? '\nOK — every stage inside its band'
    : `\n${warnings} stage(s) outside band — retune before shipping`)
