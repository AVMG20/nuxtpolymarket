import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { townState, townBuildings, townInventory } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import {
    demolishBuildings,
    foundTown,
    moveBuildings,
    placeBuildings,
    upgradeBuildings,
    deleteTownForUser
} from '#server/utils/town'
import {
    TOWN_MAX_DRAG_TILES,
    getTownBuilding,
    getTownTerrain,
    townTerrainAt,
    townGroupMoveIssue,
    townPlaceCost,
    type TownResourceId,
    type TownSimBuilding
} from '#shared/utils/gamelogic/town'
import { SKIP, cleanupUser, moveTownToFlatGround, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-controls'
const ROAD = getTownBuilding('road')!
const FARM = getTownBuilding('farm')!
const MINUTE = 60_000

/** Rotation 2 faces −y: a building on (x, 1) fronts a road on (x, 0). */
const FACES_EDGE_ROAD = 2

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe('townGroupMoveIssue', () => {
    const sim = (over: Partial<TownSimBuilding> & { id: string, type: TownSimBuilding['type'] }): TownSimBuilding => ({
        level: 1, completesAt: 0, upgradingTo: null, createdAt: 0, rotation: 0, ...over
    })
    const road = (id: string, wx: number, wy: number) => sim({ id, type: 'road', wx, wy })
    const house = (id: string, wx: number, wy: number, rotation = FACES_EDGE_ROAD) => sim({ id, type: 'house', wx, wy, rotation })

    it('lets a block carry its own street', () => {
        const buildings = [road('r', 0, 0), house('h', 0, 1)]
        const issue = townGroupMoveIssue(buildings, [
            { id: 'r', wx: 5, wy: 5, rotation: 0 },
            { id: 'h', wx: 5, wy: 6, rotation: FACES_EDGE_ROAD }
        ])
        expect(issue).toBeNull()
    })

    it('refuses a tile something outside the group is standing on', () => {
        const buildings = [road('r', 0, 0), road('other', 4, 4)]
        expect(townGroupMoveIssue(buildings, [{ id: 'r', wx: 4, wy: 4, rotation: 0 }])).toMatch(/already taken/)
    })

    it('refuses two members landing on the same tile', () => {
        const buildings = [road('a', 0, 0), road('b', 1, 0)]
        expect(townGroupMoveIssue(buildings, [
            { id: 'a', wx: 6, wy: 6, rotation: 0 },
            { id: 'b', wx: 6, wy: 6, rotation: 0 }
        ])).toMatch(/already taken/)
    })

    it('refuses water', () => {
        let x = 0
        while (!getTownTerrain(townTerrainAt(x, 0)).blocked) x++
        expect(townGroupMoveIssue([road('r', 0, 3)], [{ id: 'r', wx: x, wy: 0, rotation: 0 }])).toMatch(/water/)
    })
})

// ─── Database ────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('polytown bulk controls (database)', () => {
    afterEach(async () => {
        await deleteTownForUser(OWNER)
        await db.delete(townInventory).where(eq(townInventory.userId, OWNER))
        await cleanupUser(OWNER)
    })
    afterAll(async () => {
        await cleanupUser(OWNER)
    })

    async function foundFor(balance = '10000000.0000') {
        await seedUser(OWNER, { balance })
        const { plotId } = await foundTown(OWNER)
        await moveTownToFlatGround(plotId)
        await db.update(townState).set({ builders: 99 }).where(eq(townState.userId, OWNER))
        return plotId
    }

    async function stock(resource: TownResourceId, amount: number) {
        await db.insert(townInventory).values({ userId: OWNER, resource, amount })
            .onConflictDoUpdate({ target: [townInventory.userId, townInventory.resource], set: { amount } })
    }

    async function own(type?: string) {
        const where = type
            ? and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, type))
            : eq(townBuildings.userId, OWNER)
        return db.select().from(townBuildings).where(where)
    }

    describe('placeBuildings', () => {
        it('lays a whole run of road in one call, each tile priced as the next copy', async () => {
            const plotId = await foundFor()
            const before = parseFloat(await getBalance(OWNER))

            const res = await placeBuildings(OWNER, [0, 1, 2, 3].map(tileX => ({ plotId, tileX, tileY: 0, type: 'road', rotation: 0 })))

            expect(res.placed).toHaveLength(4)
            expect(res.skipped).toBe(0)
            expect(await own('road')).toHaveLength(4)
            const spent = [0, 1, 2, 3].reduce((sum, n) => sum + townPlaceCost(ROAD, n).coins, 0)
            expect(parseFloat(await getBalance(OWNER))).toBeCloseTo(before - spent, 4)
        })

        it('stops where the purse runs out instead of failing the whole drag', async () => {
            // Enough for two road tiles and not the third.
            const afford = townPlaceCost(ROAD, 0).coins + townPlaceCost(ROAD, 1).coins + Math.floor(townPlaceCost(ROAD, 2).coins / 2)
            const plotId = await foundFor(afford.toFixed(4))

            const res = await placeBuildings(OWNER, [0, 1, 2, 3].map(tileX => ({ plotId, tileX, tileY: 0, type: 'road', rotation: 0 })))

            expect(res.placed).toHaveLength(2)
            expect(res.reason).toMatch(/Not enough coins/)
            expect(await own('road')).toHaveLength(2)
            expect(parseFloat(await getBalance(OWNER))).toBeGreaterThanOrEqual(0)
        })

        it('stops when the goods run out, and never charges for a tile it skipped', async () => {
            const plotId = await foundFor()
            // A farm costs wood: stock exactly one farm's worth, then ask for three.
            const farmCost = townPlaceCost(FARM, 0)
            for (const [resource, qty] of Object.entries(farmCost.resources) as [TownResourceId, number][]) {
                await stock(resource, qty)
            }
            await placeBuildings(OWNER, [0, 1, 2].map(tileX => ({ plotId, tileX, tileY: 0, type: 'road', rotation: 0 })))
            const before = parseFloat(await getBalance(OWNER))

            const res = await placeBuildings(OWNER, [0, 1, 2].map(tileX => ({ plotId, tileX, tileY: 1, type: 'farm', rotation: FACES_EDGE_ROAD })))

            expect(res.placed).toHaveLength(1)
            expect(res.skipped).toBe(2)
            expect(res.reason).toMatch(/Not enough/)
            expect(await own('farm')).toHaveLength(1)
            expect(parseFloat(await getBalance(OWNER))).toBeCloseTo(before - farmCost.coins, 4)
        })

        it('refuses a drag longer than the cap, and one with nothing in it', async () => {
            const plotId = await foundFor()
            const many = Array.from({ length: TOWN_MAX_DRAG_TILES + 1 }, (_, i) => ({ plotId, tileX: i % 8, tileY: Math.floor(i / 8), type: 'road', rotation: 0 }))
            await expect(placeBuildings(OWNER, many)).rejects.toThrow(/Too many/)
            await expect(placeBuildings(OWNER, [])).rejects.toThrow(/Nothing to build/)
        })
    })

    describe('moveBuildings', () => {
        it('moves nothing at all when one member of the group cannot land', async () => {
            const plotId = await foundFor()
            await stock('wood', 10_000)
            await stock('stone', 10_000)
            await stock('wheat', 10_000)
            const { placed } = await placeBuildings(OWNER, [
                { plotId, tileX: 0, tileY: 0, type: 'road', rotation: 0 },
                { plotId, tileX: 0, tileY: 1, type: 'house', rotation: FACES_EDGE_ROAD },
                { plotId, tileX: 5, tileY: 5, type: 'road', rotation: 0 }
            ])
            const road = placed.find(p => p.type === 'road' && p.tileX === 0)!
            const house = placed.find(p => p.type === 'house')!

            // The house would land on a road outside the group: nothing moves, not even the street.
            await expect(moveBuildings(OWNER, [
                { buildingId: road.buildingId, plotId, tileX: 5, tileY: 4, rotation: 0 },
                { buildingId: house.buildingId, plotId, tileX: 5, tileY: 5, rotation: FACES_EDGE_ROAD }
            ])).rejects.toThrow(/already taken/)
            expect((await own('house'))[0]).toMatchObject({ tileX: 0, tileY: 1 })
            expect((await own('road')).find(r => r.id === road.buildingId)).toMatchObject({ tileX: 0, tileY: 0 })
        })

        it('refuses a building listed twice, and one that is not there', async () => {
            const plotId = await foundFor()
            const { placed } = await placeBuildings(OWNER, [{ plotId, tileX: 0, tileY: 0, type: 'road', rotation: 0 }])
            const id = placed[0]!.buildingId
            await expect(moveBuildings(OWNER, [
                { buildingId: id, plotId, tileX: 1, tileY: 0, rotation: 0 },
                { buildingId: id, plotId, tileX: 2, tileY: 0, rotation: 0 }
            ])).rejects.toThrow(/only be moved once/)
            await expect(moveBuildings(OWNER, [{ buildingId: 'nope', plotId, tileX: 1, tileY: 0, rotation: 0 }]))
                .rejects.toThrow(/not found/i)
        })
    })

    describe('demolishBuildings', () => {
        it('leaves another mayor\'s buildings alone', async () => {
            const plotId = await foundFor()
            const { placed } = await placeBuildings(OWNER, [{ plotId, tileX: 0, tileY: 0, type: 'road', rotation: 0 }])
            await expect(demolishBuildings('somebody-else', [placed[0]!.buildingId])).rejects.toThrow()
            expect(await own('road')).toHaveLength(1)
        })
    })

    describe('upgradeBuildings', () => {
        it('starts as many upgrades as the crews allow and reports the rest', async () => {
            const plotId = await foundFor()
            await stock('wood', 1_000_000)
            await stock('stone', 1_000_000)
            await stock('wheat', 1_000_000)
            const { placed } = await placeBuildings(OWNER, [
                { plotId, tileX: 0, tileY: 0, type: 'road', rotation: 0 },
                { plotId, tileX: 1, tileY: 0, type: 'road', rotation: 0 },
                { plotId, tileX: 0, tileY: 1, type: 'house', rotation: FACES_EDGE_ROAD },
                { plotId, tileX: 1, tileY: 1, type: 'house', rotation: FACES_EDGE_ROAD }
            ])
            // The houses have to be standing before they can grow.
            await db.update(townBuildings)
                .set({ level: 1, completesAt: new Date(Date.now() - MINUTE) })
                .where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, 'house')))
            const houses = placed.filter(p => p.type === 'house').map(p => p.buildingId)
            const roads = placed.filter(p => p.type === 'road').map(p => p.buildingId)

            const res = await upgradeBuildings(OWNER, [...houses, ...roads])

            expect(res.started).toHaveLength(2)
            expect(res.skipped).toBe(2)
            expect(res.reason).toMatch(/Roads have no levels/)
            const rows = await db.select().from(townBuildings).where(inArray(townBuildings.id, houses))
            expect(rows.every(r => r.upgradingTo === 2)).toBe(true)
        })

        it('charges nothing for an upgrade it did not start', async () => {
            const plotId = await foundFor()
            const { placed } = await placeBuildings(OWNER, [{ plotId, tileX: 0, tileY: 0, type: 'road', rotation: 0 }])
            const before = await getBalance(OWNER)
            await expect(upgradeBuildings(OWNER, [placed[0]!.buildingId])).rejects.toThrow()
            expect(await getBalance(OWNER)).toBe(before)
        })
    })
})
