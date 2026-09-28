import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { townBuildings, townInventory, townState } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import {
    deleteTownForUser,
    demolishBuilding,
    demolishBuildings,
    foundTown,
    placeBuilding,
    rushBuilding,
    settleTownForRead,
    upgradeBuilding
} from '#server/utils/town'
import { TOWN_FREE_BUILDERS } from '#shared/utils/gamelogic/town'
import { getTownMonument, townMonumentStageCost } from '#shared/utils/gamelogic/town-monuments'
import { SKIP, burst, cleanupUser, lockTownRealm, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-monuments-owner'
const PYRAMID = getTownMonument('pyramid')!

async function cleanup() {
    await deleteTownForUser(OWNER)
    await cleanupUser(OWNER)
}

/**
 * A town that has earned tier 2: a street along row 0, a big house and a farm
 * on it, the tier-1 goods already made, and a warehouse's worth of the goods
 * every early monument stage asks for. Seeded straight into the tables, since
 * growing it through the game would take hours of timers.
 */
async function tierTwoTown() {
    await seedUser(OWNER, { balance: '100000000000', gems: 5000 })
    const { plotId } = await foundTown(OWNER)
    await moveTownToFlatGround(plotId)
    for (let x = 0; x < 8; x++) await placeBuilding(OWNER, plotId, x, 0, 'road')
    const past = new Date(Date.now() - 60_000)
    await db.insert(townBuildings).values([
        { userId: OWNER, plotId, type: 'house', tileX: 0, tileY: 1, rotation: 2, level: 20, completesAt: past },
        { userId: OWNER, plotId, type: 'farm', tileX: 1, tileY: 1, rotation: 2, level: 1, completesAt: past }
    ])
    await db.update(townState).set({ produced: { wheat: 10_000 } }).where(eq(townState.userId, OWNER))
    await db.insert(townInventory).values(['stone', 'planks', 'bricks', 'tools'].map(resource => ({ userId: OWNER, resource, amount: 1_000_000 })))
    return plotId
}

async function monumentRow(type: string) {
    const [row] = await db.select().from(townBuildings).where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, type)))
    return row
}

describe.skipIf(SKIP)('Polytown monuments (database)', () => {
    let releaseRealm: () => Promise<void>
    beforeAll(async () => { releaseRealm = await lockTownRealm() }, 120_000)

    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => {
        await releaseRealm()
        await db.$client.end()
    })

    it('breaks ground with its own crew while every builder is busy', async () => {
        const plotId = await tierTwoTown()
        for (let x = 0; x < TOWN_FREE_BUILDERS; x++) await placeBuilding(OWNER, plotId, 5 + x, 1, 'house', 2)
        await expect(placeBuilding(OWNER, plotId, 2, 1, 'house', 2)).rejects.toThrow(/builder/i)

        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        const pyramid = await monumentRow('pyramid')
        expect(pyramid?.level).toBe(0)
    })

    it('covers its whole footprint, and only fits on one plot', async () => {
        const plotId = await tierTwoTown()
        await expect(placeBuilding(OWNER, plotId, 6, 1, 'pyramid', 2)).rejects.toThrow(/one plot/)
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        // (3, 2) is the middle of the pyramid's 3×3 square, not its anchor.
        await expect(placeBuilding(OWNER, plotId, 3, 2, 'road')).rejects.toThrow(/taken/)
    })

    it('allows one of each', async () => {
        const plotId = await tierTwoTown()
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        await expect(placeBuilding(OWNER, plotId, 5, 3, 'pyramid', 2)).rejects.toThrow(/only have one/)
    })

    it('raises one stage at a time across every monument', async () => {
        const plotId = await tierTwoTown()
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        const pyramid = (await monumentRow('pyramid'))!
        await rushBuilding(OWNER, pyramid.id)
        await upgradeBuilding(OWNER, pyramid.id)

        // A second monument waits for the crew, however many builders stand idle.
        for (let x = 0; x < 3; x++) await placeBuilding(OWNER, plotId, x, 4, 'road')
        await expect(placeBuilding(OWNER, plotId, 0, 5, 'colosseum', 2)).rejects.toThrow(/monument crew/)
    })

    it('starts a stage once however many requests race for it, and charges once', async () => {
        const plotId = await tierTwoTown()
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        const pyramid = (await monumentRow('pyramid'))!
        await rushBuilding(OWNER, pyramid.id)
        const before = parseFloat(await getBalance(OWNER))

        const { ok } = await burst(8, () => upgradeBuilding(OWNER, pyramid.id))
        expect(ok).toBe(1)
        expect((await monumentRow('pyramid'))?.upgradingTo).toBe(2)
        expect(before - parseFloat(await getBalance(OWNER))).toBeCloseTo(townMonumentStageCost(PYRAMID, 2).coins, 2)
    })

    it('gives its perk once the first stage stands', async () => {
        const plotId = await tierTwoTown()
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        expect((await settleTownForRead(OWNER)).bonus.buildTime).toBe(0)
        await rushBuilding(OWNER, (await monumentRow('pyramid'))!.id)
        expect((await settleTownForRead(OWNER)).bonus.buildTime).toBe(PYRAMID.stages[0]!.buildTime)
    })

    it('puts a monument up at the stage research carried over, free, whatever the tier', async () => {
        const plotId = await tierTwoTown()
        await db.update(townState).set({ monumentCredit: { eiffel: 3 } }).where(eq(townState.userId, OWNER))
        const before = parseFloat(await getBalance(OWNER))

        // The Eiffel Tower opens at tier 4, which this town is nowhere near.
        await placeBuilding(OWNER, plotId, 2, 1, 'eiffel', 2)
        const eiffel = (await monumentRow('eiffel'))!
        expect(eiffel.level).toBe(3)
        expect(eiffel.completesAt.getTime()).toBeLessThanOrEqual(Date.now())
        expect(parseFloat(await getBalance(OWNER))).toBe(before)
        const settled = await settleTownForRead(OWNER)
        expect(settled.state.monumentCredit).toEqual({})
        expect(settled.bonus.output).toBeCloseTo(0.14)
    })

    it('spends a research credit once however many placements race for it', async () => {
        const plotId = await tierTwoTown()
        await db.update(townState).set({ monumentCredit: { pyramid: 2 } }).where(eq(townState.userId, OWNER))
        const spots = [[2, 1], [5, 1]] as const
        for (let x = 0; x < 8; x++) await placeBuilding(OWNER, plotId, x, 4, 'road')
        const { ok } = await burst(4, i => placeBuilding(OWNER, plotId, spots[i % 2]![0], i < 2 ? 1 : 5, 'pyramid', 2))
        expect(ok).toBe(1)
        const rows = await db.select().from(townBuildings).where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, 'pyramid')))
        expect(rows).toHaveLength(1)
        expect(rows[0]!.level).toBe(2)
    })

    it('cannot be demolished, alone or in a selection', async () => {
        const plotId = await tierTwoTown()
        await placeBuilding(OWNER, plotId, 2, 1, 'pyramid', 2)
        const pyramid = (await monumentRow('pyramid'))!
        await expect(demolishBuilding(OWNER, pyramid.id)).rejects.toThrow(/cannot be demolished/)

        const road = (await db.select().from(townBuildings).where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, 'road'))))[7]!
        const { demolished } = await demolishBuildings(OWNER, [pyramid.id, road.id])
        expect(demolished).toEqual([road.id])
        expect(await monumentRow('pyramid')).toBeDefined()
    })
})
