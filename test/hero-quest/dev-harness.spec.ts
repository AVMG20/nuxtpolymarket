/**
 * The playtest harness (`server/utils/hero-quest-dev.ts`).
 *
 * Two things are worth testing here and the rest is plumbing:
 *
 * 1. **The gate is closed by default.** These routes mint Gold and Gems, which are shared
 *    platform balances rather than Hero Quest scrip. The failure mode is not "a bug" — it is a
 *    mint reachable in production, so the assertion is that the gate fails *closed*.
 * 2. **`skipPlan`'s chunking is the only real logic in the module**, and it is silently
 *    falsifiable: `settleHq` decides online-vs-offline from the window length alone, so a chunk
 *    one millisecond too long turns every "online" skip into an offline one and the harness
 *    reports the wrong experiment while looking like it worked.
 *
 * Everything else is asserted against a real database, because the whole point of the harness is
 * that it moves inputs and lets the production path do the work — a mocked settle would test the
 * mock.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqLoadouts, hqShopUpgrades, hqState, user } from '#server/database/schema'
import { ensureHqState, getShopLevels, settleHq } from '#server/utils/hero-quest'
import {
    assertDevHarness,
    devAway,
    devGrant,
    devHarnessEnabled,
    devReset,
    devSet,
    devSkip,
    devUnlock,
    skipPlan
} from '#server/utils/hero-quest-dev'
import { GACHA_CONTENT } from '#shared/utils/hero-quest/content/registry'
import { SHOP_TRACKS } from '#shared/utils/hero-quest/content/shop'
import {
    BOSS_STAGE,
    HQ_SESSION_TIMEOUT_MS,
    LEVELS_PER_STAR,
    MAX_STAR,
    ONLINE_THRESHOLD_MS,
    STAGES_PER_WORLD,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-hero-quest-dev-user'

async function cleanup() {
    await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

async function readState() {
    const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
    return state!
}

describe('dev harness gate', () => {
    /**
     * Conditional on purpose. The gate reads `import.meta.dev`, which is a property of the build
     * rather than of the code, so the honest assertion is the *relationship* — closed means a 404
     * — rather than a hard-coded expectation about which build vitest happens to be.
     *
     * The 404 matters as much as the throw. A 403 would confirm the routes exist.
     */
    it('fails closed, and 404s rather than 403s so the routes look undeployed', () => {
        if (devHarnessEnabled()) {
            expect(() => assertDevHarness()).not.toThrow()
            return
        }
        expect(() => assertDevHarness()).toThrowError(
            expect.objectContaining({ statusCode: 404 })
        )
    })

    it('reads a boolean, never a truthy config object', () => {
        // `devMode` in runtime config is deliberately *not* consulted — a deploy-time flag must
        // not be able to open a route that mints a shared balance.
        expect(typeof devHarnessEnabled()).toBe('boolean')
    })
})

describe('skipPlan', () => {
    it('settles an offline skip as exactly one window', () => {
        // One window is what the offline cap and the efficiency tax apply to. Cutting it up
        // would quietly measure something else.
        expect(skipPlan(8, 'offline')).toEqual({ chunks: 1, chunkMs: 8 * 3600 * 1000 })
    })

    it('cuts an online skip into windows short enough to still count as presence', () => {
        // The load-bearing assertion in this file. `settleHq` classifies a window as online when
        // `elapsedMs <= ONLINE_THRESHOLD_MS`; one millisecond over and every chunk silently
        // settles at the offline rate while the caller believes it asked for the live one.
        const plan = skipPlan(8, 'online')
        expect(plan.chunkMs).toBeLessThanOrEqual(ONLINE_THRESHOLD_MS)
        expect(plan.chunks).toBe(Math.ceil((8 * 3600 * 1000) / ONLINE_THRESHOLD_MS))
    })

    it('covers at least the requested span, rounding up rather than down', () => {
        // A skip that quietly delivered less than asked would make every reading off by a
        // fraction of a window, which is exactly the kind of error a tuning pass cannot see.
        for (const hours of [0.05, 1, 7.3]) {
            const plan = skipPlan(hours, 'online')
            expect(plan.chunks * plan.chunkMs).toBeGreaterThanOrEqual(hours * 3600 * 1000)
        }
    })

    it('rejects a span that is not a positive finite number', () => {
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => skipPlan(bad, 'offline')).toThrowError(
                expect.objectContaining({ statusCode: 400 })
            )
        }
    })

    it('rejects a fat-fingered span before it becomes a million transactions', () => {
        expect(() => skipPlan(1e9, 'offline')).toThrowError(
            expect.objectContaining({ statusCode: 400 })
        )
    })

    it('caps an online skip and points at the mode that can go further', () => {
        // The cap is a wall-clock bound, not a game one — each chunk is a real transaction with
        // a row lock and a credit. 200 hours is well inside the absolute span limit and well
        // past the chunk budget, so this exercises the online cap specifically, and the message
        // has to say what to do instead.
        let message = ''
        try {
            skipPlan(200, 'online')
        } catch (error) {
            message = (error as { statusMessage?: string }).statusMessage ?? ''
        }
        expect(message).toContain('offline')
        // The same span is fine as one offline window — the two limits are genuinely different.
        expect(() => skipPlan(200, 'offline')).not.toThrow()
    })
})

describe.skipIf(SKIP)('dev harness against the real settle path', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0', gems: 0 })
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('devUnlock', () => {
        it('grants every roster entry across all four gachas by default', async () => {
            const result = await devUnlock(USER_ID, {})
            const expected = Object.values(GACHA_CONTENT)
                .reduce((sum, content) => sum + content.entries.length, 0)

            expect(result.granted).toBe(expected)
            const rows = await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))
            expect(rows).toHaveLength(expected)
        })

        it('is idempotent — a second unlock updates rather than duplicating', async () => {
            // `hqCollection` is uniquely keyed on (user, system, contentId), so a naive insert
            // would throw on the second run and leave the harness single-use.
            await devUnlock(USER_ID, { systems: ['skill'] })
            await devUnlock(USER_ID, { systems: ['skill'], star: 3, level: 4 })

            const rows = await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))
            expect(rows).toHaveLength(GACHA_CONTENT.skill.entries.length)
            expect(rows.every(row => row.star === 3 && row.level === 4)).toBe(true)
        })

        it('clamps star and level to the real ceiling', async () => {
            // A 99★ copy would sail past every curve the game's math assumes is bounded.
            const result = await devUnlock(USER_ID, { systems: ['gear'], star: 99, level: 99 })
            expect(result.star).toBe(MAX_STAR)
            expect(result.level).toBe(LEVELS_PER_STAR)
        })

        it('rejects an unknown system rather than silently unlocking nothing', async () => {
            await expect(
                devUnlock(USER_ID, { systems: ['weapons' as never] })
            ).rejects.toThrowError(expect.objectContaining({ statusCode: 400 }))
        })

        it('maxes every prestige-shop track on request', async () => {
            await devUnlock(USER_ID, { systems: ['gear'], maxShop: true })
            const levels = await getShopLevels(USER_ID)
            for (const track of SHOP_TRACKS) {
                expect(levels[track.id], track.id).toBe(track.maxLevel)
            }
        })
    })

    describe('devSet', () => {
        it('derives atBossGate from the landing stage instead of trusting the caller', async () => {
            // `atBossGate` is derived from the stage, never taken from the caller, so the stored
            // flag cannot disagree with where the run actually stands.
            const boss = await devSet(USER_ID, { world: 2, stage: BOSS_STAGE })
            expect(boss.atBossGate).toBe(true)

            const trash = await devSet(USER_ID, { world: 2, stage: BOSS_STAGE - 1 })
            expect(trash.atBossGate).toBe(false)
        })

        it('clamps world and stage into the real run', async () => {
            const result = await devSet(USER_ID, { world: 999, stage: 999 })
            expect(result.world).toBe(WORLD_COUNT)
            expect(result.stage).toBe(STAGES_PER_WORLD)

            const low = await devSet(USER_ID, { world: -5, stage: 0 })
            expect(low.world).toBe(1)
            expect(low.stage).toBe(1)
        })

        it('clears banked XP when the level is forced', async () => {
            // Level and XP-within-level are one pair. A level-1000 remainder left on a level-5
            // hero would level them straight back up on the next settle, making the jump look
            // like it had not worked.
            await db.update(hqState).set({ heroXp: '999999999' }).where(eq(hqState.userId, USER_ID))
            const result = await devSet(USER_ID, { heroLevel: 5 })

            expect(result.heroLevel).toBe(5)
            expect((await readState()).heroXp).toBe('0')
        })

        it('records a forced class switch as seen, so prestige can pick it again', async () => {
            const result = await devSet(USER_ID, { heroNodeId: 'class_warrior' })
            expect(result.heroNodeId).toBe('class_warrior')
            expect((await readState()).seenNodeIds).toContain('class_warrior')
        })

        it('rejects a class node that does not exist', async () => {
            await expect(
                devSet(USER_ID, { heroNodeId: 'class_dragon_emperor' })
            ).rejects.toThrowError(expect.objectContaining({ statusCode: 400 }))
        })

        it('leaves untouched fields alone', async () => {
            // Every field is optional, so a one-field jump must not reset the other three to
            // their defaults — that would make the page's inputs a trap.
            await devSet(USER_ID, { prestige: 3, world: 4, stage: 2, heroLevel: 40 })
            const result = await devSet(USER_ID, { stage: 3 })

            expect(result.prestige).toBe(3)
            expect(result.world).toBe(4)
            expect(result.heroLevel).toBe(40)
            expect(result.stage).toBe(3)
        })
    })

    describe('devGrant', () => {
        it('pays Seals and Essence into all four systems at once', async () => {
            await devGrant(USER_ID, { seals: 25, essence: 500 })
            const state = await readState()

            expect([state.forgeSeals, state.guildSeals, state.skillSeals, state.excavationSeals])
                .toEqual([25, 25, 25, 25])
            expect([state.gearEssence, state.championEssence, state.skillEssence, state.artifactEssence])
                .toEqual([500, 500, 500, 500])
        })

        it('adds to what is already banked rather than overwriting it', async () => {
            await devGrant(USER_ID, { seals: 10, voidShards: 100 })
            await devGrant(USER_ID, { seals: 10, voidShards: 100 })

            const state = await readState()
            expect(state.guildSeals).toBe(20)
            expect(Number(state.voidShards)).toBe(200)
        })

        it('rejects a negative grant instead of quietly debiting', async () => {
            await expect(
                devGrant(USER_ID, { seals: -50 })
            ).rejects.toThrowError(expect.objectContaining({ statusCode: 400 }))
        })
    })

    describe('devSkip', () => {
        it('drives the real settle — an offline skip moves the run and banks Gold', async () => {
            const result = await devSkip(USER_ID, 8, 'offline')

            expect(result.kills).toBeGreaterThan(0)
            expect(result.goldEarned).toBeGreaterThan(0)
            expect(result.chunksRun).toBe(1)
        })

        it('stops early at a boss gate instead of burning windows on zeros', async () => {
            // `settle()` never resolves a boss, so every window after the run parks on one earns
            // nothing. Reporting the stop is more useful than reporting 20 empty windows — and
            // it is itself a finding worth having during a playtest.
            await devSet(USER_ID, { world: 1, stage: BOSS_STAGE })
            const result = await devSkip(USER_ID, 1, 'online')

            expect(result.blockedAtBoss).toBe(true)
            expect(result.chunksRun).toBe(1)
            expect(result.chunksRun).toBeLessThan(skipPlan(1, 'online').chunks)
        })

        it('clears the Gold ladder counters once the skip is a day or more', async () => {
            // The ladder is keyed on a real calendar date that skipping cannot move, so clearing
            // it is the honest approximation of "a new day started".
            await db.update(hqState)
                .set({ sealLadderDate: '2020-01-01', sealLadderPurchasedToday: { champion: 7 } })
                .where(eq(hqState.userId, USER_ID))

            await devSkip(USER_ID, 24, 'offline')
            const state = await readState()
            expect(state.sealLadderDate).toBeNull()
            expect(state.sealLadderPurchasedToday).toEqual({})
        })

        it('leaves the ladder alone for a skip shorter than a day', async () => {
            await db.update(hqState)
                .set({ sealLadderDate: '2020-01-01', sealLadderPurchasedToday: { champion: 7 } })
                .where(eq(hqState.userId, USER_ID))

            await devSkip(USER_ID, 1, 'offline')
            expect((await readState()).sealLadderDate).toBe('2020-01-01')
        })
    })

    describe('devReset', () => {
        it('clears every Hero Quest table for the user', async () => {
            await devUnlock(USER_ID, { maxShop: true })
            await devSet(USER_ID, { world: 3, stage: 2 })
            await devReset(USER_ID)

            expect(await db.select().from(hqState).where(eq(hqState.userId, USER_ID))).toHaveLength(0)
            expect(await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))).toHaveLength(0)
            expect(await db.select().from(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))).toHaveLength(0)
        })

        it('leaves the shared platform balances alone', async () => {
            // Granting into a shared balance is a dev convenience; silently deleting from one is
            // data loss. The player may have earned that Gold in another game entirely.
            await devGrant(USER_ID, { gold: 5000, gems: 50 })
            await devReset(USER_ID)

            const [row] = await db.select().from(user).where(eq(user.id, USER_ID))
            expect(Number(row!.balance)).toBe(5000)
            expect(row!.gems).toBe(50)
        })
    })

    describe('devAway', () => {
        it('leaves a gap past the session timeout for the real settle to close offline', async () => {
            await devAway(USER_ID)
            const settled = await settleHq(USER_ID)
            expect(settled.elapsedSeconds * 1000).toBeGreaterThan(HQ_SESSION_TIMEOUT_MS)
            expect(settled.online).toBe(false)
            // and the read after that is back to an ordinary, present gap
            expect((await settleHq(USER_ID)).elapsedSeconds * 1000).toBeLessThan(ONLINE_THRESHOLD_MS)
        })
    })
})
