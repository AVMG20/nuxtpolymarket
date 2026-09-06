import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions, townState, townPlots, townBuildings, townInventory, townOrders, townProduction, townTrades } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import {
    buyPlot,
    cancelTownOrder,
    claimMilestone,
    demolishBuilding,
    foundTown,
    getExpansions,
    getProductionHistory,
    getTownMarket,
    moveBuilding,
    placeBuilding,
    placeTownOrder,
    rushBuilding,
    sellBulkToFloor,
    sellToFloor,
    settleTownForRead,
    upgradeBuilding,
    deleteTownForUser
} from '#server/utils/town'
import {
    TOWN_PLOT_SIZE,
    TOWN_TIER_POP_REQUIREMENT,
    TOWN_TIER_PRODUCTION_REQUIREMENT,
    getTownBuilding,
    getTownMilestone,
    townCeilingPrice,
    townFloorPrice,
    townLevelBuildMs,
    townLevelCost,
    townPlaceCost,
    townPlotCooldownMs,
    townPlotPrice,
    townRushGemCost,
    type TownResourceId
} from '#shared/utils/gamelogic/town'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const OWNER = 'test-town-owner'
const BUYER = 'test-town-buyer'
const SELLER = 'test-town-seller'
const USERS = [OWNER, BUYER, SELLER]

const FARM = getTownBuilding('farm')!
const MILL = getTownBuilding('mill')!
const HOUSE = getTownBuilding('house')!
const ROAD = getTownBuilding('road')!

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Rotation 2 faces −y, so a building on (x, 1) fronts the plot-edge road on (x, 0). */
const FACES_EDGE_ROAD = 2

async function getGems(id: string) {
    const row = await db.query.user.findFirst({ where: eq(user.id, id), columns: { gems: true } })
    return row!.gems
}

async function plotsOf(id: string) {
    return db.select().from(townPlots).where(eq(townPlots.userId, id))
}

async function buildingsOf(id: string) {
    return db.select().from(townBuildings).where(eq(townBuildings.userId, id))
}

async function buildingsTyped(id: string, type: string) {
    return db.select().from(townBuildings).where(and(eq(townBuildings.userId, id), eq(townBuildings.type, type)))
}

async function stateOf(id: string) {
    const row = await db.query.townState.findFirst({ where: eq(townState.userId, id) })
    return row!
}

async function productionOf(id: string) {
    return db.select().from(townProduction).where(eq(townProduction.userId, id))
}

async function stock(id: string, resource: TownResourceId, amount: number) {
    await db.insert(townInventory).values({ userId: id, resource, amount })
        .onConflictDoUpdate({ target: [townInventory.userId, townInventory.resource], set: { amount } })
}

async function held(id: string, resource: TownResourceId) {
    const row = await db.query.townInventory.findFirst({
        where: and(eq(townInventory.userId, id), eq(townInventory.resource, resource))
    })
    return row?.amount ?? 0
}

// Every coin taken off a test player, so a burst can be checked for double
// charges. Test users only ever spend through the town, so this needs no
// category filter — which keeps it working when the category string is retuned.
async function townDebits(id: string) {
    return db.select().from(transactions).where(and(
        eq(transactions.userId, id),
        eq(transactions.type, 'debit')
    ))
}

async function openOrders(id: string) {
    return db.select().from(townOrders).where(and(eq(townOrders.userId, id), eq(townOrders.status, 'open')))
}

/** Backdate the town clock so a settle covers a known window. */
async function rewindSettle(id: string, ms: number) {
    await db.update(townState)
        .set({ lastSettledAt: new Date(Date.now() - ms) })
        .where(eq(townState.userId, id))
}

/**
 * A square that touches one of the player's plots and belongs to nobody. The
 * world is shared with every other town in the database, so the free neighbour
 * has to be looked up rather than assumed.
 */
async function freeNeighbour(id: string) {
    const own = await plotsOf(id)
    const taken = new Set((await db.select({ x: townPlots.x, y: townPlots.y }).from(townPlots)).map(p => `${p.x},${p.y}`))
    for (const plot of own) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const square = { x: plot.x + dx, y: plot.y + dy }
            if (!taken.has(`${square.x},${square.y}`)) return square
        }
    }
    throw new Error(`no free square next to ${id}'s town`)
}

/** Backdate the land office clock so the next plot is on sale. */
async function rewindPlotClock(id: string, ms: number) {
    await db.update(townState)
        .set({ lastPlotBoughtAt: new Date(Date.now() - ms) })
        .where(eq(townState.userId, id))
}

/**
 * Drop a finished building straight into the world, skipping the build queue
 * (and the road rule with it) — for the tests where placement is not what is
 * under test.
 */
async function seedBuilding(
    userId: string,
    plotId: string,
    type: string,
    tileX: number,
    level = 1,
    over: { tileY?: number, rotation?: number, completesAt?: Date } = {}
) {
    const [row] = await db.insert(townBuildings).values({
        userId,
        plotId,
        type,
        tileX,
        tileY: over.tileY ?? 0,
        rotation: over.rotation ?? 0,
        level,
        completesAt: over.completesAt ?? new Date(Date.now() - 10 * MINUTE),
        createdAt: new Date(Date.now() - 10 * MINUTE)
    }).returning()
    return row!
}

/** A road on the plot edge at (tileX, 0) — the front door for anything on (tileX, 1). */
async function seedRoad(userId: string, plotId: string, tileX: number) {
    return seedBuilding(userId, plotId, 'road', tileX, 1, { tileY: 0 })
}

/**
 * Seed a whole street: a road under each building on row `roadY`, and the
 * building itself on the row above facing it. A building with no road at its
 * front door is cut off — it houses nobody and produces nothing — so anything
 * seeded for its residents or its output has to be connected.
 */
async function seedStreet(
    userId: string,
    plotId: string,
    roadY: number,
    specs: { type: string, tileX: number, level?: number, completesAt?: Date }[]
) {
    const rows = []
    for (const spec of specs) {
        await seedBuilding(userId, plotId, 'road', spec.tileX, 1, { tileY: roadY })
        rows.push(await seedBuilding(userId, plotId, spec.type, spec.tileX, spec.level ?? 1, {
            tileY: roadY + 1,
            rotation: FACES_EDGE_ROAD,
            completesAt: spec.completesAt
        }))
    }
    return rows
}

/** Rewrite the lifetime production ledger the tier gate reads. */
async function seedProduced(userId: string, produced: Record<string, number>) {
    await db.update(townState).set({ produced }).where(eq(townState.userId, userId))
}

/**
 * Everything tier 2 asks for: a finished tier-1 building, the residents to
 * staff it, and the lifetime output that no amount of coins can buy.
 */
async function unlockTier2(userId: string, plotId: string) {
    const houses = TOWN_TIER_POP_REQUIREMENT[2]! / HOUSE.popCap
    await seedStreet(userId, plotId, 5, [
        { type: 'farm', tileX: 7 },
        ...Array.from({ length: houses }, (_, i) => ({ type: 'house', tileX: i }))
    ])
    const gate = TOWN_TIER_PRODUCTION_REQUIREMENT[2]!
    await seedProduced(userId, { wheat: gate.amount })
}

// These specs share the order book with whatever else uses the database (a
// running dev server included). Cancel every open order — refunding its owner's
// escrow properly — so a stray real offer can never cross a test one.
async function clearBook() {
    const open = await db.select().from(townOrders).where(eq(townOrders.status, 'open'))
    for (const order of open) {
        await cancelTownOrder(order.userId, order.id).catch(() => {})
    }
}

// Trades reference users with SET NULL, so they must go before the users do.
async function cleanup() {
    await clearBook()
    await db.delete(townTrades).where(or(inArray(townTrades.buyerId, USERS), inArray(townTrades.sellerId, USERS)))
    await db.delete(townOrders).where(inArray(townOrders.userId, USERS))
    // deleteTownForUser clears these too; doing it here as well keeps the table
    // clean for the users whose town was already deleted by a spec.
    await db.delete(townProduction).where(inArray(townProduction.userId, USERS))
    for (const id of USERS) {
        await deleteTownForUser(id)
        await cleanupUser(id)
    }
}

/** Seed a player, found their town, and hand back their only plot. */
async function foundFor(id: string, opts: { balance?: string, gems?: number } = {}) {
    await seedUser(id, opts)
    const { plotId } = await foundTown(id)
    return plotId
}

describe.skipIf(SKIP)('polytown (database)', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('foundTown', () => {
        it('creates the town state and hands over the free founding plot', async () => {
            await seedUser(OWNER)
            const { stateId, plotId } = await foundTown(OWNER)

            expect(stateId).toBeTruthy()
            const state = await stateOf(OWNER)
            expect(state.plotsBought).toBe(1)
            expect(state.happiness).toBe(50)
            expect(state.produced).toEqual({})

            const plots = await plotsOf(OWNER)
            expect(plots).toHaveLength(1)
            expect(plots[0]!.id).toBe(plotId)
        })

        it('refuses a second town and leaves the first one alone', async () => {
            await seedUser(OWNER)
            await foundTown(OWNER)

            await expect(foundTown(OWNER)).rejects.toThrow(/already have a town/)
            expect(await plotsOf(OWNER)).toHaveLength(1)
        })
    })

    describe('placeBuilding', () => {
        it('charges the coins and queues the build', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await placeBuilding(OWNER, plotId, 2, 0, 'road')

            const happiness = (await stateOf(OWNER)).happiness
            const before = Date.now()
            const result = await placeBuilding(OWNER, plotId, 2, 1, 'farm', FACES_EDGE_ROAD)

            expect(result.cost.coins).toBe(townPlaceCost(FARM, 0).coins)
            const spent = townPlaceCost(ROAD, 0).coins + townPlaceCost(FARM, 0).coins
            expect(await getBalance(OWNER)).toBe((100000 - spent).toFixed(4))

            const [farm] = await buildingsTyped(OWNER, 'farm')
            expect(farm!.level).toBe(0)
            expect(farm!.upgradingTo).toBeNull()
            expect(farm!.tileX).toBe(2)
            expect(farm!.tileY).toBe(1)
            expect(farm!.rotation).toBe(FACES_EDGE_ROAD)

            const expected = before + townLevelBuildMs(FARM, 1, happiness)
            expect(Math.abs(farm!.completesAt.getTime() - expected)).toBeLessThan(5_000)
        })

        it('lays a road instantly, already finished at level one', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })

            const result = await placeBuilding(OWNER, plotId, 3, 0, 'road')

            const [road] = await buildingsTyped(OWNER, 'road')
            expect(road!.level).toBe(1)
            expect(road!.upgradingTo).toBeNull()
            expect(road!.completesAt.getTime()).toBeLessThanOrEqual(Date.now())
            expect(result.cost.coins).toBe(townPlaceCost(ROAD, 0).coins)
        })

        it('rejects a tile that is off the plot, or a plot owned by someone else', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const otherPlot = await foundFor(BUYER, { balance: '100000.0000' })

            await expect(placeBuilding(OWNER, plotId, 8, 0, 'farm')).rejects.toThrow(/off the plot/)
            await expect(placeBuilding(OWNER, plotId, 0, -1, 'farm')).rejects.toThrow(/off the plot/)
            await expect(placeBuilding(OWNER, plotId, 0, 0, 'castle')).rejects.toThrow(/Unknown building/)
            await expect(placeBuilding(OWNER, otherPlot, 0, 0, 'farm')).rejects.toThrow(/not yours/)

            expect(await buildingsOf(OWNER)).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('100000.0000')
        })

        it('needs a road at the front door, and the rotation decides which tile that is', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })

            // Nothing but bare land yet.
            await expect(placeBuilding(OWNER, plotId, 3, 3, 'farm')).rejects.toThrow(/front door/)
            // A road has to start at the edge of the land, or continue one.
            await expect(placeBuilding(OWNER, plotId, 3, 3, 'road')).rejects.toThrow(/edge of your land/)

            await placeBuilding(OWNER, plotId, 3, 0, 'road')
            // One tile in from the edge is fine now that a road reaches it.
            await placeBuilding(OWNER, plotId, 3, 1, 'road')

            // Facing +y, away from the road on (4, 0): no front door.
            await expect(placeBuilding(OWNER, plotId, 4, 0, 'farm', 0)).rejects.toThrow(/front door/)
            // Facing −x, onto the road on (3, 0): fine.
            await placeBuilding(OWNER, plotId, 4, 0, 'farm', 3)

            expect(await buildingsTyped(OWNER, 'farm')).toHaveLength(1)
            expect(await buildingsTyped(OWNER, 'road')).toHaveLength(2)
        })

        it('builds nothing when the coins are short', async () => {
            const plotId = await foundFor(OWNER, { balance: '100.0000' })
            await seedRoad(OWNER, plotId, 0)

            await expect(placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)).rejects.toThrow()

            expect(await buildingsTyped(OWNER, 'farm')).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('100.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
        })

        it('refuses to stack two buildings on the same tile', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedRoad(OWNER, plotId, 1)

            await placeBuilding(OWNER, plotId, 1, 1, 'farm', FACES_EDGE_ROAD)
            await expect(placeBuilding(OWNER, plotId, 1, 1, 'house', FACES_EDGE_ROAD)).rejects.toThrow(/already taken/)

            expect(await buildingsTyped(OWNER, 'farm')).toHaveLength(1)
            expect(await buildingsTyped(OWNER, 'house')).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe((100000 - townPlaceCost(FARM, 0).coins).toFixed(4))
        })

        it('charges the repeat price for every further copy', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedRoad(OWNER, plotId, 0)
            await seedRoad(OWNER, plotId, 1)

            const first = await placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)
            const second = await placeBuilding(OWNER, plotId, 1, 1, 'farm', FACES_EDGE_ROAD)

            expect(first.cost.coins).toBe(townPlaceCost(FARM, 0).coins)
            expect(second.cost.coins).toBe(townPlaceCost(FARM, 1).coins)
            expect(second.cost.coins).toBeGreaterThan(first.cost.coins)
            expect(await getBalance(OWNER)).toBe((1000000 - first.cost.coins - second.cost.coins).toFixed(4))
        })

        it('counts unfinished copies toward the repeat price too', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedRoad(OWNER, plotId, 2)
            await seedRoad(OWNER, plotId, 3)
            // Seeded straight in, still under construction.
            await seedBuilding(OWNER, plotId, 'farm', 5, 0, { tileY: 5, completesAt: new Date(Date.now() + HOUR) })

            const next = await placeBuilding(OWNER, plotId, 2, 1, 'farm', FACES_EDGE_ROAD)
            expect(next.cost.coins).toBe(townPlaceCost(FARM, 1).coins)
        })

        it('lets only one of ten concurrent placements on one tile through', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedRoad(OWNER, plotId, 4)

            const result = await burst(10, () => placeBuilding(OWNER, plotId, 4, 1, 'farm', FACES_EDGE_ROAD))

            expect(result.ok).toBe(1)
            expect(await buildingsTyped(OWNER, 'farm')).toHaveLength(1)
            expect(await townDebits(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe((1000000 - townPlaceCost(FARM, 0).coins).toFixed(4))
        })

        it('spends the resources a tier-2 building needs', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await unlockTier2(OWNER, plotId)
            await seedRoad(OWNER, plotId, 0)
            const cost = townPlaceCost(MILL, 0)
            await stock(OWNER, 'wood', cost.resources.wood! + 5)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD)

            expect(await held(OWNER, 'wood')).toBe(5)
            expect(await held(OWNER, 'stone')).toBe(0)
            expect(await getBalance(OWNER)).toBe((1000000 - cost.coins).toFixed(4))
        })

        it('refuses a tier-2 building until a tier-1 one has finished', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedRoad(OWNER, plotId, 0)
            const houses = TOWN_TIER_POP_REQUIREMENT[2]! / HOUSE.popCap
            await seedStreet(OWNER, plotId, 5, Array.from({ length: houses }, (_, i) => ({ type: 'house', tileX: i })))
            await seedProduced(OWNER, { wheat: TOWN_TIER_PRODUCTION_REQUIREMENT[2]!.amount })
            const cost = townPlaceCost(MILL, 0)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await expect(placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD)).rejects.toThrow(/tier 1/)

            // A farm still under construction does not unlock the tier either.
            await seedStreet(OWNER, plotId, 5, [{ type: 'farm', tileX: 7, level: 0, completesAt: new Date(Date.now() + 10 * MINUTE) }])
            await expect(placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD)).rejects.toThrow(/tier 1/)

            expect(await buildingsTyped(OWNER, 'mill')).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('1000000.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wood')).toBe(cost.resources.wood!)
            expect(await held(OWNER, 'stone')).toBe(cost.resources.stone!)
        })

        it('refuses a tier-2 building until the town houses enough residents', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedRoad(OWNER, plotId, 0)
            await seedStreet(OWNER, plotId, 5, [{ type: 'farm', tileX: 7 }, { type: 'house', tileX: 1 }])
            await seedProduced(OWNER, { wheat: TOWN_TIER_PRODUCTION_REQUIREMENT[2]!.amount })
            const cost = townPlaceCost(MILL, 0)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await expect(placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD))
                .rejects.toThrow(new RegExp(`needs ${TOWN_TIER_POP_REQUIREMENT[2]!} residents`))

            expect(await buildingsTyped(OWNER, 'mill')).toHaveLength(0)
            expect(await townDebits(OWNER)).toHaveLength(0)
        })

        it('refuses a tier-2 building until the town has made enough tier-1 goods', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await unlockTier2(OWNER, plotId)
            await seedRoad(OWNER, plotId, 0)
            const gate = TOWN_TIER_PRODUCTION_REQUIREMENT[2]!
            await seedProduced(OWNER, { wheat: gate.amount - 1 })
            const cost = townPlaceCost(MILL, 0)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await expect(placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD))
                .rejects.toThrow(new RegExp(`producing ${gate.amount} tier-${gate.tier} goods`))

            // One more unit of lifetime output and the tier opens.
            await seedProduced(OWNER, { wheat: gate.amount })
            await placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD)
            expect(await buildingsTyped(OWNER, 'mill')).toHaveLength(1)
        })

        it('rolls the coin charge back when the resources fall short', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await unlockTier2(OWNER, plotId)
            await seedRoad(OWNER, plotId, 0)
            const cost = townPlaceCost(MILL, 0)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', 1)

            await expect(placeBuilding(OWNER, plotId, 0, 1, 'mill', FACES_EDGE_ROAD)).rejects.toThrow(/Not enough Stone/)

            expect(await getBalance(OWNER)).toBe('1000000.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wood')).toBe(cost.resources.wood!)
            expect(await held(OWNER, 'stone')).toBe(1)
            expect(await buildingsTyped(OWNER, 'mill')).toHaveLength(0)
        })
    })

    describe('moveBuilding', () => {
        it('moves a finished building onto another road', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedRoad(OWNER, plotId, 0)
            await seedRoad(OWNER, plotId, 5)
            const farm = await seedBuilding(OWNER, plotId, 'farm', 0, 1, { tileY: 1, rotation: FACES_EDGE_ROAD })

            const result = await moveBuilding(OWNER, farm.id, plotId, 5, 1, FACES_EDGE_ROAD)

            expect(result).toMatchObject({ buildingId: farm.id, tileX: 5, tileY: 1, rotation: FACES_EDGE_ROAD })
            const [row] = await buildingsTyped(OWNER, 'farm')
            expect(row!.tileX).toBe(5)
            expect(row!.tileY).toBe(1)
            // Moving is free.
            expect(await getBalance(OWNER)).toBe('100000.0000')
        })

        it('will not drop a building where there is no road to face', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedRoad(OWNER, plotId, 0)
            const farm = await seedBuilding(OWNER, plotId, 'farm', 0, 1, { tileY: 1, rotation: FACES_EDGE_ROAD })

            await expect(moveBuilding(OWNER, farm.id, plotId, 4, 4, 0)).rejects.toThrow(/front door/)
            // Still where it was.
            expect((await buildingsTyped(OWNER, 'farm'))[0]!.tileX).toBe(0)
        })

        it('refuses to move a building that is still going up', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedRoad(OWNER, plotId, 0)
            await seedRoad(OWNER, plotId, 5)
            const site = await seedBuilding(OWNER, plotId, 'farm', 0, 0, {
                tileY: 1,
                rotation: FACES_EDGE_ROAD,
                completesAt: new Date(Date.now() + HOUR)
            })

            await expect(moveBuilding(OWNER, site.id, plotId, 5, 1, FACES_EDGE_ROAD)).rejects.toThrow(/Finish building it first/)
            await expect(moveBuilding(OWNER, 'no-such-building', plotId, 5, 1, FACES_EDGE_ROAD)).rejects.toThrow(/not found/i)
            expect((await buildingsTyped(OWNER, 'farm'))[0]!.tileX).toBe(0)
        })

        it('lets a road move away and simply cuts off whatever fronted it', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const [road] = await seedStreet(OWNER, plotId, 0, [])
            const roads = await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }, { type: 'farm', tileX: 1, level: 2 }])
            expect(road).toBeUndefined()
            expect(roads).toHaveLength(2)

            // Connected, the town produces.
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)
            expect((await settleTownForRead(OWNER)).delta.wheat).toBe(5)

            // Move the house's road off to an unrelated tile: allowed, but the
            // house it served no longer houses anybody, so the farm has no staff.
            const houseRoad = (await buildingsTyped(OWNER, 'road')).find(b => b.tileX === 0)!
            await moveBuilding(OWNER, houseRoad.id, plotId, 6, 0, 0)

            await rewindSettle(OWNER, 5 * MINUTE + 30_000)
            const cut = await settleTownForRead(OWNER)
            expect(cut.delta).toEqual({})
        })

        it('refuses an occupied target tile', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedRoad(OWNER, plotId, 0)
            await seedRoad(OWNER, plotId, 5)
            const farm = await seedBuilding(OWNER, plotId, 'farm', 0, 1, { tileY: 1, rotation: FACES_EDGE_ROAD })
            await seedBuilding(OWNER, plotId, 'house', 5, 1, { tileY: 1, rotation: FACES_EDGE_ROAD })

            await expect(moveBuilding(OWNER, farm.id, plotId, 5, 1, FACES_EDGE_ROAD)).rejects.toThrow(/already taken/)
            expect((await buildingsTyped(OWNER, 'farm'))[0]!.tileX).toBe(0)
        })

        it('rejects a rotation or a tile that is not on the board', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const farm = await seedBuilding(OWNER, plotId, 'farm', 0, 1, { tileY: 1 })

            await expect(moveBuilding(OWNER, farm.id, plotId, 1, 1, 4)).rejects.toThrow(/quarter turns/)
            await expect(moveBuilding(OWNER, farm.id, plotId, TOWN_PLOT_SIZE, 1, 0)).rejects.toThrow(/off the plot/)
        })
    })

    describe('demolishBuilding', () => {
        it('tears down a road and leaves what fronted it standing but idle', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }, { type: 'farm', tileX: 1, level: 2 }])

            await rewindSettle(OWNER, 5 * MINUTE + 30_000)
            expect((await settleTownForRead(OWNER)).delta.wheat).toBe(5)

            const houseRoad = (await buildingsTyped(OWNER, 'road')).find(b => b.tileX === 0)!
            const result = await demolishBuilding(OWNER, houseRoad.id)

            expect(result).toMatchObject({ buildingId: houseRoad.id, type: 'road' })
            // The house is still there — it just houses nobody now, so the farm idles.
            expect(await buildingsTyped(OWNER, 'house')).toHaveLength(1)
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)
            expect((await settleTownForRead(OWNER)).delta).toEqual({})
        })

        it('refuses a building that belongs to someone else', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await foundFor(BUYER, { balance: '100000.0000' })
            const road = await seedRoad(OWNER, plotId, 0)

            await expect(demolishBuilding(BUYER, road.id)).rejects.toThrow(/not found/i)
            await expect(demolishBuilding(OWNER, 'no-such-building')).rejects.toThrow(/not found/i)
            expect(await buildingsOf(OWNER)).toHaveLength(1)
        })
    })

    describe('rushBuilding', () => {
        it('charges a gem per started five minutes and finishes the build', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000', gems: 5 })
            await seedRoad(OWNER, plotId, 0)
            const happiness = (await stateOf(OWNER)).happiness
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)

            const result = await rushBuilding(OWNER, buildingId)

            expect(result.gems).toBe(townRushGemCost(townLevelBuildMs(FARM, 1, happiness)))
            expect(await getGems(OWNER)).toBe(5 - result.gems)

            const [farm] = await buildingsTyped(OWNER, 'farm')
            expect(farm!.level).toBe(1)
            expect(farm!.upgradingTo).toBeNull()
            expect(farm!.completesAt.getTime()).toBeLessThanOrEqual(Date.now())
        })

        it('has nothing to rush on a finished building', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000', gems: 5 })
            await seedRoad(OWNER, plotId, 0)
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)
            await rushBuilding(OWNER, buildingId)

            await expect(rushBuilding(OWNER, buildingId)).rejects.toThrow(/Nothing to rush/)
        })

        it('rushes nothing without the gems to pay for it', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000', gems: 0 })
            await seedRoad(OWNER, plotId, 0)
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)

            await expect(rushBuilding(OWNER, buildingId)).rejects.toThrow()
            const [farm] = await buildingsTyped(OWNER, 'farm')
            expect(farm!.level).toBe(0)
        })
    })

    describe('upgradeBuilding', () => {
        it('charges the next level and marks the building as upgrading', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            const building = await seedBuilding(OWNER, plotId, 'farm', 0)
            const cost = townLevelCost(FARM, 2)
            for (const [id, qty] of Object.entries(cost.resources)) await stock(OWNER, id as TownResourceId, qty)

            const result = await upgradeBuilding(OWNER, building.id)

            expect(result.level).toBe(2)
            expect(result.cost.coins).toBe(cost.coins)
            expect(await getBalance(OWNER)).toBe((1000000 - cost.coins).toFixed(4))
            for (const id of Object.keys(cost.resources)) expect(await held(OWNER, id as TownResourceId)).toBe(0)

            const [row] = await buildingsTyped(OWNER, 'farm')
            expect(row!.level).toBe(1)
            expect(row!.upgradingTo).toBe(2)
        })

        it('refuses to upgrade a road, or a building that is still going up', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            const road = await seedRoad(OWNER, plotId, 0)
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 1, 'farm', FACES_EDGE_ROAD)

            await expect(upgradeBuilding(OWNER, buildingId)).rejects.toThrow(/under construction/)
            await expect(upgradeBuilding(OWNER, road.id)).rejects.toThrow(/no levels/)
            await expect(upgradeBuilding(OWNER, 'no-such-building')).rejects.toThrow(/not found/i)
        })

        it('lets only one of five concurrent upgrades charge the player', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000000.0000' })
            const building = await seedBuilding(OWNER, plotId, 'farm', 0)
            const cost = townLevelCost(FARM, 2)
            // Five upgrades' worth of timber, so the CAS is the only guard left.
            for (const [id, qty] of Object.entries(cost.resources)) await stock(OWNER, id as TownResourceId, qty * 5)

            const result = await burst(5, () => upgradeBuilding(OWNER, building.id))

            expect(result.ok).toBe(1)
            expect(await townDebits(OWNER)).toHaveLength(1)
            const [row] = await buildingsTyped(OWNER, 'farm')
            expect(row!.upgradingTo).toBe(2)
            expect(await getBalance(OWNER)).toBe((10000000 - cost.coins).toFixed(4))
            for (const [id, qty] of Object.entries(cost.resources)) {
                expect(await held(OWNER, id as TownResourceId)).toBe(qty * 4)
            }
        })
    })

    describe('buyPlot', () => {
        it('makes a fresh town wait out the land office cooldown', async () => {
            await foundFor(OWNER, { balance: '10000000.0000' })
            const square = await freeNeighbour(OWNER)

            await expect(buyPlot(OWNER, square.x, square.y)).rejects.toThrow(/not selling to you yet/)
            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe('10000000.0000')
        })

        it('sells the second plot once the cooldown has passed', async () => {
            await foundFor(OWNER, { balance: '10000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const square = await freeNeighbour(OWNER)

            const result = await buyPlot(OWNER, square.x, square.y)
            const price = townPlotPrice(2)

            expect(result).toMatchObject({ price, x: square.x, y: square.y })
            expect(await getBalance(OWNER)).toBe((10000000 - price).toFixed(4))
            expect((await stateOf(OWNER)).plotsBought).toBe(2)

            const plots = await plotsOf(OWNER)
            expect(plots).toHaveLength(2)
            expect(new Set(plots.map(p => `${p.x},${p.y}`)).size).toBe(2)
        })

        it('only sells land that touches a plot the player already owns', async () => {
            await foundFor(OWNER, { balance: '10000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const [plot] = await plotsOf(OWNER)

            // Far away, and diagonal — neither shares an edge with the town.
            await expect(buyPlot(OWNER, plot!.x + 5, plot!.y)).rejects.toThrow(/must touch a plot you own/)
            await expect(buyPlot(OWNER, plot!.x + 1, plot!.y + 1)).rejects.toThrow(/must touch a plot you own/)
            await expect(buyPlot(OWNER, plot!.x + 0.5, plot!.y)).rejects.toThrow(/Pick a square/)

            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('10000000.0000')
        })

        it('sells exactly one plot to five concurrent buyers', async () => {
            await foundFor(OWNER, { balance: '10000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const square = await freeNeighbour(OWNER)

            const result = await burst(5, () => buyPlot(OWNER, square.x, square.y))

            expect(result.ok).toBe(1)
            expect(await plotsOf(OWNER)).toHaveLength(2)
            expect(await townDebits(OWNER)).toHaveLength(1)
            expect((await stateOf(OWNER)).plotsBought).toBe(2)
            expect(await getBalance(OWNER)).toBe((10000000 - townPlotPrice(2)).toFixed(4))
        })
    })

    describe('getExpansions', () => {
        it('offers the four squares around a one-plot town', async () => {
            await foundFor(OWNER)
            const own = await plotsOf(OWNER)

            const expansions = await getExpansions(OWNER, own)

            expect(expansions).toHaveLength(4)
            for (const square of expansions) {
                expect(Math.abs(square.x - own[0]!.x) + Math.abs(square.y - own[0]!.y)).toBe(1)
                // The world is shared, so a neighbour may already belong to someone.
                if (!square.free) expect(square.ownerName).toBeTruthy()
            }
        })

        it('never offers a square the player already owns', async () => {
            await foundFor(OWNER, { balance: '10000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const square = await freeNeighbour(OWNER)
            await buyPlot(OWNER, square.x, square.y)

            const own = await plotsOf(OWNER)
            const expansions = await getExpansions(OWNER, own)
            const owned = new Set(own.map(p => `${p.x},${p.y}`))

            expect(expansions.some(e => owned.has(`${e.x},${e.y}`))).toBe(false)
            expect(expansions).toHaveLength(6)
        })
    })

    describe('settleTownForRead', () => {
        // A house (4 residents, 1 grain a tick) and a level-2 farm (2 grain a
        // tick): five and a half minutes at 50 happiness is five whole ticks of
        // one surplus wheat each.
        async function surplusTown(balance = '100000.0000') {
            const plotId = await foundFor(OWNER, { balance })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }, { type: 'farm', tileX: 1, level: 2 }])
            return plotId
        }

        it('advances production and carries the leftover tick progress', async () => {
            await surplusTown()
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)

            const settled = await settleTownForRead(OWNER)

            expect(settled.inventory.wheat).toBe(5)
            expect(await held(OWNER, 'wheat')).toBe(5)
            expect(settled.satisfied).toEqual({ wheat: true })
            expect(settled.state.tickProgressMs).toBeGreaterThan(0)
            expect(settled.state.lastSettledAt.getTime()).toBeGreaterThan(Date.now() - 10_000)

            // Settling again straight away must not mint anything extra.
            const again = await settleTownForRead(OWNER)
            expect(again.inventory.wheat).toBe(settled.inventory.wheat)
        })

        it('bakes a finished build into the building row', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }])
            await seedRoad(OWNER, plotId, 1)
            const { buildingId } = await placeBuilding(OWNER, plotId, 1, 1, 'farm', FACES_EDGE_ROAD)
            await db.update(townBuildings)
                .set({ completesAt: new Date(Date.now() - MINUTE) })
                .where(eq(townBuildings.id, buildingId))
            await rewindSettle(OWNER, 5 * MINUTE)

            const settled = await settleTownForRead(OWNER)

            expect(settled.completed).toEqual([{ id: buildingId, level: 1 }])
            expect(settled.buildings.find(b => b.id === buildingId)!.level).toBe(1)
        })

        it('reports what the window produced and how long it covered', async () => {
            await surplusTown()
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)

            const settled = await settleTownForRead(OWNER)

            expect(settled.delta.wheat).toBe(settled.inventory.wheat)
            expect(settled.delta.wheat).toBe(5)
            expect(settled.elapsedMs).toBeGreaterThanOrEqual(5 * MINUTE + 30_000)
            expect(settled.elapsedMs).toBeLessThan(6 * MINUTE + 30_000)

            // Settling again immediately covers no time and produces nothing.
            const again = await settleTownForRead(OWNER)
            expect(again.delta).toEqual({})
            expect(again.elapsedMs).toBeLessThan(5_000)
        })

        it('hands back the plots and the buildings in world coordinates', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const house = await seedBuilding(OWNER, plotId, 'house', 3, 1, { tileY: 2, rotation: 1 })

            const settled = await settleTownForRead(OWNER)

            expect(settled.plots).toHaveLength(1)
            const plot = settled.plots.find(p => p.id === plotId)!
            const placed = settled.sim.find(b => b.id === house.id)!
            expect(placed.wx).toBe(plot.x * TOWN_PLOT_SIZE + 3)
            expect(placed.wy).toBe(plot.y * TOWN_PLOT_SIZE + 2)
            expect(placed.rotation).toBe(1)
        })

        it('logs every positive delta to the production table and the lifetime ledger', async () => {
            await surplusTown()
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)

            const settled = await settleTownForRead(OWNER)

            const rows = await productionOf(OWNER)
            expect(rows).toHaveLength(1)
            expect(rows[0]!.resource).toBe('wheat')
            expect(rows[0]!.amount).toBe(settled.delta.wheat)
            expect(rows[0]!.toAt.getTime()).toBeGreaterThan(rows[0]!.fromAt.getTime())
            expect((await stateOf(OWNER)).produced).toEqual({ wheat: settled.delta.wheat })

            // A second settle over no time logs nothing new.
            await settleTownForRead(OWNER)
            expect(await productionOf(OWNER)).toHaveLength(1)
        })

        it('logs nothing for a window that only consumed', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }])
            await stock(OWNER, 'wheat', 20)
            await rewindSettle(OWNER, 5 * MINUTE)

            const settled = await settleTownForRead(OWNER)

            expect(settled.delta.wheat).toBeLessThan(0)
            expect(await productionOf(OWNER)).toHaveLength(0)
            expect((await stateOf(OWNER)).produced).toEqual({})
        })

        it('refuses to settle a player who never founded a town', async () => {
            await seedUser(OWNER)
            await expect(settleTownForRead(OWNER)).rejects.toThrow(/Found a town first/)
        })
    })

    describe('getProductionHistory', () => {
        it('drops each logged window into the hour bucket it covered', async () => {
            await foundFor(OWNER)
            const hour = 3_600_000
            const currentBucket = Math.floor(Date.now() / hour) * hour
            const threeAgo = currentBucket - 3 * hour
            const fiveAgo = currentBucket - 5 * hour

            await db.insert(townProduction).values([
                // Wholly inside one bucket.
                { userId: OWNER, resource: 'wheat', amount: 30, fromAt: new Date(threeAgo + 10 * MINUTE), toAt: new Date(threeAgo + 20 * MINUTE) },
                // Straddles two, so it is spread evenly across them.
                { userId: OWNER, resource: 'wood', amount: 40, fromAt: new Date(fiveAgo + 50 * MINUTE), toAt: new Date(fiveAgo + 70 * MINUTE) },
                // Older than the window asked for.
                { userId: OWNER, resource: 'stone', amount: 99, fromAt: new Date(currentBucket - 40 * hour), toAt: new Date(currentBucket - 39 * hour) }
            ])

            const history = await getProductionHistory(OWNER, 24)
            const bucketAt = (at: number) => history.buckets.find(b => b.at === at)!

            expect(history.bucketMs).toBe(hour)
            expect(history.buckets).toHaveLength(25)
            expect(bucketAt(threeAgo).totals.wheat).toBe(30)
            expect(bucketAt(fiveAgo).totals.wood).toBe(20)
            expect(bucketAt(fiveAgo + hour).totals.wood).toBe(20)
            expect(history.buckets.every(b => b.totals.stone === undefined)).toBe(true)
            expect(bucketAt(currentBucket).totals).toEqual({})
        })

        it('clamps the window it will look back over', async () => {
            await foundFor(OWNER)
            expect((await getProductionHistory(OWNER, 0)).buckets).toHaveLength(2)
            expect((await getProductionHistory(OWNER, 1_000)).buckets).toHaveLength(169)
        })

        it('shows what a real settle produced', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }, { type: 'farm', tileX: 1, level: 2 }])
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)

            const settled = await settleTownForRead(OWNER)
            const history = await getProductionHistory(OWNER, 24)

            // The window closed a moment ago, so it lands in the newest bucket —
            // or is split with the one before it when it crossed the hour.
            const older = history.buckets.slice(0, -2)
            expect(older.every(b => (b.totals.wheat ?? 0) === 0)).toBe(true)
            const tail = history.buckets.slice(-2).reduce((sum, b) => sum + (b.totals.wheat ?? 0), 0)
            expect(tail).toBeGreaterThanOrEqual(settled.delta.wheat!)
            // A split window rounds each half up, so the tail may read one high.
            expect(tail).toBeLessThanOrEqual(settled.delta.wheat! + 1)
        })
    })

    describe('sellToFloor', () => {
        it('pays the floor price and takes the goods', async () => {
            await seedUser(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)

            const result = await sellToFloor(OWNER, 'wheat', 4)

            expect(result.price).toBe(townFloorPrice('wheat'))
            expect(result.total).toBe(townFloorPrice('wheat') * 4)
            expect(await getBalance(OWNER)).toBe(result.total.toFixed(4))
            expect(await held(OWNER, 'wheat')).toBe(6)
        })

        it('will not buy goods the player does not have', async () => {
            await seedUser(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 3)

            await expect(sellToFloor(OWNER, 'wheat', 4)).rejects.toThrow(/Not enough Wheat/)
            await expect(sellToFloor(OWNER, 'gold', 1)).rejects.toThrow(/Unknown resource/)
            await expect(sellToFloor(OWNER, 'wheat', 0)).rejects.toThrow(/whole number/)

            expect(await held(OWNER, 'wheat')).toBe(3)
            expect(await getBalance(OWNER)).toBe('0.0000')
        })

        it('sells the same stack only once under a concurrent burst', async () => {
            await seedUser(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)

            const result = await burst(10, () => sellToFloor(OWNER, 'wheat', 10))

            expect(result.ok).toBe(1)
            expect(await held(OWNER, 'wheat')).toBe(0)
            expect(await getBalance(OWNER)).toBe((townFloorPrice('wheat') * 10).toFixed(4))
        })

        it('adds the sale total to the lifetime earnings counter', async () => {
            await foundFor(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)
            expect(parseFloat((await stateOf(OWNER)).coinsEarned)).toBe(0)

            await sellToFloor(OWNER, 'wheat', 4)
            expect((await stateOf(OWNER)).coinsEarned).toBe((townFloorPrice('wheat') * 4).toFixed(4))

            await sellToFloor(OWNER, 'wheat', 6)
            expect((await stateOf(OWNER)).coinsEarned).toBe((townFloorPrice('wheat') * 10).toFixed(4))
        })
    })

    describe('sellBulkToFloor', () => {
        it('credits the whole basket and empties each line', async () => {
            await foundFor(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)
            await stock(OWNER, 'wood', 5)
            await stock(OWNER, 'stone', 3)

            const result = await sellBulkToFloor(OWNER, [
                { resource: 'wheat', quantity: 4 },
                { resource: 'wood', quantity: 5 },
                { resource: 'stone', quantity: 3 }
            ])

            const expected = townFloorPrice('wheat') * 4 + townFloorPrice('wood') * 5 + townFloorPrice('stone') * 3
            expect(result.total).toBe(expected)
            expect(result.lines).toHaveLength(3)
            expect(await getBalance(OWNER)).toBe(expected.toFixed(4))
            expect(await held(OWNER, 'wheat')).toBe(6)
            expect(await held(OWNER, 'wood')).toBe(0)
            expect(await held(OWNER, 'stone')).toBe(0)
            expect((await stateOf(OWNER)).coinsEarned).toBe(expected.toFixed(4))
        })

        it('rolls the whole basket back when one line is short', async () => {
            await foundFor(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)
            await stock(OWNER, 'wood', 1)

            await expect(sellBulkToFloor(OWNER, [
                { resource: 'wheat', quantity: 10 },
                { resource: 'wood', quantity: 5 }
            ])).rejects.toThrow(/Not enough Wood/)

            // The wheat line ran first and still has to be undone.
            expect(await held(OWNER, 'wheat')).toBe(10)
            expect(await held(OWNER, 'wood')).toBe(1)
            expect(await getBalance(OWNER)).toBe('0.0000')
            expect(parseFloat((await stateOf(OWNER)).coinsEarned)).toBe(0)
        })

        it('validates the basket before it touches anything', async () => {
            await seedUser(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)

            await expect(sellBulkToFloor(OWNER, [])).rejects.toThrow(/Nothing to sell/)
            await expect(sellBulkToFloor(OWNER, [{ resource: 'gold', quantity: 1 }])).rejects.toThrow(/Unknown resource/)
            await expect(sellBulkToFloor(OWNER, [{ resource: 'wheat', quantity: 0 }])).rejects.toThrow(/whole number/)

            expect(await held(OWNER, 'wheat')).toBe(10)
            expect(await getBalance(OWNER)).toBe('0.0000')
        })

        it('sells one basket to ten concurrent callers', async () => {
            await seedUser(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 10)
            await stock(OWNER, 'wood', 10)

            const result = await burst(10, () => sellBulkToFloor(OWNER, [
                { resource: 'wheat', quantity: 10 },
                { resource: 'wood', quantity: 10 }
            ]))

            expect(result.ok).toBe(1)
            expect(await held(OWNER, 'wheat')).toBe(0)
            expect(await held(OWNER, 'wood')).toBe(0)
            expect(await getBalance(OWNER))
                .toBe((townFloorPrice('wheat') * 10 + townFloorPrice('wood') * 10).toFixed(4))
        })
    })

    describe('player market', () => {
        it('escrows the seller stock and fills a crossing buy at the resting price', async () => {
            await seedUser(SELLER, { balance: '0.0000' })
            await seedUser(BUYER, { balance: '100.0000' })
            await stock(SELLER, 'wheat', 10)

            const sell = await placeTownOrder(SELLER, 'wheat', 'sell', 6, 10)
            expect(sell.status).toBe('open')
            expect(await held(SELLER, 'wheat')).toBe(0)

            const buy = await placeTownOrder(BUYER, 'wheat', 'buy', 8, 10)

            expect(buy.status).toBe('filled')
            expect(buy.filled).toBe(10)
            expect(buy.avgFillPrice).toBe(6)
            // Escrowed 80, paid 60, 20 in change.
            expect(await getBalance(BUYER)).toBe('40.0000')
            expect(await getBalance(SELLER)).toBe('60.0000')
            expect(await held(BUYER, 'wheat')).toBe(10)

            const trades = await db.select().from(townTrades).where(eq(townTrades.sellerId, SELLER))
            expect(trades).toHaveLength(1)
            expect(trades[0]!.quantity).toBe(10)
            expect(parseFloat(trades[0]!.price)).toBe(6)
        })

        it('counts a fill toward the lifetime earnings of the seller only', async () => {
            await foundFor(SELLER, { balance: '0.0000' })
            await foundFor(BUYER, { balance: '100.0000' })
            await stock(SELLER, 'wheat', 10)

            // Seller rests, buyer crosses: the resting seller is the one earning.
            await placeTownOrder(SELLER, 'wheat', 'sell', 6, 10)
            await placeTownOrder(BUYER, 'wheat', 'buy', 8, 10)

            expect((await stateOf(SELLER)).coinsEarned).toBe('60.0000')
            expect(parseFloat((await stateOf(BUYER)).coinsEarned)).toBe(0)
        })

        it('counts a fill for the seller when the seller is the taker', async () => {
            await foundFor(SELLER, { balance: '0.0000' })
            await foundFor(BUYER, { balance: '100.0000' })
            await stock(SELLER, 'wheat', 6)

            await placeTownOrder(BUYER, 'wheat', 'buy', 7, 6)
            await placeTownOrder(SELLER, 'wheat', 'sell', 5, 6)

            expect((await stateOf(SELLER)).coinsEarned).toBe('42.0000')
            expect(parseFloat((await stateOf(BUYER)).coinsEarned)).toBe(0)
        })

        it('leaves the unmatched remainder resting on the book', async () => {
            await seedUser(SELLER, { balance: '0.0000' })
            await seedUser(BUYER, { balance: '100.0000' })
            await stock(SELLER, 'wheat', 10)

            await placeTownOrder(SELLER, 'wheat', 'sell', 6, 10)
            const buy = await placeTownOrder(BUYER, 'wheat', 'buy', 6, 4)

            expect(buy.status).toBe('filled')
            const [resting] = await openOrders(SELLER)
            expect(resting!.filled).toBe(4)
            expect(resting!.quantity).toBe(10)
            expect(await held(BUYER, 'wheat')).toBe(4)
        })

        it('refunds the resource on a cancelled sell and the coins on a cancelled buy', async () => {
            await seedUser(SELLER, { balance: '0.0000' })
            await seedUser(BUYER, { balance: '100.0000' })
            await stock(SELLER, 'wheat', 10)

            const sell = await placeTownOrder(SELLER, 'wheat', 'sell', 6, 10)
            const sellCancel = await cancelTownOrder(SELLER, sell.orderId)
            expect(sellCancel.refundedQuantity).toBe(10)
            expect(await held(SELLER, 'wheat')).toBe(10)

            const buy = await placeTownOrder(BUYER, 'wheat', 'buy', 10, 10)
            expect(await getBalance(BUYER)).toBe('0.0000')
            await cancelTownOrder(BUYER, buy.orderId)
            expect(await getBalance(BUYER)).toBe('100.0000')

            await expect(cancelTownOrder(BUYER, buy.orderId)).rejects.toThrow(/no longer open/)
        })

        it('refuses any price outside the system band', async () => {
            const floor = townFloorPrice('wheat')
            const ceiling = townCeilingPrice('wheat')
            await seedUser(BUYER, { balance: '100000.0000' })

            await expect(placeTownOrder(BUYER, 'wheat', 'buy', floor - 0.01, 1)).rejects.toThrow(/Price must be between/)
            await expect(placeTownOrder(BUYER, 'wheat', 'buy', ceiling + 0.01, 1)).rejects.toThrow(/Price must be between/)
            await expect(placeTownOrder(BUYER, 'wheat', 'buy', 6.005, 1)).rejects.toThrow(/2 decimals/)
            await expect(placeTownOrder(BUYER, 'wheat', 'buy', 6, 1.5)).rejects.toThrow(/whole number/)
            await expect(placeTownOrder(BUYER, 'gold', 'buy', 6, 1)).rejects.toThrow(/Unknown resource/)

            expect(await openOrders(BUYER)).toHaveLength(0)
            expect(await getBalance(BUYER)).toBe('100000.0000')

            // Both edges of the band are allowed.
            await placeTownOrder(BUYER, 'wheat', 'buy', floor, 1)
            await placeTownOrder(BUYER, 'wheat', 'buy', ceiling, 1)
            expect(await openOrders(BUYER)).toHaveLength(2)
        })

        it('places nothing when the escrow cannot be paid', async () => {
            await seedUser(BUYER, { balance: '1.0000' })
            await seedUser(SELLER, { balance: '0.0000' })
            await stock(SELLER, 'wheat', 1)

            await expect(placeTownOrder(BUYER, 'wheat', 'buy', 6, 10)).rejects.toThrow()
            await expect(placeTownOrder(SELLER, 'wheat', 'sell', 6, 10)).rejects.toThrow(/Not enough Wheat/)

            expect(await openOrders(BUYER)).toHaveLength(0)
            expect(await openOrders(SELLER)).toHaveLength(0)
            expect(await getBalance(BUYER)).toBe('1.0000')
            expect(await held(SELLER, 'wheat')).toBe(1)
        })

        it('aggregates the book by price and reports the caller their own orders', async () => {
            await seedUser(BUYER, { balance: '100000.0000' })
            await seedUser(SELLER, { balance: '0.0000' })
            await stock(SELLER, 'wheat', 10)

            await placeTownOrder(BUYER, 'wheat', 'buy', 6, 3)
            await placeTownOrder(BUYER, 'wheat', 'buy', 6, 2)
            await placeTownOrder(BUYER, 'wheat', 'buy', 5, 4)
            await placeTownOrder(SELLER, 'wheat', 'sell', 12, 6)

            const market = await getTownMarket('wheat', BUYER)

            expect(market.floor).toBe(townFloorPrice('wheat'))
            expect(market.ceiling).toBe(townCeilingPrice('wheat'))
            expect(market.bids).toEqual([{ price: 6, quantity: 5 }, { price: 5, quantity: 4 }])
            expect(market.asks).toEqual([{ price: 12, quantity: 6 }])
            expect(market.myOrders).toHaveLength(3)
            expect(market.myOrders.every(o => o.side === 'buy')).toBe(true)

            const sellerView = await getTownMarket('wheat', SELLER)
            expect(sellerView.myOrders).toHaveLength(1)
            expect(sellerView.myOrders[0]!.price).toBe(12)

            const anonymous = await getTownMarket('wheat', null)
            expect(anonymous.myOrders).toEqual([])
            expect(anonymous.bids).toEqual(market.bids)
        })

        it('records the trade history a fill produces', async () => {
            await seedUser(BUYER, { balance: '100000.0000' })
            await seedUser(SELLER, { balance: '0.0000' })
            await stock(SELLER, 'wheat', 6)

            await placeTownOrder(BUYER, 'wheat', 'buy', 7, 6)
            const sell = await placeTownOrder(SELLER, 'wheat', 'sell', 5, 6)

            // The seller crossed a resting bid, so they are paid the higher bid.
            expect(sell.status).toBe('filled')
            expect(sell.avgFillPrice).toBe(7)
            expect(await getBalance(SELLER)).toBe('42.0000')

            // The book is shared with whatever else uses this database (a dev
            // server's real trades included), so only assert on our own fill.
            const market = await getTownMarket('wheat', BUYER)
            const mine = market.trades.filter(t => t.mine)
            expect(mine).toHaveLength(1)
            expect(mine[0]).toMatchObject({ price: 7, quantity: 6, mine: true })
            expect(market.guidePrice).toBeGreaterThanOrEqual(market.floor)
            expect(market.guidePrice).toBeLessThanOrEqual(market.ceiling)
            expect(market.bids).toEqual([])
        })
    })

    describe('claimMilestone', () => {
        it('pays a completed milestone exactly once under a concurrent burst', async () => {
            const plotId = await foundFor(OWNER, { balance: '0.0000' })
            await seedBuilding(OWNER, plotId, 'house', 0)
            const reward = getTownMilestone('first-home')!.reward

            const result = await burst(10, () => claimMilestone(OWNER, 'first-home'))

            expect(result.ok).toBe(1)
            expect(await getBalance(OWNER)).toBe(reward.toFixed(4))
            expect((await stateOf(OWNER)).milestonesClaimed).toEqual(['first-home'])

            await expect(claimMilestone(OWNER, 'first-home')).rejects.toThrow(/Already claimed/)
            expect(await getBalance(OWNER)).toBe(reward.toFixed(4))
        })

        it('refuses a milestone the town has not reached', async () => {
            const plotId = await foundFor(OWNER, { balance: '0.0000' })

            await expect(claimMilestone(OWNER, 'first-home')).rejects.toThrow(/not reached yet/)
            await expect(claimMilestone(OWNER, 'merchant')).rejects.toThrow(/not reached yet/)
            await expect(claimMilestone(OWNER, 'no-such-milestone')).rejects.toThrow(/Unknown milestone/)

            // A house that is still going up does not count as built.
            await seedBuilding(OWNER, plotId, 'house', 0, 0, { completesAt: new Date(Date.now() + 10 * MINUTE) })
            await expect(claimMilestone(OWNER, 'first-home')).rejects.toThrow(/not reached yet/)

            expect(await getBalance(OWNER)).toBe('0.0000')
            expect((await stateOf(OWNER)).milestonesClaimed).toEqual([])
        })

        it('unlocks the sales milestone from the earnings a floor sale recorded', async () => {
            await foundFor(OWNER, { balance: '0.0000' })
            await stock(OWNER, 'wheat', 200)

            await expect(claimMilestone(OWNER, 'first-sale')).rejects.toThrow(/not reached yet/)

            const sale = await sellToFloor(OWNER, 'wheat', 200)
            const claim = await claimMilestone(OWNER, 'first-sale')

            expect(claim.reward).toBe(getTownMilestone('first-sale')!.reward)
            expect(await getBalance(OWNER)).toBe((sale.total + claim.reward).toFixed(4))
            expect((await stateOf(OWNER)).milestonesClaimed).toEqual(['first-sale'])
        })
    })

    describe('deleteTownForUser', () => {
        it('wipes every trace of a town', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            await seedStreet(OWNER, plotId, 3, [{ type: 'house', tileX: 0 }, { type: 'farm', tileX: 1, level: 2 }])
            await stock(OWNER, 'wheat', 5)
            await placeTownOrder(OWNER, 'wheat', 'sell', 6, 5)
            // Give the production log something to hold.
            await rewindSettle(OWNER, 5 * MINUTE + 30_000)
            await settleTownForRead(OWNER)
            expect((await productionOf(OWNER)).length).toBeGreaterThan(0)

            await deleteTownForUser(OWNER)

            expect(await plotsOf(OWNER)).toHaveLength(0)
            expect(await buildingsOf(OWNER)).toHaveLength(0)
            expect(await openOrders(OWNER)).toHaveLength(0)
            expect(await productionOf(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wheat')).toBe(0)
            expect(await db.query.townState.findFirst({ where: eq(townState.userId, OWNER) })).toBeUndefined()
        })
    })
})
