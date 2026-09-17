import { describe, expect, it } from 'vitest'
import {
    colonyIncomeAtDay,
    colonyStage,
    compareAtEqualDays,
    xenoGlobalLevelAt,
    xenoStage,
    COLONY_STAGES,
    MAX_RESEARCH_LEVEL
} from '../../scripts/lib/economy-stages'

/**
 * XENO against COLONY at equal days played.
 *
 * Tier index is not a fair axis — Colony finishes at Habitat 6 around day 82
 * while Xeno's T9 is still 150 days further out — so everything here compares
 * income at the same number of DAYS. This is the guard for the whole rebalance:
 * before it, a T6-T7 xeno farm (weeks of breeding) earned ~40x less than the
 * colony a player could have built in the same time.
 */
describe('xeno vs colony at equal days played', () => {
    // Both sides at the same point in their own progression. Comparing an
    // upgraded farm against an unupgraded colony would measure the upgrade.
    const modes = [
        { name: 'baseline', research: 0, globals: () => 0 },
        { name: 'invested', research: MAX_RESEARCH_LEVEL, globals: xenoGlobalLevelAt }
    ]

    // T8/T9 get a wider ceiling: Colony has been sat at its Habitat 6 plateau
    // for months by then, while Xeno is still spending hundreds of billions on
    // global upgrades to reach those tiers at all.
    const ceilingFor = (tier: number) => (tier === 9 ? 8 : tier === 8 ? 6 : 2.5)

    for (const mode of modes) {
        it(`keeps every tier inside its band (${mode.name})`, () => {
            const rows = compareAtEqualDays(mode.globals, mode.research)
            expect(rows.length).toBeGreaterThan(0)
            for (const row of rows) {
                expect(row.ratio).toBeGreaterThanOrEqual(0.4)
                expect(row.ratio).toBeLessThanOrEqual(ceilingFor(row.tier))
            }
        })
    }

    it('plateaus colony past habitat 6 rather than extrapolating it', () => {
        const last = colonyStage(COLONY_STAGES[COLONY_STAGES.length - 1]!, 0)
        expect(colonyIncomeAtDay(last.days * 3, 0)).toBe(last.coinsPerHour)
    })

    it('takes longer to reach xeno T9 than to finish colony', () => {
        // The bands above are only fair if xeno really is the longer game —
        // if that stops being true, the wider T8/T9 ceiling stops being earned.
        const colonyEnd = colonyStage(6, 0).days
        expect(xenoStage(9, 0).days).toBeGreaterThan(colonyEnd)
    })
})
