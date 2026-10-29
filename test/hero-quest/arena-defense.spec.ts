/**
 * The Arena defence as it is fought (issue #32): a defence keeps the selection it was set with,
 * Traits included, until it is set again. Needs the local Postgres from .env; skips when
 * DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { hqArenaLog, hqCollection, hqFights, hqLoadouts, hqShopUpgrades, hqState, hqTraitSlots } from '#server/database/schema'
import { ensureHqState, getCollections, getShopLevels, getTraitBoard } from '#server/utils/hero-quest'
import { defenseSnapshotOf, serializeArena, setDefense } from '#server/utils/hero-quest-arena'
import { arenaSeasonAt } from '#shared/utils/hero-quest/arena'
import { traitRollsOf } from '#shared/utils/hero-quest/traits'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const DEFENDER = 'test-hq-arena-def-defender'
const PLAYERS = [DEFENDER]
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

describe.skipIf(SKIP)('hero-quest arena defence', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('the defence (#32)', () => {
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
})
