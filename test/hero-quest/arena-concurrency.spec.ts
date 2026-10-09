/**
 * The Arena's value-changing routes under parallel bursts (`arena.md`, `server/utils/hero-quest-arena.ts`).
 *
 * Attempts, Medals, Ratings, Gems and season rewards all move under `hq_state` row locks or a
 * claim-then-reward flag. Every case below fires a burst and checks that it came to exactly what
 * the same requests one at a time would have: no attack past the day's attempts, no Medal or
 * Rating paid twice, no lost update to a defender attacked by two players at once, no deadlock
 * when two players attack each other, and no shop spend past the Medals held.
 *
 * The test players stand at a level far past any dev account, so the matchmaking band only ever
 * finds each other. Needs the local Postgres from .env; skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { hqArenaLog, hqArenaSeasonResults, hqArenaSeasons, hqCollection, hqFights, hqLoadouts, hqRaidState, hqShopUpgrades, hqState, user } from '#server/database/schema'
import { ensureHqState, getCollections, getShopLevels, heroSnapshotOf } from '#server/utils/hero-quest'
import {
    attackArena,
    buyAttempt,
    buyFromShop,
    claimSeasonRewards,
    closeSeason,
    getCandidates,
    refreshCandidates,
    setDefense
} from '#server/utils/hero-quest-arena'
import { ARENA_DUMMY_ID, arenaSeasonAt, arenaSeasonStartsAt, extraAttemptPrice, seasonRewardFor } from '#shared/utils/hero-quest/arena'
import { globalPower } from '#shared/utils/hero-quest/power'
import { ladderDateKey } from '#shared/utils/hero-quest/gacha'
import {
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_LOG_SIZE,
    ARENA_RATING_START,
    ARENA_REFRESH_GEMS,
    ARENA_SHOP_KEY_PRICE,
    ARENA_SHOP_SEAL_PRICE,
    MEDAL_BASE_WIN,
    RAID_KEYS_PER_DAY
} from '#shared/utils/hero-quest/constants'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const ATTACKER = 'test-hq-arena-attacker'
const SECOND = 'test-hq-arena-second'
const DEFENDER = 'test-hq-arena-defender'
const PLAYERS = [ATTACKER, SECOND, DEFENDER]
/** Far past any real account, so the band holds only these three. */
const LEVEL = 4000
/** A season far ahead of the real clock, for the season cases: its marker can't collide with a real one. */
const SEASON = 900

async function cleanup() {
    await db.delete(hqArenaLog).where(inArray(hqArenaLog.userId, PLAYERS))
    await db.delete(hqArenaSeasonResults).where(inArray(hqArenaSeasonResults.userId, PLAYERS))
    await db.delete(hqArenaSeasonResults).where(eq(hqArenaSeasonResults.seasonId, SEASON))
    await db.delete(hqArenaSeasons).where(eq(hqArenaSeasons.seasonId, SEASON))
    for (const id of PLAYERS) {
        await db.delete(hqFights).where(eq(hqFights.userId, id))
        await db.delete(hqRaidState).where(eq(hqRaidState.userId, id))
        await db.delete(hqCollection).where(eq(hqCollection.userId, id))
        await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, id))
        await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, id))
        await db.delete(hqState).where(eq(hqState.userId, id))
        await cleanupUser(id)
    }
}

async function found(id: string, gems = 0) {
    await seedUser(id, { balance: '0', gems })
    await ensureHqState(id)
    await db.update(hqState).set({ heroLevel: LEVEL }).where(eq(hqState.userId, id))
}

const stateOf = async (id: string) => (await db.select().from(hqState).where(eq(hqState.userId, id)))[0]!
const gemsOf = async (id: string) => (await db.select({ gems: user.gems }).from(user).where(eq(user.id, id)))[0]!.gems

function attack(id: string, opponent: string, now = Date.now()) {
    return db.transaction(tx => attackArena(tx, id, 0, opponent, 0, now))
}

describe.skipIf(SKIP)('hero-quest arena concurrency', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('the defence', () => {
        it('stores a copy of the live loadout and its Defense GPN, and leaves the live one alone', async () => {
            await found(DEFENDER)
            const saved = await db.transaction(tx => setDefense(tx, DEFENDER, { source: 'live' }))
            const state = await stateOf(DEFENDER)
            const hero = heroSnapshotOf(state, await getShopLevels(DEFENDER), await getCollections(DEFENDER))

            expect(state.defenseLoadout).toEqual(saved.defense)
            expect(state.defenseGpn).toBe(globalPower(hero).gpn.toString())
            expect(state.defenseGpnLog).toBeCloseTo(globalPower(hero).gpn.log10().toNumber(), 6)
        })

        it('refuses a defence fielding a Champion the player does not own', async () => {
            await found(DEFENDER)
            await expect(db.transaction(tx => setDefense(tx, DEFENDER, { source: 'custom', championIds: ['champ_borin'] }))).rejects.toThrow()
            expect((await stateOf(DEFENDER)).defenseLoadout).toBeNull()
        })
    })

    describe('attacks', () => {
        it('never attacks past the day\'s attempts, and pays each attack that ran once', async () => {
            await found(ATTACKER)
            // nobody in band: every slot is a Training Dummy, and stays one through every redraw
            await getCandidates(ATTACKER, Date.now())

            const result = await burst(ARENA_FREE_ATTEMPTS_PER_DAY + 5, () => attack(ATTACKER, ARENA_DUMMY_ID))

            expect(result.ok).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            const state = await stateOf(ATTACKER)
            expect(state.arenaAttemptsUsedToday).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            expect(state.arenaMedals).toBe(ARENA_FREE_ATTEMPTS_PER_DAY * MEDAL_BASE_WIN)
            // a dummy never touches the ladder
            expect(state.arenaRating).toBe(ARENA_RATING_START)
            expect(state.arenaSeasonMatches).toBe(0)
            const log = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, ATTACKER))
            expect(log).toHaveLength(ARENA_FREE_ATTEMPTS_PER_DAY)
            expect(log.every(row => row.isDummy && row.won && row.ratingChange === 0 && row.opponentUserId === null)).toBe(true)
        })

        it('keeps a defender attacked by two players at once consistent with every match logged', async () => {
            await found(ATTACKER)
            await found(SECOND)
            await found(DEFENDER)
            await db.transaction(tx => setDefense(tx, DEFENDER, { source: 'live' }))
            await getCandidates(ATTACKER, Date.now())
            await getCandidates(SECOND, Date.now())
            expect((await stateOf(ATTACKER)).arenaCandidates[0]).toBe(DEFENDER)

            const result = await burst(2 * ARENA_FREE_ATTEMPTS_PER_DAY, i => attack(i % 2 ? SECOND : ATTACKER, DEFENDER))

            expect(result.ok).toBe(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
            const defender = await stateOf(DEFENDER)
            const defended = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, DEFENDER))
            expect(defended).toHaveLength(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
            expect(defender.arenaSeasonMatches).toBe(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
            // every match's change landed on the Rating the one before it left: no update lost
            expect(defender.arenaRating).toBe(ARENA_RATING_START + defended.reduce((sum, row) => sum + row.ratingChange, 0))
            // only an attacker is paid
            expect(defender.arenaMedals).toBe(0)
            for (const id of [ATTACKER, SECOND]) {
                const state = await stateOf(id)
                const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, id))
                expect(rows).toHaveLength(ARENA_FREE_ATTEMPTS_PER_DAY)
                expect(state.arenaRating).toBe(ARENA_RATING_START + rows.reduce((sum, row) => sum + row.ratingChange, 0))
                expect(state.arenaMedals).toBe(rows.reduce((sum, row) => sum + row.medalsEarned, 0))
                expect(state.arenaAttemptsUsedToday).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            }
        })

        it('lets two players attack each other at once without a deadlock', async () => {
            await found(ATTACKER)
            await found(SECOND)
            await db.transaction(tx => setDefense(tx, ATTACKER, { source: 'live' }))
            await db.transaction(tx => setDefense(tx, SECOND, { source: 'live' }))
            await getCandidates(ATTACKER, Date.now())
            await getCandidates(SECOND, Date.now())

            const result = await burst(2 * ARENA_FREE_ATTEMPTS_PER_DAY, i => i % 2 ? attack(SECOND, ATTACKER) : attack(ATTACKER, SECOND))

            expect(result.ok).toBe(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
            for (const id of [ATTACKER, SECOND]) {
                const state = await stateOf(id)
                const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, id))
                expect(rows).toHaveLength(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
                expect(state.arenaRating).toBe(ARENA_RATING_START + rows.reduce((sum, row) => sum + row.ratingChange, 0))
                expect(state.arenaSeasonMatches).toBe(2 * ARENA_FREE_ATTEMPTS_PER_DAY)
            }
        })

        it('refuses an attack on someone the list no longer shows', async () => {
            await found(ATTACKER)
            await getCandidates(ATTACKER, Date.now())
            await expect(attack(ATTACKER, DEFENDER)).rejects.toMatchObject({ statusCode: 409 })
            expect((await stateOf(ATTACKER)).arenaAttemptsUsedToday).toBe(0)
        })

        it('keeps the newest battle log entries only', async () => {
            await found(ATTACKER)
            await getCandidates(ATTACKER, Date.now())
            await db.update(hqState)
                .set({ arenaAttemptDate: ladderDateKey(Date.now()), arenaExtraAttemptsPurchasedToday: ARENA_LOG_SIZE + 5 })
                .where(eq(hqState.userId, ATTACKER))
            for (let i = 0; i < ARENA_LOG_SIZE + 5; i++) await attack(ATTACKER, ARENA_DUMMY_ID)
            const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, ATTACKER))
            expect(rows).toHaveLength(ARENA_LOG_SIZE)
        })
    })

    describe('spends', () => {
        it('sells extra attacks one rung at a time, never past the Gems held', async () => {
            const gems = extraAttemptPrice(0) + extraAttemptPrice(1)
            await found(ATTACKER, gems)

            const result = await burst(6, () => db.transaction(tx => buyAttempt(tx, ATTACKER, Date.now())))

            expect(result.ok).toBe(2)
            expect(await gemsOf(ATTACKER)).toBe(0)
            expect((await stateOf(ATTACKER)).arenaExtraAttemptsPurchasedToday).toBe(2)
        })

        it('charges every refresh, and never past the Gems held', async () => {
            await found(ATTACKER, 2 * ARENA_REFRESH_GEMS + 5)

            const result = await burst(6, () => refreshCandidates(ATTACKER, Date.now()))

            expect(result.ok).toBe(2)
            expect(await gemsOf(ATTACKER)).toBe(5)
        })

        it('never spends more Medals than there are, in a burst of purchases', async () => {
            await found(ATTACKER)
            await db.update(hqState).set({ arenaMedals: 3 * ARENA_SHOP_SEAL_PRICE + 10 }).where(eq(hqState.userId, ATTACKER))

            const result = await burst(10, () => db.transaction(tx => buyFromShop(tx, ATTACKER, 'seals_champion', 1)))

            expect(result.ok).toBe(3)
            const state = await stateOf(ATTACKER)
            expect(state.arenaMedals).toBe(10)
            expect(state.guildSeals).toBe(3)
        })

        it('grants raid Keys once per purchase paid, onto a raid never visited', async () => {
            await found(ATTACKER)
            await db.update(hqState).set({ arenaMedals: 2 * ARENA_SHOP_KEY_PRICE }).where(eq(hqState.userId, ATTACKER))

            const result = await burst(5, () => db.transaction(tx => buyFromShop(tx, ATTACKER, 'keys_raid_guild', 1)))

            expect(result.ok).toBe(2)
            const [raid] = await db.select().from(hqRaidState).where(and(eq(hqRaidState.userId, ATTACKER), eq(hqRaidState.raidId, 'raid_guild')))
            expect(raid!.keyBalance).toBe(RAID_KEYS_PER_DAY + 2)
            expect((await stateOf(ATTACKER)).arenaMedals).toBe(0)
        })
    })

    describe('seasons', () => {
        const now = arenaSeasonStartsAt(SEASON + 1) + 60_000

        it('writes a finished season\'s standings once, however many requests close it', async () => {
            await found(ATTACKER)
            await found(DEFENDER)
            await db.update(hqState).set({ arenaSeasonId: SEASON, arenaRating: 1180, arenaSeasonMatches: 4 }).where(eq(hqState.userId, ATTACKER))
            await db.update(hqState).set({ arenaSeasonId: SEASON, arenaRating: 940, arenaSeasonMatches: 2 }).where(eq(hqState.userId, DEFENDER))

            await burst(6, () => closeSeason(SEASON))

            const rows = await db.select().from(hqArenaSeasonResults).where(eq(hqArenaSeasonResults.seasonId, SEASON))
            expect(rows).toHaveLength(2)
            const top = rows.find(r => r.userId === ATTACKER)!
            expect(top.rank).toBe(1)
            expect(top.medals).toBe(seasonRewardFor(1))
            expect(rows.find(r => r.userId === DEFENDER)!.rank).toBe(2)
        })

        it('pays a season reward once, however many claims race for it', async () => {
            await found(ATTACKER)
            await db.insert(hqArenaSeasonResults).values({ seasonId: SEASON, userId: ATTACKER, rating: 1200, rank: 1, medals: 777 })

            const result = await burst(8, () => db.transaction(tx => claimSeasonRewards(tx, ATTACKER)))

            expect(result.ok).toBe(1)
            expect((await stateOf(ATTACKER)).arenaMedals).toBe(777)
        })

        it('rolls a player out of a finished season at the starting Rating on their next attack', async () => {
            await found(ATTACKER)
            expect(arenaSeasonAt(now)).toBe(SEASON + 1)
            await db.update(hqState).set({ arenaSeasonId: SEASON, arenaRating: 1300, arenaSeasonMatches: 7 }).where(eq(hqState.userId, ATTACKER))
            await closeSeason(SEASON)
            await getCandidates(ATTACKER, now)

            await attack(ATTACKER, ARENA_DUMMY_ID, now)

            const state = await stateOf(ATTACKER)
            expect(state.arenaSeasonId).toBe(SEASON + 1)
            expect(state.arenaRating).toBe(ARENA_RATING_START)
            expect(state.arenaSeasonMatches).toBe(0)
            // the season it left kept its final standing
            const [kept] = await db.select().from(hqArenaSeasonResults).where(and(eq(hqArenaSeasonResults.seasonId, SEASON), eq(hqArenaSeasonResults.userId, ATTACKER)))
            expect(kept!.rating).toBe(1300)
        })
    })
})
