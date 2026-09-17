import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townResearch } from '#server/database/schema'
import {
    deleteTownForUser,
    foundTown,
    hireTownBuilder,
    placeBuilding,
    settleTownForRead
} from '#server/utils/town'
import { getTownResearchBoard } from '#server/utils/town-research'
import { TOWN_RESEARCH_BRANCHES } from '#shared/utils/gamelogic/town-research'
import { TOWN_FREE_BUILDERS, TOWN_MAX_BUILDERS } from '#shared/utils/gamelogic/town'
import { SKIP, cleanupUser, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-smoke-owner'

async function cleanup() {
    await db.delete(townResearch).where(eq(townResearch.userId, OWNER))
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

/**
 * The path a brand-new mayor actually walks, start to finish. Every other spec
 * tests one rule; this one exists to catch the case where the rules are all
 * right and the game is still unplayable from a standing start.
 */
describe.skipIf(SKIP)('a new mayor can play (database)', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    it('founds a town, lays a road, and puts up a house and a lumber camp', async () => {
        await seedUser(OWNER, { balance: '100000000000', gems: 5000 })
        const { plotId } = await foundTown(OWNER)
        expect(plotId).toBeTruthy()
        // Fixed tile coordinates only mean anything on ground with no water on it.
        await moveTownToFlatGround(plotId)

        await placeBuilding(OWNER, plotId, 0, 0, 'road')
        await placeBuilding(OWNER, plotId, 1, 0, 'road')
        // Rotation 2 faces -y, which is the road laid on row zero.
        await placeBuilding(OWNER, plotId, 0, 1, 'house', 2)
        // A lumber camp costs coins only, which is all a new town has.
        await placeBuilding(OWNER, plotId, 1, 1, 'lumber', 2)

        const settled = await settleTownForRead(OWNER)
        expect(settled.buildings).toHaveLength(4)
        expect(settled.state.builders).toBe(TOWN_FREE_BUILDERS)
        // Nothing researched yet, so every bonus is zero.
        expect(settled.research.output).toBe(0)
    })

    it('stops the mayor at the crew cap, and lets them buy their way past it', async () => {
        await seedUser(OWNER, { balance: '100000000000', gems: 5000 })
        const { plotId } = await foundTown(OWNER)
        await moveTownToFlatGround(plotId)
        for (let x = 0; x < 6; x++) await placeBuilding(OWNER, plotId, x, 0, 'road')

        // Roads are instant and hold nobody; the next three take every crew.
        for (let x = 0; x < TOWN_FREE_BUILDERS; x++) {
            await placeBuilding(OWNER, plotId, x, 1, 'house', 2)
        }
        await expect(placeBuilding(OWNER, plotId, TOWN_FREE_BUILDERS, 1, 'house', 2))
            .rejects.toThrow(/builder/i)

        const hired = await hireTownBuilder(OWNER)
        expect(hired.builders).toBe(TOWN_FREE_BUILDERS + 1)
        expect(hired.gems).toBeGreaterThan(0)
        // With the extra crew, the job that was refused now starts.
        await placeBuilding(OWNER, plotId, TOWN_FREE_BUILDERS, 1, 'house', 2)
    })

    it('will not sell more crews than the cap allows', async () => {
        await seedUser(OWNER, { balance: '100000000000', gems: 100_000 })
        await foundTown(OWNER)
        for (let i = TOWN_FREE_BUILDERS; i < TOWN_MAX_BUILDERS; i++) await hireTownBuilder(OWNER)
        await expect(hireTownBuilder(OWNER)).rejects.toThrow(/already have/)
    })

    it('opens a research board with the first project of every branch ready', async () => {
        await seedUser(OWNER, { balance: '100000000000' })
        await foundTown(OWNER)
        const board = await getTownResearchBoard(OWNER)
        expect(board.active).toBeNull()
        expect(board.projects.filter(p => p.unlocked && p.step === 1))
            .toHaveLength(TOWN_RESEARCH_BRANCHES.length)
    })
})
