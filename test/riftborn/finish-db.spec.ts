import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { riftbornState } from '#server/database/schema'
import { ensureRiftbornState, settleRiftbornRun } from '#server/utils/riftborn'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const OWNER = 'test-riftborn-finish-owner'

async function cleanup() {
    await db.delete(riftbornState).where(eq(riftbornState.userId, OWNER))
    await cleanupUser(OWNER)
}

/** A run that has been going for `seconds`, replacing any earlier one. */
async function deploy(seconds: number) {
    await ensureRiftbornState(OWNER)
    const runId = crypto.randomUUID()
    await db.update(riftbornState)
        .set({ runId, runClass: 'knight', runStartedAt: new Date(Date.now() - seconds * 1000), runSkills: {} })
        .where(eq(riftbornState.userId, OWNER))
    return runId
}

describe.skipIf(SKIP)('Riftborn finish (database)', () => {
    beforeEach(() => seedUser(OWNER))
    afterEach(cleanup)
    afterAll(async () => {
        await db.$client.end()
    })

    it('counts a burst of finishes for one run exactly once', async () => {
        const runId = await deploy(300)
        const report = { time: 300, kills: 1200, eliteKills: 8, bossKills: 1, level: 20, shards: 40, victory: false }
        const result = await burst(8, () => settleRiftbornRun(OWNER, runId, report))
        expect(result.ok).toBe(1)

        const [row] = await db.select().from(riftbornState).where(eq(riftbornState.userId, OWNER))
        expect(row!.runsPlayed).toBe(1)
        expect(row!.totalKills).toBe(1200)
        expect(row!.runId).toBeNull()
        expect(row!.achievements).toEqual(expect.arrayContaining(['first-steps', 'survivor', 'slayer', 'boss-slayer']))
    })

    it('refuses a finish for a run that was replaced by a newer one', async () => {
        const stale = await deploy(60)
        await deploy(10)
        await expect(settleRiftbornRun(OWNER, stale, { time: 60 })).rejects.toThrow('This run is already over')
    })
})
