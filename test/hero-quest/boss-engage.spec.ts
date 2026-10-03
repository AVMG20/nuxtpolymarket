/**
 * Boss engagement grants value — Milestone Seals on every win — so it is a concurrency question
 * as much as a combat one, and needs a real database and a real row lock.
 *
 * The case this exists for: the World 10 super boss. A win anywhere else moves the run off its
 * gate, so the gate check alone resolves a burst to one fight. A win there does not move the
 * run (`nextStage` is a fixed point), which left a cleared run re-fightable forever and a burst
 * on the first clear paying once per queued request.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { hqCollection, hqFights, hqLoadouts, hqShopUpgrades, hqState } from '#server/database/schema'
import { ensureHqState, resolveBossEngage } from '#server/utils/hero-quest'
import {
    BOSS_STAGE,
    SEAL_GRANT_PER_BOSS,
    SEAL_GRANT_PER_WORLD_CLEAR,
    SUPER_BOSS_STAGE,
    WORLD_COUNT
} from '#shared/utils/hero-quest/constants'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-hero-quest-boss-engage-user'

/** Far past the ~524 a solo Beginner needs for the first loop's last gate, so every fight is a win. */
const OVERWHELMING_LEVEL = 3000

async function cleanup() {
    await db.delete(hqFights).where(eq(hqFights.userId, USER_ID))
    await db.delete(hqCollection).where(eq(hqCollection.userId, USER_ID))
    await db.delete(hqLoadouts).where(eq(hqLoadouts.userId, USER_ID))
    await db.delete(hqShopUpgrades).where(eq(hqShopUpgrades.userId, USER_ID))
    await db.delete(hqState).where(eq(hqState.userId, USER_ID))
    await cleanupUser(USER_ID)
}

async function parkAt(world: number, stage: number, runCleared = false, heroLevel = OVERWHELMING_LEVEL) {
    await db.update(hqState)
        .set({ world, stage, killCount: 0, killFraction: 0, atBossGate: true, runCleared, heroLevel })
        .where(eq(hqState.userId, USER_ID))
}

async function readState() {
    const [state] = await db.select().from(hqState).where(eq(hqState.userId, USER_ID))
    if (!state) throw new Error('no hq_state row')
    return state
}

const seals = (state: Awaited<ReturnType<typeof readState>>) =>
    [state.forgeSeals, state.guildSeals, state.skillSeals, state.excavationSeals]

const engage = () => db.transaction(tx => resolveBossEngage(tx, USER_ID, 0))

async function fightCount() {
    return (await db.select().from(hqFights).where(eq(hqFights.userId, USER_ID))).length
}

describe.skipIf(SKIP)('boss engage', () => {
    beforeEach(async () => {
        await cleanup()
        await seedUser(USER_ID)
        await ensureHqState(USER_ID)
    })
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('pays the first clear of the run exactly once, however many engages race for it', async () => {
        await parkAt(WORLD_COUNT, SUPER_BOSS_STAGE)
        const before = seals(await readState())

        const result = await burst(10, engage)

        expect(result.ok).toBe(1)
        expect(result.rejected).toBe(9)
        const after = await readState()
        expect(after.runCleared).toBe(true)
        const batch = SEAL_GRANT_PER_BOSS + SEAL_GRANT_PER_WORLD_CLEAR
        expect(seals(after)).toEqual(before.map(count => count + batch))
        expect(await fightCount()).toBe(1)
    })

    it('refuses to re-fight the final boss of a cleared run', async () => {
        await parkAt(WORLD_COUNT, SUPER_BOSS_STAGE)
        const first = await engage()
        expect(first.outcome).toBe('win')
        expect(first.runComplete).toBe(true)

        const afterClear = await readState()
        await expect(engage()).rejects.toMatchObject({ statusCode: 400 })

        const afterRetry = await readState()
        expect(seals(afterRetry)).toEqual(seals(afterClear))
        expect(afterRetry.runCleared).toBe(true)
        expect(await fightCount()).toBe(1)
    })

    it('still resolves an ordinary gate once under a burst', async () => {
        await parkAt(1, BOSS_STAGE)
        const before = seals(await readState())

        const result = await burst(10, engage)

        expect(result.ok).toBe(1)
        const after = await readState()
        expect(after.stage).toBe(BOSS_STAGE + 1)
        expect(after.runCleared).toBe(false)
        expect(seals(after)).toEqual(before.map(count => count + SEAL_GRANT_PER_BOSS))
        expect(await fightCount()).toBe(1)
    })

    it('remembers a boss that beat the party, and forgets it once beaten', async () => {
        // a level-1 Beginner against World 5's boss cannot win; the run falls back a stage
        await parkAt(5, BOSS_STAGE, false, 1)
        expect((await engage()).outcome).not.toBe('win')
        const lost = await readState()
        expect(lost.stage).toBe(BOSS_STAGE - 1)
        expect(lost.bossLost).toBe(true)

        await parkAt(5, BOSS_STAGE)
        await db.update(hqState).set({ bossLost: true }).where(eq(hqState.userId, USER_ID))
        expect((await engage()).outcome).toBe('win')
        expect((await readState()).bossLost).toBe(false)
    })
})
