/**
 * Concurrency guarantees for every Hero Quest route that grants or spends value.
 *
 * The platform has been bitten by this exact shape before — 10 parallel rakeback claims
 * paying out 10×. Under READ COMMITTED, a `SELECT` to check followed by an `UPDATE` to apply
 * means N concurrent requests all read the same pre-state, all pass, and all apply. Every
 * case below is a burst that must resolve to exactly one winner.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqLoadouts, hqShopUpgrades, hqState, user } from '#server/database/schema'
import { credit, creditGems, debit, debitGems, getBalance } from '#server/utils/balance'
import {
    ESSENCE_COLUMN,
    SEAL_COLUMN,
    claimShopLevel,
    ensureHqState,
    essenceBalance,
    essenceSpend,
    getShopLevels,
    loadoutSlots,
    purchaseBattleSpeed,
    sealBalance,
    sealGrant,
    sealSpend,
    settleHq
} from '#server/utils/hero-quest'
import {
    LOADOUT_SLOT_BASE_COST_GEMS,
    OFFLINE_EFFICIENCY_BASE_COST,
    SEAL_LADDER_BASE_GOLD,
    TEN_PULL_SIZE
} from '#shared/utils/hero-quest/constants'
import {
    applyDupes,
    applyPulls,
    craftCostFor,
    ladderDateKey,
    newEntry,
    pullCost,
    rarityFromRoll,
    sealLadderPrice,
    sealLadderTotal, GACHA_SYSTEMS
} from '#shared/utils/hero-quest/gacha'
import { gachaContent } from '#shared/utils/hero-quest/content/registry'
import { battleSpeedPrice } from '#shared/utils/hero-quest/battle-speed'

import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import { randomFloat } from '#shared/utils/random'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-hero-quest-race-user'

async function cleanup() {
    await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

/** Rewind the settle clock so there is a real window to bank. */
async function backdate(seconds: number) {
    await db.update(hqState)
        .set({ lastSettledAt: new Date(Date.now() - seconds * 1000) })
        .where(eq(hqState.userId, USER_ID))
}

describe.skipIf(SKIP)('hero-quest concurrency', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID, { balance: '0' })
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('settleHq', () => {
        it('pays one elapsed window once, however many settles race for it', async () => {
            await ensureHqState(USER_ID)
            await backdate(3600)

            await burst(10, () => settleHq(USER_ID))

            // The row lock is the mutex: the first settle advances lastSettledAt, and every
            // other one then reads a window of roughly zero.
            const single = parseFloat(await getBalance(USER_ID))
            await cleanup()
            await seedUser(USER_ID, { balance: '0' })
            await ensureHqState(USER_ID)
            await backdate(3600)
            await settleHq(USER_ID)

            expect(single).toBeCloseTo(parseFloat(await getBalance(USER_ID)), 0)
        })

        it('never rewinds the settle clock', async () => {
            await ensureHqState(USER_ID)
            await backdate(3600)
            const before = Date.now()

            await burst(10, () => settleHq(USER_ID))

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.lastSettledAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
        })

        it('creates exactly one state row under a concurrent first-touch burst', async () => {
            await burst(10, () => settleHq(USER_ID))

            const rows = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(rows).toHaveLength(1)
        })
    })

    describe('battle speed', () => {
        const gemsOf = async () => (await db.select({ gems: user.gems }).from(user).where(eq(user.id, USER_ID)))[0]!.gems
        const expiryOf = async () => (await db.select().from(hqState).where(eq(hqState.userId, USER_ID)))[0]!.speedBoostExpiresAt!.getTime()

        it('sells one block, not N, for one block of Gems', async () => {
            await ensureHqState(USER_ID)
            await creditGems(USER_ID, battleSpeedPrice(2, 30))

            const before = Date.now()
            const result = await burst(10, () => db.transaction(tx => purchaseBattleSpeed(tx, USER_ID, 2, 30)))

            expect(result.ok).toBe(1)
            expect(await gemsOf()).toBe(0)
            // one block's time, not ten
            expect(await expiryOf()).toBeLessThan(before + 31 * 60_000)
        })

        it('settles a window inside a running block at its speed', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState)
                .set({ speedBoostMultiplier: 2, speedBoostExpiresAt: new Date(Date.now() + 3_600_000) })
                .where(eq(hqState.userId, USER_ID))
            await backdate(30)

            const { result, online } = await settleHq(USER_ID)

            expect(online).toBe(true)
            // 30 real seconds, all of them boosted, and online so no efficiency tax
            expect(result!.effectiveSeconds).toBeGreaterThanOrEqual(60)
            expect(result!.effectiveSeconds).toBeLessThan(61)
        })

        it('extends by exactly the blocks paid for when every purchase can pay', async () => {
            await ensureHqState(USER_ID)
            await creditGems(USER_ID, battleSpeedPrice(3, 30) * 10)

            const before = Date.now()
            const result = await burst(10, () => db.transaction(tx => purchaseBattleSpeed(tx, USER_ID, 3, 30)))
            const after = Date.now()

            expect(result.ok).toBe(10)
            expect(await gemsOf()).toBe(0)
            // each one extends the last under the lock, so none is lost to a stale read
            const expiry = await expiryOf()
            expect(expiry).toBeGreaterThanOrEqual(before + 300 * 60_000)
            expect(expiry).toBeLessThanOrEqual(after + 300 * 60_000)
        })
    })

    describe('shop purchases', () => {
        it('lets exactly one of N concurrent claims take a level', async () => {
            await ensureHqState(USER_ID)

            const result = await burst(10, async () => {
                const claimed = await claimShopLevel(db, USER_ID, 'offlineEfficiency', 0)
                if (!claimed) throw new Error('lost the claim')
                return claimed
            })

            expect(result.ok).toBe(1)
            expect(result.rejected).toBe(9)
            expect((await getShopLevels(USER_ID)).offlineEfficiency).toBe(1)
        })

        it('never lets a track skip past the level actually paid for', async () => {
            await ensureHqState(USER_ID)

            // Everyone reads level 0 and tries to buy level 1 — the classic read-then-write
            // burst. Exactly one may land, and it must land on 1, not 10.
            await burst(10, () => claimShopLevel(db, USER_ID, 'offlineCap', 0))

            expect((await getShopLevels(USER_ID)).offlineCap).toBe(1)
        })

        it('writes one row per track, not one per purchase', async () => {
            await ensureHqState(USER_ID)

            for (let level = 0; level < 3; level++) {
                await claimShopLevel(db, USER_ID, 'offlineEfficiency', level)
            }

            const rows = await db.select().from(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
            expect(rows).toHaveLength(1)
            expect(rows[0]!.level).toBe(3)
        })

        it('rejects a claim staked on a level the track has already left', async () => {
            await ensureHqState(USER_ID)
            await claimShopLevel(db, USER_ID, 'offlineEfficiency', 0)

            // A request that read level 0 before someone else bought it must not apply.
            expect(await claimShopLevel(db, USER_ID, 'offlineEfficiency', 0)).toBeNull()
        })
    })

    describe('void shards', () => {
        it('cannot be spent twice by a concurrent pair of purchases', async () => {
            await ensureHqState(USER_ID)
            // Exactly one level's worth — the second buy must find an empty purse.
            await db.update(hqState)
                .set({ voidShards: String(OFFLINE_EFFICIENCY_BASE_COST) })
                .where(eq(hqState.userId, USER_ID))

            await burst(8, () => $shopBuy())

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(Number(state!.voidShards)).toBeGreaterThanOrEqual(0)
            expect((await getShopLevels(USER_ID)).offlineEfficiency).toBeLessThanOrEqual(1)
        })
    })

    /**
     * Gacha pulls — the highest-value burst target in the phase.
     *
     * A pull reads a Seal balance, rolls an outcome, and writes Seals, gacha level and
     * collection rows. Without the conditional debit as the guard, N parallel pulls all read
     * the same balance and all pay out — the rakeback bug with a different currency.
     */
    describe('guild pulls', () => {
        it('lets exactly one of N concurrent pulls spend the only Seal', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({ guildSeals: 1 }).where(eq(hqState.userId, USER_ID))

            const { ok } = await burst(10, () => $pull('champion', 1))
            expect(ok).toBe(1)

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.guildSeals).toBe(0)
        })

        it('never drives the Seal balance negative under a burst', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({ guildSeals: 5 }).where(eq(hqState.userId, USER_ID))

            await burst(20, () => $pull('champion', 1))

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.guildSeals).toBeGreaterThanOrEqual(0)
        })

        it('keeps exactly one collection row per Champion, however many dupes land', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({ guildSeals: 30 }).where(eq(hqState.userId, USER_ID))

            await burst(30, () => $pull('champion', 1))

            const rows = await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))
            const ids = rows.map(row => row.contentId)
            // The unique constraint is what makes "one copy, levelled by dupes" expressible.
            expect(new Set(ids).size).toBe(ids.length)
            expect(rows.every(row => row.system === 'champion')).toBe(true)
        })

        it('counts pulls granted rather than Seals spent when levelling the gacha', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({ guildSeals: 9 }).where(eq(hqState.userId, USER_ID))

            await $pull('champion', TEN_PULL_SIZE)

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.guildSeals).toBe(0)
            // 9 Seals bought 10 pulls, which is exactly the level-1 threshold.
            expect((state!.gachaLevels as Record<string, number>).champion).toBe(2)
        })
    })

    describe('crafting', () => {
        const RARE = 'champ_dorne'
        const cost = craftCostFor('rare')

        it('lets exactly one of N concurrent crafts spend a single craft’s worth', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({ championEssence: cost }).where(eq(hqState.userId, USER_ID))

            const { ok } = await burst(10, () => $craft('champion', RARE))
            expect(ok).toBe(1)

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.championEssence).toBe(0)
        })

        it('never drives Essence negative, and grants no more copies than were paid for', async () => {
            await ensureHqState(USER_ID)
            // Exactly three crafts' worth.
            await db.update(hqState).set({ championEssence: cost * 3 }).where(eq(hqState.userId, USER_ID))

            const { ok } = await burst(15, () => $craft('champion', RARE))
            expect(ok).toBe(3)

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.championEssence).toBe(0)

            // Three grants merge into one row: one new copy plus two duplicates.
            const rows = await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))
            expect(rows).toHaveLength(1)
            expect(rows[0]!.contentId).toBe(RARE)
        })
    })

    describe('seal gold ladder', () => {
        it('never sells two Seals at the same rung under a concurrent pair', async () => {
            await ensureHqState(USER_ID)
            // Enough Gold for the first two rungs several times over.
            await db.update(hqState).set({ guildSeals: 0 }).where(eq(hqState.userId, USER_ID))
            await credit(USER_ID, '100000000', 'test')

            await burst(2, () => $buySeals('champion', 1))

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.guildSeals).toBe(2)
            // The counter must have advanced twice, which is what makes the second buy dearer.
            expect((state!.sealLadderPurchasedToday as Record<string, number>).champion).toBe(2)

            // Both rungs charged, not the base rung twice.
            const expected = sealLadderTotal('champion', 0, 2)
            const spent = 100_000_000 - Number(await getBalance(USER_ID))
            expect(spent).toBeCloseTo(expected, 2)
        })

        it('stops selling once Gold runs out rather than going negative', async () => {
            await ensureHqState(USER_ID)
            // Enough for exactly one rung.
            await credit(USER_ID, String(sealLadderPrice('champion', 0)), 'test')

            await burst(6, () => $buySeals('champion', 1))

            expect(Number(await getBalance(USER_ID))).toBeGreaterThanOrEqual(0)
            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            expect(state!.guildSeals).toBe(1)
        })
    })

    /**
     * The other three gachas, on the same guards.
     *
     * `gacha/pull`, `gacha/craft` and `gacha/buy-seals` are each **one route** taking `system` in
     * the body, so in principle proving the guard once proves it four times. These run anyway,
     * for one specific reason: the guard is a `WHERE <column> >= cost` naming a *different column
     * per system*, resolved through `SEAL_COLUMN` / `ESSENCE_COLUMN`. A wrong entry in either map
     * would check one balance and debit another — a bug that is invisible while only one gacha
     * exists and silently free pulls once four do.
     */
    describe('the other three gachas', () => {
        const systems = ['gear', 'skill', 'artifact'] as const

        it('guards each system against its own Seal column, not another gacha\'s', async () => {
            for (const system of systems) {
                await cleanup()
                await seedUser(USER_ID, { balance: '0' })
                await ensureHqState(USER_ID)

                // One Seal for this system, plenty for every other. If the guard read the wrong
                // column, the burst would happily spend a balance it was never checking.
                await db.update(hqState).set({
                    forgeSeals: system === 'gear' ? 1 : 99,
                    guildSeals: 99,
                    skillSeals: system === 'skill' ? 1 : 99,
                    excavationSeals: system === 'artifact' ? 1 : 99
                }).where(eq(hqState.userId, USER_ID))

                const { ok } = await burst(10, () => $pull(system, 1))
                expect(ok, system).toBe(1)

                const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
                expect(sealBalance(state!, system), system).toBe(0)
                // Every other balance untouched — the four are genuinely independent.
                for (const other of GACHA_SYSTEMS.filter(entry => entry !== system)) {
                    expect(sealBalance(state!, other), `${system} spent ${other}`).toBe(99)
                }
            }
        })

        it('writes collection rows under the system that paid for them', async () => {
            await ensureHqState(USER_ID)
            await db.update(hqState).set({
                forgeSeals: 5, skillSeals: 5, excavationSeals: 5
            }).where(eq(hqState.userId, USER_ID))

            await burst(5, () => $pull('gear', 1))
            await burst(5, () => $pull('skill', 1))
            await burst(5, () => $pull('artifact', 1))

            const rows = await db.select().from(hqCollection).where(eq(hqCollection.userId, USER_ID))
            // The unique constraint is on `(userId, system, contentId)`, so the same contentId
            // under two systems would be two rows — which is exactly why ids are prefixed.
            for (const row of rows) {
                expect(row.contentId.startsWith(row.system === 'artifact' ? 'artifact' : row.system), row.contentId)
                    .toBe(true)
            }
        })

        it('lets exactly one of N concurrent crafts spend a single craft\'s worth, per system', async () => {
            for (const [system, contentId] of [
                ['gear', 'gear_weapon_rare'],
                ['skill', 'skill_battle_focus'],
                ['artifact', 'artifact_offense_4']
            ] as const) {
                await cleanup()
                await seedUser(USER_ID, { balance: '0' })
                await ensureHqState(USER_ID)

                const cost = craftCostFor('rare')
                await db.update(hqState).set({
                    gearEssence: cost, skillEssence: cost, artifactEssence: cost
                }).where(eq(hqState.userId, USER_ID))

                const { ok } = await burst(10, () => $craft(system, contentId))
                expect(ok, system).toBe(1)

                const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
                expect(essenceBalance(state!, system), system).toBe(0)
            }
        })

        it('keeps each gacha\'s Gold ladder counter independent of the others', async () => {
            // `gold-economy.md` §7: four independent counters behind one shared reset date.
            // Buying Skill Seals today must not move the price of Champion Seals.
            await ensureHqState(USER_ID)
            await credit(USER_ID, '100000000', 'test')

            await $buySeals('skill', 1)
            await $buySeals('skill', 1)

            const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
            const counters = state!.sealLadderPurchasedToday as Record<string, number>
            expect(counters.skill).toBe(2)
            expect(counters.champion ?? 0).toBe(0)
            expect(sealLadderPrice('champion', 0)).toBe(SEAL_LADDER_BASE_GOLD)
        })
    })

    /**
     * The Gems-priced shop track (`loadouts.md` §3).
     *
     * The first track in the game not paid for in Void Shards, and the currency it *is* paid for
     * in lives on the shared `user` row rather than on `hqState`. So the two guards are no longer
     * both inside one lock: the level claim is an integer CAS on `hqShopUpgrades`, and the spend
     * is `debitGems`, whose `gems >= cost` sits in its own WHERE. Both have to hold, or a burst
     * of clicks buys one level and pays for several — or pays once and buys several.
     */
    describe('loadout slots — the Gems track', () => {
        it('lets exactly one of N concurrent purchases take the level and the gems', async () => {
            await ensureHqState(USER_ID)
            // Exactly one level's worth.
            await creditGems(USER_ID, LOADOUT_SLOT_BASE_COST_GEMS)

            const { ok } = await burst(10, () => $buyLoadoutSlot())
            expect(ok).toBe(1)

            const levels = await getShopLevels(USER_ID)
            expect(levels.loadoutSlots).toBe(1)
            expect(loadoutSlots(levels)).toBe(3)

            const [account] = await db.select().from(user).where(eq(user.id, USER_ID))
            expect(account!.gems).toBe(0)
        })

        it('never drives gems negative, and never grants a level it was not paid for', async () => {
            await ensureHqState(USER_ID)
            // Enough for the first two levels only — 250 + 500 at the placeholder base.
            await creditGems(USER_ID, LOADOUT_SLOT_BASE_COST_GEMS * 3)

            await burst(12, () => $buyLoadoutSlot())

            const [account] = await db.select().from(user).where(eq(user.id, USER_ID))
            expect(account!.gems).toBeGreaterThanOrEqual(0)

            const levels = await getShopLevels(USER_ID)
            // Whatever levels landed, they were affordable: the doubling series 250 + 500 + …
            // up to the level reached must not exceed what was credited.
            const spent = Array.from({ length: levels.loadoutSlots ?? 0 })
                .reduce<number>((total, _, index) => total + LOADOUT_SLOT_BASE_COST_GEMS * 2 ** index, 0)
            expect(spent).toBeLessThanOrEqual(LOADOUT_SLOT_BASE_COST_GEMS * 3)
        })
    })
})

/**
 * The craft route body, inlined. Guard under test: the conditional Essence debit.
 */
async function $craft(system: GachaSystem, contentId: string) {
    const definition = gachaContent(system).get(contentId)
    const cost = craftCostFor(definition.rarity)
    return db.transaction(async (tx) => {
        const [claimed] = await tx.update(hqState)
            .set(essenceSpend(system, cost))
            .where(and(eq(hqState.userId, USER_ID), sql`${ESSENCE_COLUMN[system]} >= ${cost}`))
            .returning()
        if (!claimed) throw new Error('insufficient essence')

        const [existing] = await tx.select().from(hqCollection)
            .where(and(
                eq(hqCollection.userId, USER_ID),
                eq(hqCollection.system, system),
                eq(hqCollection.contentId, contentId)
            ))
        const before = existing
            ? { star: existing.star, level: existing.level, dupeProgress: existing.dupeProgress }
            : null
        const entry = before ? applyDupes(before, 1, definition.rarity).entry : newEntry()

        await tx.insert(hqCollection)
            .values({ userId: USER_ID, system, contentId, ...entry })
            .onConflictDoUpdate({
                target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                set: { star: entry.star, level: entry.level, dupeProgress: entry.dupeProgress }
            })
        return entry
    })
}

/**
 * The buy-seals route body, inlined. Guard under test: **lock-then-read**. The price depends
 * on the counter's old value inside a jsonb map, so there is nothing to compare-and-swap —
 * the row lock is what stops two buyers both pricing at the base rung.
 */
async function $buySeals(system: GachaSystem, count: number) {
    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, USER_ID)).for('update')
        if (!state) throw new Error('no state')

        const today = ladderDateKey()
        const counters = state.sealLadderDate === today
            ? state.sealLadderPurchasedToday as Record<string, number>
            : {}
        const boughtToday = counters[system] ?? 0
        const total = sealLadderTotal(system, boughtToday, count)

        await debit(USER_ID, total.toFixed(4), `hero-quest:${system}-seals`, tx)

        await tx.update(hqState)
            .set({
                ...sealGrant(system, count),
                sealLadderPurchasedToday: { ...counters, [system]: boughtToday + count },
                sealLadderDate: today
            })
            .where(eq(hqState.userId, USER_ID))
        return total
    })
}

/**
 * The pull route body, inlined — same reason as `$shopBuy` below: the handler needs an H3
 * event, so this reproduces the transaction shape rather than the HTTP layer. The guard under
 * test is the conditional Seal debit.
 */
async function $pull(system: GachaSystem, count: number) {
    const cost = pullCost(count)
    const content = gachaContent(system)
    return db.transaction(async (tx) => {
        const [claimed] = await tx.update(hqState)
            .set(sealSpend(system, cost.seals))
            .where(and(eq(hqState.userId, USER_ID), sql`${SEAL_COLUMN[system]} >= ${cost.seals}`))
            .returning()
        if (!claimed) throw new Error('insufficient seals')

        const levels = claimed.gachaLevels as Record<string, number>
        const progress = claimed.gachaProgress as Record<string, number>
        const gachaLevel = levels[system] ?? 1

        const existing = await tx.select().from(hqCollection)
            .where(and(eq(hqCollection.userId, USER_ID), eq(hqCollection.system, system)))
        const entries = new Map(existing.map(row => [row.contentId, {
            star: row.star, level: row.level, dupeProgress: row.dupeProgress
        }]))

        const touched = new Set<string>()
        for (let index = 0; index < cost.pulls; index++) {
            const rarity = rarityFromRoll(gachaLevel, randomFloat())
            const definition = content.fromRoll(rarity, randomFloat())
            const before = entries.get(definition.id)
            entries.set(definition.id, before ? applyDupes(before, 1, definition.rarity).entry : newEntry())
            touched.add(definition.id)
        }

        for (const contentId of touched) {
            const entry = entries.get(contentId)!
            await tx.insert(hqCollection)
                .values({ userId: USER_ID, system, contentId, ...entry })
                .onConflictDoUpdate({
                    target: [hqCollection.userId, hqCollection.system, hqCollection.contentId],
                    set: { star: entry.star, level: entry.level, dupeProgress: entry.dupeProgress }
                })
        }

        const advanced = applyPulls(gachaLevel, progress[system] ?? 0, cost.pulls)
        await tx.update(hqState)
            .set({
                gachaLevels: { ...levels, [system]: advanced.level },
                gachaProgress: { ...progress, [system]: advanced.progress }
            })
            .where(eq(hqState.userId, USER_ID))
        return advanced
    })
}

/**
 * The shop-buy route body, inlined.
 *
 * The handler itself needs an H3 event, so this exercises the same transaction shape the
 * route uses — lock the state row, read the balance inside the lock, claim the level, then
 * write both.
 */
async function $shopBuy() {
    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, USER_ID)).for('update')
        if (!state) throw new Error('no state')

        const levels = await getShopLevels(USER_ID, tx)
        const level = levels.offlineEfficiency ?? 0
        const cost = OFFLINE_EFFICIENCY_BASE_COST * Math.pow(2, level)

        const held = Number(state.voidShards)
        if (held < cost) throw new Error('insufficient')

        const claimed = await claimShopLevel(tx, USER_ID, 'offlineEfficiency', level)
        if (!claimed) throw new Error('lost the claim')

        await tx.update(hqState)
            .set({ voidShards: String(held - cost) })
            .where(eq(hqState.userId, USER_ID))
        return claimed
    })
}

/**
 * The Gems shop-buy route body, inlined.
 *
 * Deliberately mirrors the Gems branch rather than the Void Shard one: the interesting part is
 * that the spend happens *outside* the `hqState` row lock's protection, on the shared `user`
 * row, so `debitGems`' own conditional WHERE is the only thing standing between a burst and a
 * negative balance. The level claim orders them — nothing is debited until a level is won.
 */
async function $buyLoadoutSlot() {
    return db.transaction(async (tx) => {
        const [state] = await tx.select().from(hqState).where(eq(hqState.userId, USER_ID)).for('update')
        if (!state) throw new Error('no state')

        const levels = await getShopLevels(USER_ID, tx)
        const level = levels.loadoutSlots ?? 0
        const cost = LOADOUT_SLOT_BASE_COST_GEMS * 2 ** level

        const claimed = await claimShopLevel(tx, USER_ID, 'loadoutSlots', level)
        if (!claimed) throw new Error('lost the claim')

        await debitGems(USER_ID, cost, tx)
        return claimed
    })
}
