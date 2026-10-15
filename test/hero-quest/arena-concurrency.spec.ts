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
    arenaLog,
    attackArena,
    buyAttempt,
    buyFromShop,
    claimSeasonRewards,
    closeSeason,
    getCandidates,
    refreshCandidates,
    setDefense
} from '#server/utils/hero-quest-arena'
import { ARENA_DUMMY_ID, arenaSeasonAt, arenaShopItem, arenaSeasonStartsAt, extraAttemptPrice, refreshPrice, seasonRewardFor } from '#shared/utils/hero-quest/arena'
import { globalPower } from '#shared/utils/hero-quest/power'
import { arenaBots } from '#shared/utils/hero-quest/content/arena-bots'
import { ladderDateKey } from '#shared/utils/hero-quest/gacha'
import {
    ARENA_FREE_ATTEMPTS_PER_DAY,
    ARENA_LOG_SIZE,
    ARENA_RATING_START,
    ARENA_MATCH_BAND_RATING,
    ARENA_SHOP_SEAL_PRICE,
    MEDAL_BASE_WIN,
    RAID_KEYS_PER_DAY
} from '#shared/utils/hero-quest/constants'
import { RAID_KEY_CAP } from '#shared/utils/hero-quest/raids'
import { quickClearRaid } from '#server/utils/hero-quest-raids'
import { engageLoadout } from '#server/utils/hero-quest-loadout'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

/** A Guild Key's price in the Arena Shop. */
const GUILD_KEY_PRICE = arenaShopItem('keys_raid_guild')!.price
const DAY = 86_400_000

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

/** A Rating no real account holds, this season, so the band draws only these players. */
const RATING = 900_000

async function found(id: string, gems = 0) {
    await seedUser(id, { balance: '0', gems })
    await ensureHqState(id)
    await db.update(hqState).set({ heroLevel: LEVEL, arenaSeasonId: arenaSeasonAt(Date.now()), arenaRating: RATING }).where(eq(hqState.userId, id))
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
            const saved = await db.transaction(tx => setDefense(tx, DEFENDER))
            const state = await stateOf(DEFENDER)
            const hero = heroSnapshotOf(state, await getShopLevels(DEFENDER), await getCollections(DEFENDER))

            expect(state.defenseLoadout).toEqual(saved.defense)
            expect(state.defenseGpn).toBe(globalPower(hero).gpn.toString())
        })

        it('sets the player\'s own loadout, putting the Arena\'s preferred Loadout back first', async () => {
            await found(DEFENDER)
            const own = (await stateOf(DEFENDER)).formation
            await db.insert(hqLoadouts).values({ userId: DEFENDER, slotIndex: 0, name: 'Arena', partyChampionIds: [], equippedGear: {}, formation: { hero: own.hero === 'back' ? 'front' : 'back' } })
            await db.update(hqState).set({ raidLoadoutPreferences: { arena: 0 } }).where(eq(hqState.userId, DEFENDER))
            await db.transaction(tx => engageLoadout(tx, DEFENDER, 'arena'))
            expect((await stateOf(DEFENDER)).formation).not.toEqual(own)

            const saved = await db.transaction(tx => setDefense(tx, DEFENDER))

            expect(saved.defense.formation).toEqual(own)
            expect((await stateOf(DEFENDER)).preRaidSnapshot).toBeNull()
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
            expect(state.arenaRating).toBe(RATING)
            expect(state.arenaSeasonMatches).toBe(0)
            const log = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, ATTACKER))
            expect(log).toHaveLength(ARENA_FREE_ATTEMPTS_PER_DAY)
            expect(log.every(row => row.isDummy && row.won && row.ratingChange === 0 && row.opponentUserId === null)).toBe(true)
        })

        it('fights a bot as a real match on the attacker\'s side only', async () => {
            await found(ATTACKER)
            const bot = arenaBots()[0]!
            // level with it, so the result moves the Rating either way
            await db.update(hqState).set({ arenaRating: bot.rating, arenaCandidates: [bot.id, null, null] }).where(eq(hqState.userId, ATTACKER))

            const result = await attack(ATTACKER, bot.id)

            expect(result.dummy).toBe(false)
            expect(result.opponentName).toBe(bot.name)
            expect(result.enemy?.champions.map(c => c.id)).toEqual(bot.champions.map(c => c.contentId))
            const state = await stateOf(ATTACKER)
            expect(result.ratingChange).not.toBe(0)
            expect(state.arenaRating).toBe(bot.rating + result.ratingChange)
            expect(state.arenaSeasonMatches).toBe(1)
            expect(state.arenaMedals).toBe(result.medals)
            // one row, the attacker's, naming the bot: a bot has no account to log a defence on
            const log = await db.select().from(hqArenaLog).where(eq(hqArenaLog.opponentBotId, bot.id))
            expect(log.map(row => [row.userId, row.role, row.isDummy, row.opponentUserId])).toEqual([[ATTACKER, 'attacker', false, null]])
            expect((await arenaLog(ATTACKER))[0]?.opponentName).toBe(bot.name)
        })

        it('keeps a defender attacked by two players at once consistent with every match logged', async () => {
            await found(ATTACKER)
            await found(SECOND)
            await found(DEFENDER)
            await db.transaction(tx => setDefense(tx, DEFENDER))
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
            expect(defender.arenaRating).toBe(RATING + defended.reduce((sum, row) => sum + row.ratingChange, 0))
            // only an attacker is paid
            expect(defender.arenaMedals).toBe(0)
            for (const id of [ATTACKER, SECOND]) {
                const state = await stateOf(id)
                const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, id))
                expect(rows).toHaveLength(ARENA_FREE_ATTEMPTS_PER_DAY)
                expect(state.arenaRating).toBe(RATING + rows.reduce((sum, row) => sum + row.ratingChange, 0))
                expect(state.arenaMedals).toBe(rows.reduce((sum, row) => sum + row.medalsEarned, 0))
                expect(state.arenaAttemptsUsedToday).toBe(ARENA_FREE_ATTEMPTS_PER_DAY)
            }
        })

        it('lets two players attack each other at once without a deadlock', async () => {
            await found(ATTACKER)
            await found(SECOND)
            await db.transaction(tx => setDefense(tx, ATTACKER))
            await db.transaction(tx => setDefense(tx, SECOND))
            await getCandidates(ATTACKER, Date.now())
            await getCandidates(SECOND, Date.now())

            const results = await Promise.allSettled(Array.from({ length: 2 * ARENA_FREE_ATTEMPTS_PER_DAY },
                (_, i) => i % 2 ? attack(SECOND, ATTACKER) : attack(ATTACKER, SECOND)))
            const ok = results.filter(r => r.status === 'fulfilled').length

            // Every attack redraws the attacker's list, and ten coin-flip matches can push the two
            // Ratings past the match band, so a later attack may find the other player off its list:
            // that is a 409 to pick again, never a deadlock, which would surface as a Postgres error.
            expect(ok).toBeGreaterThan(0)
            for (const r of results) {
                if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 409 })
            }
            for (const id of [ATTACKER, SECOND]) {
                const state = await stateOf(id)
                const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, id))
                expect(rows).toHaveLength(ok)
                expect(state.arenaRating).toBe(RATING + rows.reduce((sum, row) => sum + row.ratingChange, 0))
                expect(state.arenaSeasonMatches).toBe(ok)
            }
        })

        it('refuses an attack on someone the list no longer shows', async () => {
            await found(ATTACKER)
            await getCandidates(ATTACKER, Date.now())
            await expect(attack(ATTACKER, DEFENDER)).rejects.toMatchObject({ statusCode: 409 })
            expect((await stateOf(ATTACKER)).arenaAttemptsUsedToday).toBe(0)
        })

        it('draws on Rating, an earlier season\'s counting as the start, and keeps a drawn list', async () => {
            await found(ATTACKER)
            await found(DEFENDER)
            await db.transaction(tx => setDefense(tx, DEFENDER))
            const season = arenaSeasonAt(Date.now())
            // in band this season: drawn
            expect((await getCandidates(ATTACKER, Date.now()))[0]!.id).toBe(DEFENDER)
            // the same Rating from an earlier season counts as the start, far below: not drawn
            await db.update(hqState).set({ arenaSeasonId: season - 1 }).where(eq(hqState.userId, DEFENDER))
            await db.update(hqState).set({ arenaCandidates: [] }).where(eq(hqState.userId, ATTACKER))
            expect((await getCandidates(ATTACKER, Date.now())).every(c => c.dummy)).toBe(true)
            // back in band and drawn, then drifting out: a drawn list is kept until a refresh or an attack
            await db.update(hqState).set({ arenaSeasonId: season }).where(eq(hqState.userId, DEFENDER))
            await db.update(hqState).set({ arenaCandidates: [] }).where(eq(hqState.userId, ATTACKER))
            expect((await getCandidates(ATTACKER, Date.now()))[0]!.id).toBe(DEFENDER)
            await db.update(hqState).set({ arenaRating: RATING + 3 * ARENA_MATCH_BAND_RATING }).where(eq(hqState.userId, DEFENDER))
            expect((await getCandidates(ATTACKER, Date.now()))[0]!.id).toBe(DEFENDER)
            const fight = await attack(ATTACKER, DEFENDER)
            expect(fight.dummy).toBe(false)
        })

        it('fights an attack on the Arena\'s preferred Loadout, and holds the session after it', async () => {
            await found(ATTACKER)
            await found(DEFENDER)
            await db.transaction(tx => setDefense(tx, DEFENDER))
            await getCandidates(ATTACKER, Date.now())
            await db.insert(hqLoadouts).values({ userId: ATTACKER, slotIndex: 0, name: 'Arena', partyChampionIds: [], equippedGear: {}, formation: {} })
            await db.update(hqState).set({ raidLoadoutPreferences: { arena: 0 } }).where(eq(hqState.userId, ATTACKER))

            await attack(ATTACKER, DEFENDER)

            expect((await stateOf(ATTACKER)).preRaidSnapshot).toMatchObject({ target: 'arena', slotIndex: 0 })
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

        it('gives two refreshes free, then charges each at its own rung, never past the Gems held', async () => {
            // the two free ones, then 5 and 10, and 4 over
            await found(ATTACKER, refreshPrice(2) + refreshPrice(3) + 4)

            const result = await burst(8, () => refreshCandidates(ATTACKER, Date.now()))

            expect(result.ok).toBe(4)
            expect(await gemsOf(ATTACKER)).toBe(4)
            expect((await stateOf(ATTACKER)).arenaRefreshesToday).toBe(4)
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
            await db.update(hqState).set({ arenaMedals: 2 * GUILD_KEY_PRICE }).where(eq(hqState.userId, ATTACKER))

            const result = await burst(5, () => db.transaction(tx => buyFromShop(tx, ATTACKER, 'keys_raid_guild', 1)))

            expect(result.ok).toBe(2)
            const [raid] = await db.select().from(hqRaidState).where(and(eq(hqRaidState.userId, ATTACKER), eq(hqRaidState.raidId, 'raid_guild')))
            expect(raid!.keyBalance).toBe(RAID_KEYS_PER_DAY + 2)
            expect((await stateOf(ATTACKER)).arenaMedals).toBe(0)
        })
    })

    describe('shop Keys and the daily grant', () => {
        const raidRow = async () => (await db.select().from(hqRaidState).where(and(eq(hqRaidState.userId, ATTACKER), eq(hqRaidState.raidId, 'raid_guild'))))[0]!

        it('adds bought Keys on top of the grant owed, never cut to the cap', async () => {
            await found(ATTACKER)
            await db.update(hqState).set({ arenaMedals: 10 * GUILD_KEY_PRICE }).where(eq(hqState.userId, ATTACKER))
            // nothing stored, a week owed: the grant fills to the cap, and the ten bought stand above it
            await db.insert(hqRaidState).values({ userId: ATTACKER, raidId: 'raid_guild', keyBalance: 0, lastKeyGrantAt: new Date(Date.now() - 7.5 * DAY) })

            await db.transaction(tx => buyFromShop(tx, ATTACKER, 'keys_raid_guild', 10))

            const row = await raidRow()
            expect(row.keyBalance).toBe(RAID_KEY_CAP + 10)
            // the grant clock moved on to the start of today
            expect(Date.now() - row.lastKeyGrantAt.getTime()).toBeLessThan(DAY)
        })

        it('keeps a near-full bank\'s grant and the Keys bought', async () => {
            await found(ATTACKER)
            await db.update(hqState).set({ arenaMedals: 3 * GUILD_KEY_PRICE }).where(eq(hqState.userId, ATTACKER))
            await db.insert(hqRaidState).values({ userId: ATTACKER, raidId: 'raid_guild', keyBalance: RAID_KEY_CAP - 3, lastKeyGrantAt: new Date(Date.now() - 1.2 * DAY) })

            await db.transaction(tx => buyFromShop(tx, ATTACKER, 'keys_raid_guild', 3))

            expect((await raidRow()).keyBalance).toBe(RAID_KEY_CAP + 3)
        })

        it('keeps Keys above the cap through a later grant and raid entry', async () => {
            await found(ATTACKER)
            await db.insert(hqRaidState).values({ userId: ATTACKER, raidId: 'raid_guild', keyBalance: RAID_KEY_CAP + 10, highestLevel: 1, lastKeyGrantAt: new Date(Date.now() - 3.5 * DAY) })

            await db.transaction(tx => quickClearRaid(tx, ATTACKER, 'raid_guild'))

            expect((await raidRow()).keyBalance).toBe(RAID_KEY_CAP + 9)
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

        it('waits for a match in flight on a row before it writes the standings', async () => {
            await found(ATTACKER)
            await db.update(hqState).set({ arenaSeasonId: SEASON, arenaRating: 1180, arenaSeasonMatches: 4 }).where(eq(hqState.userId, ATTACKER))
            let locked!: () => void
            let release!: () => void
            const isLocked = new Promise<void>((resolve) => { locked = resolve })
            const held = new Promise<void>((resolve) => { release = resolve })
            // an attack holding the row, its Rating moved but not yet committed
            const inFlight = db.transaction(async (tx) => {
                await tx.select().from(hqState).where(eq(hqState.userId, ATTACKER)).for('update')
                await tx.update(hqState).set({ arenaRating: 1250, arenaSeasonMatches: 5 }).where(eq(hqState.userId, ATTACKER))
                locked()
                await held
            })
            await isLocked

            const closing = closeSeason(SEASON)
            await new Promise(resolve => setTimeout(resolve, 150))
            release()
            await Promise.all([inFlight, closing])

            const [row] = await db.select().from(hqArenaSeasonResults).where(and(eq(hqArenaSeasonResults.seasonId, SEASON), eq(hqArenaSeasonResults.userId, ATTACKER)))
            expect(row!.rating).toBe(1250)
        })

        it('refuses an attack into a season that has closed', async () => {
            await found(ATTACKER)
            const late = arenaSeasonStartsAt(SEASON) + 60_000
            await getCandidates(ATTACKER, late)
            await db.insert(hqArenaSeasons).values({ seasonId: SEASON })

            await expect(attack(ATTACKER, ARENA_DUMMY_ID, late)).rejects.toMatchObject({ statusCode: 409 })

            const state = await stateOf(ATTACKER)
            expect(state.arenaAttemptsUsedToday).toBe(0)
            expect(state.arenaMedals).toBe(0)
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
            await db.update(hqState).set({ arenaSeasonId: SEASON, arenaRating: 1300, arenaSeasonMatches: 7, arenaCandidates: [null, null, null] }).where(eq(hqState.userId, ATTACKER))
            await closeSeason(SEASON)

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
