/**
 * The Arena defence as it is shown and fought (issue #32), and the battle log's day (issue #29).
 *
 * A defence keeps the selection it was set with, Traits included, until it is set again; its stats
 * follow the account, so the GPN on the opponent list and on the player's own Defence tab is worked
 * out at the progress as it stands. The battle log reads, and keeps, only the last day's matches.
 * Needs the local Postgres from .env; skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { hqArenaLog, hqCollection, hqFights, hqLoadouts, hqShopUpgrades, hqState, hqTraitSlots } from '#server/database/schema'
import { ensureHqState, getCollections, getShopLevels, getTraitBoard } from '#server/utils/hero-quest'
import { arenaLog, attackArena, defenseGpnNow, defenseSnapshotOf, getCandidates, serializeArena, setDefense } from '#server/utils/hero-quest-arena'
import { ARENA_DUMMY_ID, arenaSeasonAt } from '#shared/utils/hero-quest/arena'
import { ARENA_LOG_SIZE } from '#shared/utils/hero-quest/constants'
import { ladderDateKey } from '#shared/utils/hero-quest/gacha'
import { traitRollsOf } from '#shared/utils/hero-quest/traits'
import { arenaPages, type ArenaView } from '../../app/utils/hero-quest-art/arena-scene'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const ATTACKER = 'test-hq-arena-def-attacker'
const DEFENDER = 'test-hq-arena-def-defender'
const PLAYERS = [ATTACKER, DEFENDER]
/** Far from any real account's Rating, so the band draws only these two. */
const RATING = 800_000
const LEVEL = 3000

async function cleanup() {
    await db.delete(hqArenaLog).where(inArray(hqArenaLog.userId, PLAYERS))
    for (const id of PLAYERS) {
        await db.delete(hqFights).where(eq(hqFights.userId, id))
        await db.delete(hqCollection).where(eq(hqCollection.userId, id))
        await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, id))
        await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, id))
        await db.delete(hqTraitSlots).where(eq(hqTraitSlots.userId, id))
        await db.delete(hqState).where(eq(hqState.userId, id))
        await cleanupUser(id)
    }
}

async function found(id: string) {
    await seedUser(id)
    await ensureHqState(id)
    await db.update(hqState).set({ heroLevel: LEVEL, arenaSeasonId: arenaSeasonAt(Date.now()), arenaRating: RATING }).where(eq(hqState.userId, id))
}

const stateOf = async (id: string) => (await db.select().from(hqState).where(eq(hqState.userId, id)))[0]!

async function setTrait(id: string, slotIndex: number, stat: string, grade: string) {
    await db.insert(hqTraitSlots).values({ userId: id, slotIndex, stat, grade, setId: 'set_aggression' })
        .onConflictDoUpdate({ target: [hqTraitSlots.userId, hqTraitSlots.slotIndex], set: { stat, grade } })
}

async function progressOf(id: string) {
    return { shopLevels: await getShopLevels(id), collections: await getCollections(id), traits: await getTraitBoard(id) }
}

describe('the battle log fits one page', () => {
    it('pages a full log as one', () => {
        const row = { outcome: 'WON', won: true, attacker: true, opponent: 'X', ratingChange: 5, medals: 3, ago: '1H' }
        const view = { tab: 'log', log: Array.from({ length: ARENA_LOG_SIZE }, () => row), shop: [], board: null } as unknown as ArenaView
        expect(arenaPages(view)).toBe(1)
    })
})

describe.skipIf(SKIP)('hero-quest arena defence and log', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('the defence (#32)', () => {
        it('shows a GPN that follows the hero\'s level without setting the defence again', async () => {
            await found(ATTACKER)
            await found(DEFENDER)
            const set = await db.transaction(tx => setDefense(tx, DEFENDER))
            expect((await getCandidates(ATTACKER, Date.now()))[0]!.defenseGpn).toBe(set.defenseGpn)

            await db.update(hqState).set({ heroLevel: LEVEL * 2 }).where(eq(hqState.userId, DEFENDER))
            const state = await stateOf(DEFENDER)
            const now = defenseGpnNow(state, await progressOf(DEFENDER))!

            expect(Number(now)).toBeGreaterThan(Number(set.defenseGpn))
            expect((await getCandidates(ATTACKER, Date.now()))[0]!.defenseGpn).toBe(now)
            expect(serializeArena(state, [], await progressOf(DEFENDER)).defense?.gpn).toBe(now)
            // the selection is untouched
            expect(state.defenseLoadout).toEqual(set.defense)
        })

        it('keeps the Traits it was set with, whatever the live board rolls since', async () => {
            await found(DEFENDER)
            await setTrait(DEFENDER, 0, 'trait_atk', 'SSS')
            await db.transaction(tx => setDefense(tx, DEFENDER))
            await setTrait(DEFENDER, 0, 'trait_hp', 'F')
            await setTrait(DEFENDER, 1, 'trait_spd', 'S')

            const state = await stateOf(DEFENDER)
            const progress = await progressOf(DEFENDER)
            const hero = defenseSnapshotOf(state, progress.shopLevels, progress.collections, progress.traits)!

            expect(hero.traits).toEqual([{ stat: 'trait_atk', grade: 'SSS', set: 'set_aggression' }])
            const shown = serializeArena(state, [], progress).defense!.traits
            expect(shown.map(t => t && [t.stat, t.grade])).toEqual([['trait_atk', 'SSS'], null, null, null, null])
        })

        it('fights a defence set before its Traits were kept on the live board', async () => {
            await found(DEFENDER)
            await db.transaction(tx => setDefense(tx, DEFENDER))
            const { traits: _, ...old } = (await stateOf(DEFENDER)).defenseLoadout!
            await db.update(hqState).set({ defenseLoadout: old }).where(eq(hqState.userId, DEFENDER))
            await setTrait(DEFENDER, 2, 'trait_hp', 'A')

            const state = await stateOf(DEFENDER)
            const progress = await progressOf(DEFENDER)

            expect(defenseSnapshotOf(state, progress.shopLevels, progress.collections, progress.traits)!.traits).toEqual(traitRollsOf(progress.traits))
            expect(serializeArena(state, [], progress).defense!.traits[2]).toMatchObject({ stat: 'trait_hp', grade: 'A' })
        })
    })

    describe('the battle log (#29)', () => {
        it('reads only the last day, and clears what is older on the next match', async () => {
            await found(ATTACKER)
            await getCandidates(ATTACKER, Date.now())
            await db.update(hqState).set({ arenaAttemptDate: ladderDateKey(Date.now()), arenaExtraAttemptsPurchasedToday: 5 }).where(eq(hqState.userId, ATTACKER))
            for (let i = 0; i < 3; i++) await db.transaction(tx => attackArena(tx, ATTACKER, 0, ARENA_DUMMY_ID, 0, Date.now()))
            // two of them a day and an hour old
            const [old1, old2] = await db.select({ id: hqArenaLog.id }).from(hqArenaLog).where(eq(hqArenaLog.userId, ATTACKER))
            await db.update(hqArenaLog).set({ createdAt: sql`clock_timestamp() - interval '25 hours'` }).where(inArray(hqArenaLog.id, [old1!.id, old2!.id]))

            expect(await arenaLog(ATTACKER)).toHaveLength(1)

            await db.transaction(tx => attackArena(tx, ATTACKER, 0, ARENA_DUMMY_ID, 0, Date.now()))
            const rows = await db.select().from(hqArenaLog).where(eq(hqArenaLog.userId, ATTACKER))
            expect(rows).toHaveLength(2)
            expect(rows.map(r => r.id)).not.toContain(old1!.id)
            expect(await arenaLog(ATTACKER)).toHaveLength(2)
        })
    })
})
