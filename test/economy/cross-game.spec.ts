import { describe, expect, it } from 'vitest'
import {
    colonyIncomeAtDay,
    colonyStage,
    compareAtEqualDays,
    compareHeroQuestAtEqualDays,
    heroQuestIncomeAtDay,
    heroQuestIncomeAt,
    platformIncomeAtDay,
    xenoGlobalLevelAt,
    xenoIncomeAtDay,
    xenoStage,
    COLONY_STAGES,
    HERO_QUEST_SAMPLE_DAYS,
    MAX_RESEARCH_LEVEL
} from '../../scripts/lib/economy-stages'
import { GOLD_PLATFORM_DISCOUNT } from '../../shared/utils/hero-quest/constants'

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

/**
 * HERO QUEST against the platform at equal account age.
 *
 * Not a balance check. Hero Quest's Gold ceiling is *generated* from the two
 * economies above (`docs/games/hero-quest/gold-economy.md` §3a), so it tracks
 * them by construction — asserting that it does would be asserting arithmetic.
 *
 * What this catches is the one way a generated table goes wrong: **silently**.
 * Retune Colony or Xeno, forget to regenerate `GOLD_TENURE_CEILING`, and the
 * table keeps describing an economy that no longer exists. Nothing in the game
 * would fail; income would simply drift away from the platform. These specs
 * fail instead.
 */
describe('hero quest vs the platform at equal account age', () => {
    /** Generated-table drift shows up well under this; real staleness blows past it. */
    const TOLERANCE = 0.05

    it('pays the designed fraction of platform income at every age', () => {
        const rows = compareHeroQuestAtEqualDays()
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            expect(Math.abs(row.ratio - GOLD_PLATFORM_DISCOUNT) / GOLD_PLATFORM_DISCOUNT)
                .toBeLessThan(TOLERANCE)
        }
    })

    it('follows the platform curve between rungs, not only on them', () => {
        // The rungs sit on Colony habitat and Xeno tier boundaries because that
        // is where the curve bends. Evenly-spaced rungs sagged 22% mid-span;
        // this is the guard that keeps whoever regenerates them honest.
        let worst = 1
        for (let i = 1; i <= 2000; i++) {
            const day = (i / 2000) * (HERO_QUEST_SAMPLE_DAYS.at(-1) ?? 230)
            worst = Math.min(worst, heroQuestIncomeAtDay(day) / (platformIncomeAtDay(day) * GOLD_PLATFORM_DISCOUNT))
        }
        expect(worst).toBeGreaterThan(1 - TOLERANCE)
    })

    it('is never the platform\'s richest idle game, nor its poorest', () => {
        // The four series are ~5x apart late on, so no single game can sit
        // within 2.5x of all of them. Staying inside the envelope is the only
        // per-game band that means anything here.
        for (const day of HERO_QUEST_SAMPLE_DAYS) {
            const series = [
                colonyIncomeAtDay(day, 0),
                colonyIncomeAtDay(day, MAX_RESEARCH_LEVEL),
                xenoIncomeAtDay(day, () => 0),
                xenoIncomeAtDay(day, xenoGlobalLevelAt)
            ]
            const income = heroQuestIncomeAtDay(day)
            expect(income).toBeGreaterThanOrEqual(Math.min(...series))
            expect(income).toBeLessThanOrEqual(Math.max(...series))
        }
    })

    it('sits below the platform rather than at parity', () => {
        // The ceiling binds for most of an invested account's life, so parity
        // here would be parity overall. The gap is deliberate.
        expect(GOLD_PLATFORM_DISCOUNT).toBeLessThan(1)
        expect(heroQuestIncomeAtDay(90)).toBeLessThan(platformIncomeAtDay(90))
    })

    it('pays a stalled account less than one keeping pace', () => {
        // Progression below the ceiling is the designed cost of falling behind,
        // and the reason the progression term exists alongside the ceiling.
        const stalled = heroQuestIncomeAt(90, 1, 1, 1)
        expect(stalled).toBeLessThan(heroQuestIncomeAtDay(90))
        // ...and an account that has outrun the calendar is capped, not paid.
        expect(heroQuestIncomeAt(90, 20, 10, 10)).toBeCloseTo(heroQuestIncomeAtDay(90), 6)
    })
})
