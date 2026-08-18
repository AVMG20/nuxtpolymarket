import { and, eq, isNotNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { callOfXenoState, user } from '#server/database/schema'
import { getLockedCallOfXenoState } from '#server/utils/call-of-xeno'
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

/**
 * The endpoint's exact claim, against the real database: lock the row, take
 * the stored depth from inside that lock, refuse anything shallower, write.
 * The revision the client sends is deliberately not part of the guard.
 */
async function storeSave(next: CallOfXenoRunSave) {
    return db.transaction(async (tx) => {
        const state = await getLockedCallOfXenoState(tx, userId)
        if (!state.runStartedAt) return null
        if (next.round < (state.runSave?.round ?? 0)) return null
        const [row] = await tx.update(callOfXenoState).set({
            runSave: next,
            runSaveRevision: state.runSaveRevision + 1
        }).where(and(
            eq(callOfXenoState.userId, userId),
            isNotNull(callOfXenoState.runStartedAt)
        )).returning({ revision: callOfXenoState.runSaveRevision })
        return row ?? null
    })
}

async function stored() {
    const [row] = await db.select().from(callOfXenoState).where(eq(callOfXenoState.userId, userId))
    return row!
}

async function arm() {
    await db.update(callOfXenoState).set({
        runStartedAt: new Date(),
        runDifficultySnapshot: 'recruit',
        runPayoutMultSnapshot: '1.0000',
        runSave: null,
        runSaveRevision: 0
    }).where(eq(callOfXenoState.userId, userId))
}

describe.skipIf(SKIP)('call of xeno checkpoint storage', () => {
    beforeAll(async () => {
        await seedUser(userId)
        await db.insert(callOfXenoState).values({ userId })
        // Simulate a deploy: armed run, fresh checkpoint slot.
        await arm()
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
        expect(await storeSave(full)).toEqual({ revision: 1 })
        const row = await stored()
        expect(row.runSave).toEqual(full)
        expect(row.runSaveRevision).toBe(1)
    })

    /**
     * The bug this replaced the revision CAS for: the client's save is
     * fire-and-forget, so a committed write whose response is lost leaves
     * the client's counter behind forever. Under the old counter guard
     * every later round was refused and the checkpoint froze — which the
     * settle then read as the round the run reached, capping a round-42 run
     * at whatever round the blip happened on.
     */
    it('keeps accepting deeper rounds after the client has lost track of the revision', async () => {
        await arm()
        expect(await storeSave(save({ round: 12 }))).toEqual({ revision: 1 })
        // The client never saw that response — it still believes revision 0.
        for (const round of [13, 14, 15]) {
            expect(await storeSave(save({ round }))).not.toBeNull()
        }
        const row = await stored()
        expect(row.runSave?.round).toBe(15)
        expect(row.runSaveRevision).toBe(4)
    })

    it('refuses a checkpoint shallower than the one already stored', async () => {
        await arm()
        await storeSave(save({ round: 20 }))
        expect(await storeSave(save({ round: 9 }))).toBeNull()
        expect((await stored()).runSave?.round).toBe(20)
    })

    it('never moves the checkpoint backwards under a concurrent burst', async () => {
        await arm()
        await storeSave(save({ round: 30 }))
        const results = await Promise.allSettled(
            Array.from({ length: 10 }, (_, i) => storeSave(save({ round: 24 + i }))))
        const winners = results.filter(r => r.status === 'fulfilled' && r.value !== null)
        const row = await stored()
        // Serialised by the row lock: the shallow ones lose, and whatever
        // landed is at least as deep as what was already there.
        expect(row.runSave?.round).toBeGreaterThanOrEqual(30)
        expect(row.runSaveRevision).toBe(1 + winners.length)
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
        expect(await storeSave(save())).toBeNull()
        expect((await stored()).runSave).toBeNull()
    })
})
