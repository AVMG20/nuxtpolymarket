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
//
// HERO QUEST is checked too, on different terms. Its Gold ceiling is *generated*
// from the two economies above, so it tracks them by construction and there is
// no balance question to ask. What there is, is a staleness question: retune
// Colony or Xeno without regenerating GOLD_TENURE_CEILING and the table silently
// describes an economy that no longer exists. That is what the last section
// catches, and it is the reason this script fails on it.

import {
    COLONY_STAGES,
    emitGoldTenureCeiling,
    HERO_QUEST_SAMPLE_DAYS,
    colonyIncomeAtDay,
    colonyStage,
    compareAtEqualDays,
    compareHeroQuestAtEqualDays,
    heroQuestIncomeAtDay,
    platformIncomeAtDay,
    xenoGlobalLevelAt,
    xenoIncomeAtDay,
    xenoStage,
    MAX_RESEARCH_LEVEL
} from './lib/economy-stages'
import {
    GOLD_PLATFORM_DISCOUNT,
    GOLD_REFERENCE_KILLS_PER_HOUR,
    GOLD_TENURE_DAYS
} from '../shared/utils/hero-quest/constants'

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

// ─── Hero Quest ─────────────────────────────────────────────────────────────

console.log('\nhero quest — an account keeping pace, against the platform')

const HQ_TOLERANCE = 0.05
const hqRows = compareHeroQuestAtEqualDays().map((row) => {
    const drift = Math.abs(row.ratio - GOLD_PLATFORM_DISCOUNT) / GOLD_PLATFORM_DISCOUNT
    // The envelope: Hero Quest should be neither the platform's richest idle
    // game nor its poorest. The four series are themselves ~5x apart late on,
    // so this is the only per-game band that means anything.
    const series = [
        colonyIncomeAtDay(row.days, 0),
        colonyIncomeAtDay(row.days, MAX_RESEARCH_LEVEL),
        xenoIncomeAtDay(row.days, () => 0),
        xenoIncomeAtDay(row.days, xenoGlobalLevelAt)
    ]
    const inside = row.heroQuest >= Math.min(...series) && row.heroQuest <= Math.max(...series)
    if (drift > HQ_TOLERANCE) {
        warnings++
        console.log(`WARNING day ${row.days}: hero quest is ${row.ratio.toFixed(3)}x the platform, expected ${GOLD_PLATFORM_DISCOUNT} — regenerate GOLD_TENURE_CEILING`)
    }
    if (!inside) {
        warnings++
        console.log(`WARNING day ${row.days}: hero quest is outside the platform's own income envelope`)
    }
    return {
        day: row.days,
        'hero quest/hr': compact(row.heroQuest),
        'platform/hr': compact(row.platform),
        ratio: `${row.ratio.toFixed(3)}x`,
        envelope: inside ? 'inside' : 'OUT'
    }
})
console.table(hqRows)
console.log(`Designed ratio is GOLD_PLATFORM_DISCOUNT = ${GOLD_PLATFORM_DISCOUNT}; drift past ${HQ_TOLERANCE * 100}% means the`)
console.log('generated ceiling table is stale. Regenerate it from this file\'s own functions.\n')

// Interpolation accuracy: the rungs sit on Colony/Xeno stage boundaries, so the
// table should follow the curve between them and not just at them.
let worstSag = 1
let worstDay = 0
for (let i = 1; i <= 4000; i++) {
    const day = (i / 4000) * (HERO_QUEST_SAMPLE_DAYS.at(-1) ?? 230)
    const sag = heroQuestIncomeAtDay(day) / (platformIncomeAtDay(day) * GOLD_PLATFORM_DISCOUNT)
    if (sag < worstSag) { worstSag = sag; worstDay = day }
}
if (worstSag < 1 - HQ_TOLERANCE) {
    warnings++
    console.log(`WARNING ceiling table sags to ${worstSag.toFixed(3)} of the curve at day ${worstDay.toFixed(2)} — add a rung there`)
} else {
    console.log(`ceiling table follows the platform curve between rungs: worst ${worstSag.toFixed(3)} at day ${worstDay.toFixed(2)}\n`)
}

// ─── Regenerating the ceiling ───────────────────────────────────────────────
// `--emit-hq-ceiling` prints the table rather than checking it, so "regenerate,
// never hand-edit" is a command someone can run. The rungs themselves are not
// emitted: they sit on Colony habitat and Xeno tier boundaries, which move only
// when those games gain or lose a stage.

if (process.argv.includes('--emit-hq-ceiling')) {
    const emitted = emitGoldTenureCeiling(GOLD_TENURE_DAYS)
    console.log(`\nGOLD_TENURE_CEILING regenerated at ${GOLD_REFERENCE_KILLS_PER_HOUR} kills/hour`)
    console.log('Paste into shared/utils/hero-quest/constants.ts:\n')
    console.log('export const GOLD_TENURE_CEILING: readonly number[] = [')
    console.log(`    ${emitted.join(', ')}`)
    console.log(']\n')
}

console.log(warnings === 0
    ? '\nOK — every stage inside its band'
    : `\n${warnings} stage(s) outside band — retune before shipping`)
