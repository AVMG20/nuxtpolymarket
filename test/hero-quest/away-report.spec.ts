/**
 * The welcome-back card's report: written by every offline settle onto `hq_state.away_report`,
 * summed until the player puts it away, so a read whose response is dropped can't lose it.
 *
 * The database half needs the local Postgres from .env, and skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqState } from '#server/database/schema'
import { dismissAwayReport, ensureHqState, settleHq } from '#server/utils/hero-quest'
import { mergeAwayReports, type HqAwayReport } from '#shared/utils/hero-quest/away-report'
import { ONLINE_THRESHOLD_MS } from '#shared/utils/hero-quest/constants'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

function report(over: Partial<HqAwayReport> = {}): HqAwayReport {
    return {
        id: 'a',
        kills: 10,
        goldEarned: 100,
        xpEarned: '1000',
        levelsGained: 1,
        heroLevel: 5,
        awaySeconds: 3600,
        effectiveSeconds: 1800,
        lostToCapSeconds: 0,
        blockedAtBoss: false,
        wipedOnWave: false,
        offline: { cappedSeconds: 3600, capSeconds: 28_800, boostedSeconds: 60, boostMultiplier: 2, efficiency: 0.5, capLevel: 0, efficiencyLevel: 0 },
        from: { prestige: 0, world: 1, stage: 1, killsInStage: 0 },
        to: { prestige: 0, world: 1, stage: 3, killsInStage: 2 },
        ...over
    }
}

describe('mergeAwayReports', () => {
    it('starts from the new window when nothing is pending', () => {
        const next = report()
        expect(mergeAwayReports(null, next)).toBe(next)
    })

    it('sums the totals, keeps where the run started and takes the rest from the new window', () => {
        const pending = report({ lostToCapSeconds: 600 })
        const next = report({
            id: 'b', heroLevel: 7, levelsGained: 2, xpEarned: '1e400', lostToCapSeconds: 300, blockedAtBoss: true,
            from: pending.to, to: { prestige: 0, world: 1, stage: 5, killsInStage: 0 }
        })
        const merged = mergeAwayReports(pending, next)
        expect(merged).toMatchObject({
            id: 'b', kills: 20, goldEarned: 200, levelsGained: 3, heroLevel: 7, awaySeconds: 7200,
            effectiveSeconds: 3600, lostToCapSeconds: 900, blockedAtBoss: true, from: pending.from, to: next.to
        })
        expect(merged.offline).toMatchObject({ cappedSeconds: 7200, boostedSeconds: 120, efficiency: 0.5 })
        // big numbers stay Decimal through the sum
        expect(merged.xpEarned).toBe('1e400')
    })
})

describe.skipIf(SKIP)('the welcome-back report, through the database', () => {
    const USER_ID = 'test-hero-quest-away-report-user'

    async function cleanup() {
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }

    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    async function settleWindow(seconds: number) {
        await db.update(hqState).set({ lastSettledAt: new Date(Date.now() - seconds * 1000) }).where(eq(hqState.userId, USER_ID))
        return settleHq(USER_ID)
    }

    const OFFLINE_SECONDS = ONLINE_THRESHOLD_MS / 1000 * 4

    it('keeps an offline window\'s report on the row', async () => {
        const { result, state } = await settleWindow(OFFLINE_SECONDS)
        expect(result!.kills).toBeGreaterThan(0)
        expect(state.awayReport).toMatchObject({ kills: result!.kills, goldEarned: result!.goldEarned })
        expect(state.awayReport!.awaySeconds).toBeCloseTo(OFFLINE_SECONDS, 0)
    })

    it('writes nothing for an online window', async () => {
        const { state } = await settleWindow(60)
        expect(state.awayReport).toBeNull()
    })

    it('adds a second offline window to the report still waiting', async () => {
        const first = await settleWindow(OFFLINE_SECONDS)
        const second = await settleWindow(OFFLINE_SECONDS)
        expect(second.state.awayReport!.kills).toBe(first.result!.kills + second.result!.kills)
        expect(second.state.awayReport!.id).not.toBe(first.state.awayReport!.id)
    })

    it('clears the report the player put away, but not one a later window replaced', async () => {
        const first = await settleWindow(OFFLINE_SECONDS)
        const second = await settleWindow(OFFLINE_SECONDS)
        await dismissAwayReport(USER_ID, first.state.awayReport!.id)
        let [row] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
        expect(row!.awayReport!.id).toBe(second.state.awayReport!.id)

        await dismissAwayReport(USER_ID, second.state.awayReport!.id);
        [row] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
        expect(row!.awayReport).toBeNull()
    })
})
