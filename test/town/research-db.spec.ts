import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { townState, townResearch, townInventory } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import { deleteTownForUser, settleTownForRead } from '#server/utils/town'
import {
    getTownResearchBoard,
    getTownResearchDone,
    settleTownResearch,
    startTownResearch
} from '#server/utils/town-research'
import { getTownResearch, TOWN_RESEARCH } from '#shared/utils/gamelogic/town-research'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-research-owner'
const USERS = [OWNER]

const FIRST = getTownResearch('yield-1')!
const SECOND = getTownResearch('yield-2')!

async function cleanup() {
    for (const id of USERS) {
        await db.delete(townResearch).where(eq(townResearch.userId, id))
        await deleteTownForUser(id)
        await cleanupUser(id)
    }
}

/**
 * A town rich enough to pay for a project, with the goods on the shelf.
 *
 * Deliberately does NOT call foundTown: that claims a square on the shared
 * world spiral, and this file runs in parallel with the specs that assert on
 * how towns are spaced. Research needs a town_state row and an inventory, not
 * land.
 */
async function foundRich(id: string) {
    await seedUser(id, { balance: '999999999999' })
    await db.insert(townState).values({ userId: id })
    // Founding seeds a few inventory rows of its own; replace the lot so the
    // shelf holds exactly what a project costs, ten times over.
    await db.delete(townInventory).where(eq(townInventory.userId, id))
    await db.insert(townInventory).values(
        Object.entries(FIRST.resources).map(([resource, quantity]) => ({
            userId: id,
            resource,
            amount: (quantity ?? 0) * 10
        }))
    )
}

/** Pretend the running project finished by winding its clock into the past. */
async function windClockBack(id: string) {
    await db.update(townState)
        .set({ researchCompletesAt: new Date(Date.now() - 1000) })
        .where(eq(townState.userId, id))
}

describe.skipIf(SKIP)('polytown research (database)', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('starts a project, charges for it, and puts a clock on the town', async () => {
        await foundRich(OWNER)
        const before = parseFloat(await getBalance(OWNER))

        const started = await startTownResearch(OWNER, FIRST.id)
        expect(started.researchId).toBe(FIRST.id)
        expect(started.completesAt).toBeGreaterThan(Date.now())

        const state = await db.query.townState.findFirst({ where: eq(townState.userId, OWNER) })
        expect(state?.researchId).toBe(FIRST.id)

        expect(parseFloat(await getBalance(OWNER))).toBeCloseTo(before - FIRST.coins, 2)
        const rows = await db.select().from(townInventory).where(eq(townInventory.userId, OWNER))
        for (const [resource, qty] of Object.entries(FIRST.resources)) {
            const line = rows.find(r => r.resource === resource)!
            expect(line.amount).toBe((qty ?? 0) * 9)
        }
    })

    it('runs one project at a time', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await expect(startTownResearch(OWNER, getTownResearch('trade-1')!.id))
            .rejects.toThrow(/already running/)
    })

    it('refuses a project whose prerequisite is not finished', async () => {
        await foundRich(OWNER)
        await expect(startTownResearch(OWNER, SECOND.id)).rejects.toThrow(/before it/)
    })

    it('refuses a project that does not exist', async () => {
        await foundRich(OWNER)
        await expect(startTownResearch(OWNER, 'not-a-project')).rejects.toThrow(/Unknown project/)
    })

    it('banks the project once its clock runs out, and frees the slot', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)

        await settleTownResearch(OWNER)
        expect(await getTownResearchDone(OWNER)).toEqual([FIRST.id])

        const state = await db.query.townState.findFirst({ where: eq(townState.userId, OWNER) })
        expect(state?.researchId).toBeNull()
        expect(state?.researchCompletesAt).toBeNull()
    })

    it('banks a finished project exactly once under a concurrent burst', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)

        await Promise.all(Array.from({ length: 5 }, () => settleTownResearch(OWNER).catch(() => null)))

        const rows = await db.select().from(townResearch).where(eq(townResearch.userId, OWNER))
        expect(rows).toHaveLength(1)
    })

    it('will not research the same project twice', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)
        await settleTownResearch(OWNER)
        await expect(startTownResearch(OWNER, FIRST.id)).rejects.toThrow(/Already researched/)
    })

    it('opens the next step once the one before it is banked', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)
        await settleTownResearch(OWNER)

        const board = await getTownResearchBoard(OWNER)
        expect(board.projects.find(p => p.id === FIRST.id)!.done).toBe(true)
        expect(board.projects.find(p => p.id === SECOND.id)!.unlocked).toBe(true)
    })

    it('hands the board back with every project on it', async () => {
        await foundRich(OWNER)
        const board = await getTownResearchBoard(OWNER)
        expect(board.projects).toHaveLength(TOWN_RESEARCH.length)
        expect(board.active).toBeNull()
        expect(board.done).toEqual([])
        // Only the first step of each branch starts open.
        expect(board.projects.filter(p => p.unlocked).map(p => p.step)).toEqual(
            board.projects.filter(p => p.step === 1).map(() => 1)
        )
    })

    it('takes the research with the town when the town is deleted', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)
        await settleTownResearch(OWNER)
        expect(await getTownResearchDone(OWNER)).toHaveLength(1)

        await deleteTownForUser(OWNER)
        const rows = await db.select().from(townResearch).where(inArray(townResearch.userId, USERS))
        expect(rows).toHaveLength(0)
    })



    it('banks a project that finished while the player was away, before settling the window', async () => {
        await foundRich(OWNER)
        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)

        // Nobody has opened the research window; the settle has to bank it.
        const settled = await settleTownForRead(OWNER)
        expect(settled.research.output).toBeGreaterThan(0)
        expect(await getTownResearchDone(OWNER)).toEqual([FIRST.id])
    })

    it('hands the settle result the bonus it paid out with', async () => {
        await foundRich(OWNER)
        const before = await settleTownForRead(OWNER)
        expect(before.research.output).toBe(0)

        await startTownResearch(OWNER, FIRST.id)
        await windClockBack(OWNER)
        const after = await settleTownForRead(OWNER)
        expect(after.research.output).toBe(FIRST.effect.output)
    })
})
