import { and, eq, isNotNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { callOfXenoState, user } from '#server/database/schema'
import { seedUser, SKIP } from '../setup/db-helpers'
import { CALL_OF_XENO_SAVE_VERSION, type CallOfXenoRunSave } from '#shared/utils/gamelogic/call-of-xeno-save'

const userId = 'test-xeno-save-cas'

function save(overrides: Partial<CallOfXenoRunSave> = {}): CallOfXenoRunSave {
    return {
        version: CALL_OF_XENO_SAVE_VERSION,
        round: 5,
        score: 4200,
        grossEarned: 9000,
        hp: 180,
        hpMax: 250,
        perks: ['juggernog'],
        quickReviveBuys: 0,
        weapons: [{ base: 'm1911', tier: 0, mag: 8, reserve: 80 }],
        activeSlot: 0,
        equipment: ['drone'],
        powered: true,
        doors: ['door-barracks-mess'],
        x: 8,
        z: 4,
        y: 0,
        yaw: 1.2,
        runTime: 620,
        stats: {
            kills: 120,
            headshots: 40,
            spins: 2,
            barrels: 3,
            boards: 15
        },
        ...overrides
    }
}

/** The endpoint's exact CAS write, against the real database. */
async function casSave(revision: number, next: CallOfXenoRunSave) {
    const [row] = await db.update(callOfXenoState).set({
        runSave: next,
        runSaveRevision: revision + 1
    }).where(and(
        eq(callOfXenoState.userId, userId),
        eq(callOfXenoState.runSaveRevision, revision),
        isNotNull(callOfXenoState.runStartedAt)
    )).returning({ revision: callOfXenoState.runSaveRevision })
    return row ?? null
}

describe.skipIf(SKIP)('call of xeno checkpoint storage', () => {
    beforeAll(async () => {
        await seedUser(userId)
        await db.insert(callOfXenoState).values({ userId })
        // Simulate a deploy: armed run, fresh checkpoint slot.
        await db.update(callOfXenoState).set({
            runStartedAt: new Date(),
            runDifficultySnapshot: 'recruit',
            runPayoutMultSnapshot: '1.0000',
            runSave: null,
            runSaveRevision: 0
        }).where(eq(callOfXenoState.userId, userId))
    })

    afterAll(async () => {
        await db.delete(user).where(eq(user.id, userId))
    })

    it('round-trips a full checkpoint through the jsonb column unchanged', async () => {
        const full = save({
            perks: ['juggernog', 'speedcola', 'doubletap', 'quickrevive'],
            weapons: [
                { base: 'ak74', tier: 3, mag: 30, reserve: 270 },
                { base: 'm1911', tier: 0, mag: 0, reserve: 0 }
            ],
            activeSlot: 1,
            x: -12.34,
            yaw: 3.1415
        })
        expect(await casSave(0, full)).toEqual({ revision: 1 })
        const [row] = await db.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId))
        expect(row?.runSave).toEqual(full)
        expect(row?.runSaveRevision).toBe(1)
    })

    it('lets exactly one writer claim a revision under a concurrent burst', async () => {
        await db.update(callOfXenoState).set({ runSaveRevision: 0, runSave: null })
            .where(eq(callOfXenoState.userId, userId))
        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, i) => casSave(0, save({ round: 6 + i }))))
        const winners = results.filter(r => r.status === 'fulfilled' && r.value !== null)
        expect(winners).toHaveLength(1)
        const [row] = await db.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId))
        expect(row?.runSaveRevision).toBe(1)
    })

    it('refuses a stale revision once the slot has moved on', async () => {
        expect(await casSave(0, save({ round: 9 }))).toBeNull()
        // The stored checkpoint is still the burst winner's.
        const [row] = await db.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId))
        expect(row?.runSave?.round).toBeGreaterThanOrEqual(6)
        expect(row?.runSave?.round).toBeLessThanOrEqual(15)
    })

    it('refuses to save once the run has been settled (lock cleared)', async () => {
        await db.update(callOfXenoState).set({
            runStartedAt: null,
            runDifficultySnapshot: null,
            runPayoutMultSnapshot: null,
            runSave: null,
            runSaveRevision: 0,
            lastRunFinishedAt: new Date()
        }).where(eq(callOfXenoState.userId, userId))
        // Revision matches (0 == 0) but the run is no longer armed — the
        // runStartedAt guard must refuse the write.
        expect(await casSave(0, save())).toBeNull()
        const [row] = await db.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId))
        expect(row?.runSave).toBeNull()
    })
})
