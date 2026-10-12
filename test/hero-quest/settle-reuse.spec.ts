/**
 * `settleHq` hands back the shop levels and collection it already read inside its lock, so
 * `state.get.ts` does not run those two queries a second time.
 *
 * Two properties are worth pinning, and neither is "it is faster":
 *
 * 1. **The handed-back rows are the real rows.** A reuse that returns something subtly different
 *    from a fresh fetch would be a silent correctness bug in every payload the client renders.
 * 2. **The no-op path returns them as `undefined`.** That is the whole reason the fields are
 *    optional, and the caller's `?? getShopLevels(...)` fallback only earns its keep if this path
 *    genuinely omits them. If a later refactor makes the settle always populate them, the
 *    fallback becomes dead code and someone should know.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqShopUpgrades, hqState } from '#server/database/schema'
import { ensureHqState, getCollections, getShopLevels, settleHq } from '#server/utils/hero-quest'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

describe.skipIf(SKIP)('settleHq result reuse', () => {
    const USER_ID = 'test-hero-quest-settle-reuse-user'

    async function cleanup() {
        await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
        await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
        await db.delete(hqState).where(eq(hqState.userId, USER_ID))
        await cleanupUser(USER_ID)
    }

    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
        await ensureHqState(USER_ID)

        // Something in every bucket the endpoint serializes, so an empty-vs-empty comparison
        // cannot pass by accident.
        await db.insert(hqCollection).values([
            { userId: USER_ID, system: 'gear', contentId: 'gear_weapon_rare', star: 1, level: 3, dupeProgress: 2 },
            { userId: USER_ID, system: 'champion', contentId: 'champ_kaira', star: 0, level: 1, dupeProgress: 0 },
            { userId: USER_ID, system: 'skill', contentId: 'skill_coin_toss', star: 2, level: 5, dupeProgress: 1 }
        ])
        await db.insert(hqShopUpgrades).values({ userId: USER_ID, upgradeId: 'championSlots', level: 2 })
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    /** Force a settle to have real elapsed time to work with. */
    async function rewind(seconds: number) {
        await db.update(hqState)
            .set({ lastSettledAt: new Date(Date.now() - seconds * 1000) })
            .where(eq(hqState.userId, USER_ID))
    }

    it('hands back the shop levels a fresh query would return', async () => {
        await rewind(120)
        const outcome = await settleHq(USER_ID)

        expect(outcome.shopLevels).toBeDefined()
        expect(outcome.shopLevels).toEqual(await getShopLevels(USER_ID))
        expect(outcome.shopLevels).toMatchObject({ championSlots: 2 })
    })

    it('hands back the collection a fresh query would return, bucket for bucket', async () => {
        await rewind(120)
        const outcome = await settleHq(USER_ID)

        expect(outcome.collections).toBeDefined()
        const fresh = await getCollections(USER_ID)

        // Compare by content, not by row order — neither query promises an ordering, and pinning
        // one here would make this spec fail on an unrelated index change.
        for (const system of ['gear', 'champion', 'skill', 'artifact'] as const) {
            const reused = [...outcome.collections![system]].sort((a, b) => a.contentId.localeCompare(b.contentId))
            const direct = [...fresh[system]].sort((a, b) => a.contentId.localeCompare(b.contentId))
            expect(reused.map(r => [r.contentId, r.star, r.level, r.dupeProgress]), system)
                .toEqual(direct.map(r => [r.contentId, r.star, r.level, r.dupeProgress]))
        }

        expect(outcome.collections!.gear).toHaveLength(1)
        expect(outcome.collections!.champion).toHaveLength(1)
        expect(outcome.collections!.skill).toHaveLength(1)
        expect(outcome.collections!.artifact).toHaveLength(0)
    })

    it('omits both on the no-op path, so the caller fallback is load-bearing', async () => {
        // Settle once to bring `lastSettledAt` up to now, then immediately again: the second has
        // no elapsed time and returns before it reads anything.
        await rewind(120)
        await settleHq(USER_ID)

        await db.update(hqState)
            .set({ lastSettledAt: new Date(Date.now() + 5_000) })
            .where(eq(hqState.userId, USER_ID))

        const noop = await settleHq(USER_ID)
        expect(noop.result).toBeNull()
        expect(noop.shopLevels).toBeUndefined()
        expect(noop.collections).toBeUndefined()
    })

    it('still returns the settled state alongside them', async () => {
        // The reuse must not have cost the caller anything it had before.
        await rewind(300)
        const outcome = await settleHq(USER_ID)

        expect(outcome.state.userId).toBe(USER_ID)
        expect(outcome.result).not.toBeNull()
        expect(outcome.elapsedSeconds).toBeGreaterThan(0)
        expect(typeof outcome.previousLevel).toBe('number')
    })
})
