/**
 * Parallel builders.
 *
 * A colony has one builder for free and up to two more from the prestige
 * shop's Labour Contract. The rules that matter are: never more jobs than
 * builders, and never two builders on the same job — a second builder on
 * `capacity` would collect "level N+1" twice for one payment.
 *
 * Needs the local Postgres from .env. Skips when DATABASE_URL is unset.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { colonyBuilderJobs, colonyState, prestigePurchases, user } from '#server/database/schema'
import { claimBuilder, getBuilderCount, getBuilderJobs } from '#server/utils/colony'
import { BASE_BUILDER_COUNT, HABITAT_BUILDER_JOB_ID } from '#shared/utils/colony'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USER_ID = 'test-colony-builders-user'

async function seedColony(labourContracts = 0) {
    await seedUser(USER_ID)
    await db.insert(colonyState).values({ userId: USER_ID })
    if (labourContracts > 0) {
        await db.insert(prestigePurchases).values({ userId: USER_ID, itemId: 'colony-builder', count: labourContracts })
        await db.update(user).set({ prestige: 1 }).where(eq(user.id, USER_ID))
    }
}

/** claimBuilder always runs inside the caller's transaction. */
function claim(trackId: string) {
    return db.transaction(tx => claimBuilder(USER_ID, trackId, tx))
}

async function cleanup() {
    await cleanupUser(USER_ID)
}

describe.skipIf(SKIP)('colony builders', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('gives a colony one builder before any Labour Contract', async () => {
        await seedColony()
        expect(await getBuilderCount(USER_ID)).toBe(BASE_BUILDER_COUNT)
    })

    it('refuses a second job while the only builder is busy', async () => {
        await seedColony()

        await claim('capacity')
        await expect(claim('speed_boost')).rejects.toThrow(/busy/i)
        expect(await getBuilderJobs(USER_ID)).toHaveLength(1)
    })

    it('runs three tracks at once with both Labour Contracts', async () => {
        await seedColony(2)
        expect(await getBuilderCount(USER_ID)).toBe(BASE_BUILDER_COUNT + 2)

        await claim('capacity')
        await claim('speed_boost')
        await claim(HABITAT_BUILDER_JOB_ID)

        expect(await getBuilderJobs(USER_ID)).toHaveLength(3)
        await expect(claim('yield_boost')).rejects.toThrow(/busy/i)
    })

    // The whole reason the (user, track) constraint exists: two builders on
    // one track would each collect the same level, paid for once.
    it('never puts two builders on the same track', async () => {
        await seedColony(2)

        await claim('capacity')
        await expect(claim('capacity')).rejects.toThrow(/already working on this/i)
        expect(await getBuilderJobs(USER_ID)).toHaveLength(1)
    })

    // Reading the busy count and then inserting is a read-then-write, so the
    // capacity check has to be serialized by the user-row lock — otherwise N
    // simultaneous starts on N different tracks all see "0 busy".
    it('serialises a burst of concurrent starts against the builder count', async () => {
        await seedColony(1)
        const tracks = ['capacity', 'yield_boost', 'speed_boost', 'nutrition_storage', 'nutrition_efficiency']

        const result = await burst(tracks.length, i => claim(tracks[i]!))

        expect(result.ok).toBe(BASE_BUILDER_COUNT + 1)
        expect(result.rejected).toBe(tracks.length - (BASE_BUILDER_COUNT + 1))
        expect(await getBuilderJobs(USER_ID)).toHaveLength(BASE_BUILDER_COUNT + 1)
    })

    it('frees the builder again once its job row is gone', async () => {
        await seedColony()

        await claim('capacity')
        await db.delete(colonyBuilderJobs).where(eq(colonyBuilderJobs.userId, USER_ID))

        await expect(claim('speed_boost')).resolves.toBeTruthy()
    })
})
