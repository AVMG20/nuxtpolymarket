import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '#server/database'
import { user, transactions, townState, townPlots, townBuildings, townInventory, townOrders, townTrades } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import {
    buyFromCeiling,
    buyPlot,
    cancelTownOrder,
    claimMilestone,
    foundTown,
    getExpansions,
    getTownMarket,
    placeBuilding,
    placeTownOrder,
    rushBuilding,
    sellToFloor,
    settleTownForRead,
    upgradeBuilding,
    deleteTownForUser
} from '#server/utils/town'
import {
    TOWN_PLOT_SIZE,
    getTownBuilding,
    getTownMilestone,
    townCeilingPrice,
    townFloorPrice,
    townLevelBuildMs,
    townLevelCost,
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

const MINUTE = 60_000

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

async function stateOf(id: string) {
    const row = await db.query.townState.findFirst({ where: eq(townState.userId, id) })
    return row!
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

/** Drop a finished building straight into the world, skipping the build queue. */
async function seedBuilding(userId: string, plotId: string, type: string, tileX: number, level = 1) {
    const [row] = await db.insert(townBuildings).values({
        userId,
        plotId,
        type,
        tileX,
        tileY: 0,
        level,
        completesAt: new Date(Date.now() - 10 * MINUTE),
        createdAt: new Date(Date.now() - 10 * MINUTE)
    }).returning()
    return row!
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
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })

            const before = Date.now()
            const result = await placeBuilding(OWNER, plotId, 2, 3, 'farm')

            expect(result.cost.coins).toBe(FARM.cost.coins)
            expect(await getBalance(OWNER)).toBe((10000 - FARM.cost.coins).toFixed(4))

            const [building] = await buildingsOf(OWNER)
            expect(building!.level).toBe(0)
            expect(building!.upgradingTo).toBeNull()
            expect(building!.tileX).toBe(2)
            expect(building!.tileY).toBe(3)

            const expected = before + townLevelBuildMs(FARM, 1)
            expect(Math.abs(building!.completesAt.getTime() - expected)).toBeLessThan(5_000)
        })

        it('rejects a tile that is off the plot, or a plot owned by someone else', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })
            const otherPlot = await foundFor(BUYER, { balance: '10000.0000' })

            await expect(placeBuilding(OWNER, plotId, 8, 0, 'farm')).rejects.toThrow(/off the plot/)
            await expect(placeBuilding(OWNER, plotId, 0, -1, 'farm')).rejects.toThrow(/off the plot/)
            await expect(placeBuilding(OWNER, plotId, 0, 0, 'castle')).rejects.toThrow(/Unknown building/)
            await expect(placeBuilding(OWNER, otherPlot, 0, 0, 'farm')).rejects.toThrow(/not yours/)

            expect(await buildingsOf(OWNER)).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('10000.0000')
        })

        it('builds nothing when the coins are short', async () => {
            const plotId = await foundFor(OWNER, { balance: '100.0000' })

            await expect(placeBuilding(OWNER, plotId, 0, 0, 'farm')).rejects.toThrow()

            expect(await buildingsOf(OWNER)).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('100.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
        })

        it('refuses to stack two buildings on the same tile', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })

            await placeBuilding(OWNER, plotId, 1, 1, 'farm')
            await expect(placeBuilding(OWNER, plotId, 1, 1, 'house')).rejects.toThrow(/already taken/)

            expect(await buildingsOf(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe((10000 - FARM.cost.coins).toFixed(4))
        })

        it('lets only one of ten concurrent placements on one tile through', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })

            const result = await burst(10, () => placeBuilding(OWNER, plotId, 4, 4, 'farm'))

            expect(result.ok).toBe(1)
            expect(await buildingsOf(OWNER)).toHaveLength(1)
            expect(await townDebits(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe((100000 - FARM.cost.coins).toFixed(4))
        })

        it('spends the resources a tier-2 building needs', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedBuilding(OWNER, plotId, 'farm', 1)
            const cost = townLevelCost(MILL, 1)
            await stock(OWNER, 'wood', cost.resources.wood! + 5)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await placeBuilding(OWNER, plotId, 0, 0, 'mill')

            expect(await held(OWNER, 'wood')).toBe(5)
            expect(await held(OWNER, 'stone')).toBe(0)
            expect(await getBalance(OWNER)).toBe((100000 - cost.coins).toFixed(4))
        })

        it('refuses a tier-2 building until a tier-1 one has finished', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const cost = townLevelCost(MILL, 1)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', cost.resources.stone!)

            await expect(placeBuilding(OWNER, plotId, 0, 0, 'mill')).rejects.toThrow(/tier 1/)

            // A farm still under construction does not unlock the tier either.
            await seedBuilding(OWNER, plotId, 'farm', 1, 0)
            await db.update(townBuildings)
                .set({ completesAt: new Date(Date.now() + 10 * MINUTE) })
                .where(and(eq(townBuildings.userId, OWNER), eq(townBuildings.type, 'farm')))

            await expect(placeBuilding(OWNER, plotId, 0, 0, 'mill')).rejects.toThrow(/tier 1/)

            expect(await buildingsOf(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe('100000.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wood')).toBe(cost.resources.wood!)
            expect(await held(OWNER, 'stone')).toBe(cost.resources.stone!)
        })

        it('rolls the coin charge back when the resources fall short', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedBuilding(OWNER, plotId, 'farm', 1)
            const cost = townLevelCost(MILL, 1)
            await stock(OWNER, 'wood', cost.resources.wood!)
            await stock(OWNER, 'stone', 1)

            await expect(placeBuilding(OWNER, plotId, 0, 0, 'mill')).rejects.toThrow(/Not enough Stone/)

            expect(await getBalance(OWNER)).toBe('100000.0000')
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wood')).toBe(cost.resources.wood!)
            expect(await held(OWNER, 'stone')).toBe(1)
            // Only the seeded farm that unlocked the tier is standing.
            expect((await buildingsOf(OWNER)).map(b => b.type)).toEqual(['farm'])
        })
    })

    describe('rushBuilding', () => {
        it('charges a gem per started five minutes and finishes the build', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000', gems: 5 })
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 0, 'farm')

            const result = await rushBuilding(OWNER, buildingId)

            expect(result.gems).toBe(townRushGemCost(townLevelBuildMs(FARM, 1)))
            expect(await getGems(OWNER)).toBe(5 - result.gems)

            const [building] = await buildingsOf(OWNER)
            expect(building!.level).toBe(1)
            expect(building!.upgradingTo).toBeNull()
            expect(building!.completesAt.getTime()).toBeLessThanOrEqual(Date.now())
        })

        it('has nothing to rush on a finished building', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000', gems: 5 })
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 0, 'farm')
            await rushBuilding(OWNER, buildingId)

            await expect(rushBuilding(OWNER, buildingId)).rejects.toThrow(/Nothing to rush/)
        })

        it('rushes nothing without the gems to pay for it', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000', gems: 0 })
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 0, 'farm')

            await expect(rushBuilding(OWNER, buildingId)).rejects.toThrow()
            const [building] = await buildingsOf(OWNER)
            expect(building!.level).toBe(0)
        })
    })

    describe('upgradeBuilding', () => {
        it('charges the next level and marks the building as upgrading', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const building = await seedBuilding(OWNER, plotId, 'farm', 0)

            const result = await upgradeBuilding(OWNER, building.id)
            const cost = townLevelCost(FARM, 2)

            expect(result.level).toBe(2)
            expect(result.cost.coins).toBe(cost.coins)
            expect(await getBalance(OWNER)).toBe((100000 - cost.coins).toFixed(4))

            const [row] = await buildingsOf(OWNER)
            expect(row!.level).toBe(1)
            expect(row!.upgradingTo).toBe(2)
        })

        it('refuses to upgrade a building that is still going up', async () => {
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            const { buildingId } = await placeBuilding(OWNER, plotId, 0, 0, 'farm')

            await expect(upgradeBuilding(OWNER, buildingId)).rejects.toThrow(/under construction/)
            await expect(upgradeBuilding(OWNER, 'no-such-building')).rejects.toThrow(/not found/i)
        })

        it('lets only one of five concurrent upgrades charge the player', async () => {
            const plotId = await foundFor(OWNER, { balance: '1000000.0000' })
            const building = await seedBuilding(OWNER, plotId, 'farm', 0)

            const result = await burst(5, () => upgradeBuilding(OWNER, building.id))

            expect(result.ok).toBe(1)
            expect(await townDebits(OWNER)).toHaveLength(1)
            const [row] = await buildingsOf(OWNER)
            expect(row!.upgradingTo).toBe(2)
            expect(await getBalance(OWNER)).toBe((1000000 - townLevelCost(FARM, 2).coins).toFixed(4))
        })
    })

    describe('buyPlot', () => {
        it('makes a fresh town wait out the land office cooldown', async () => {
            await foundFor(OWNER, { balance: '1000000.0000' })
            const square = await freeNeighbour(OWNER)

            await expect(buyPlot(OWNER, square.x, square.y)).rejects.toThrow(/not selling to you yet/)
            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe('1000000.0000')
        })

        it('sells the second plot once the cooldown has passed', async () => {
            await foundFor(OWNER, { balance: '1000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const square = await freeNeighbour(OWNER)

            const result = await buyPlot(OWNER, square.x, square.y)
            const price = townPlotPrice(2)

            expect(result).toMatchObject({ price, x: square.x, y: square.y })
            expect(await getBalance(OWNER)).toBe((1000000 - price).toFixed(4))
            expect((await stateOf(OWNER)).plotsBought).toBe(2)

            const plots = await plotsOf(OWNER)
            expect(plots).toHaveLength(2)
            expect(new Set(plots.map(p => `${p.x},${p.y}`)).size).toBe(2)
        })

        it('only sells land that touches a plot the player already owns', async () => {
            await foundFor(OWNER, { balance: '1000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const [plot] = await plotsOf(OWNER)

            // Far away, and diagonal — neither shares an edge with the town.
            await expect(buyPlot(OWNER, plot!.x + 5, plot!.y)).rejects.toThrow(/must touch a plot you own/)
            await expect(buyPlot(OWNER, plot!.x + 1, plot!.y + 1)).rejects.toThrow(/must touch a plot you own/)
            await expect(buyPlot(OWNER, plot!.x + 0.5, plot!.y)).rejects.toThrow(/Pick a square/)

            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await townDebits(OWNER)).toHaveLength(0)
            expect(await getBalance(OWNER)).toBe('1000000.0000')
        })

        it('sells exactly one plot to five concurrent buyers', async () => {
            await foundFor(OWNER, { balance: '1000000.0000' })
            await rewindPlotClock(OWNER, townPlotCooldownMs(2) + MINUTE)
            const square = await freeNeighbour(OWNER)

            const result = await burst(5, () => buyPlot(OWNER, square.x, square.y))

            expect(result.ok).toBe(1)
            expect(await plotsOf(OWNER)).toHaveLength(2)
            expect(await townDebits(OWNER)).toHaveLength(1)
            expect((await stateOf(OWNER)).plotsBought).toBe(2)
            expect(await getBalance(OWNER)).toBe((1000000 - townPlotPrice(2)).toFixed(4))
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
            await foundFor(OWNER, { balance: '1000000.0000' })
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
        it('advances production and carries the leftover tick progress', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })
            await seedBuilding(OWNER, plotId, 'house', 0)
            await seedBuilding(OWNER, plotId, 'farm', 1)
            await rewindSettle(OWNER, 5 * MINUTE)

            const settled = await settleTownForRead(OWNER)

            // Happiness 50 → speed 0.75, so five real minutes buy three or four ticks.
            expect(settled.inventory.wheat).toBeGreaterThanOrEqual(3)
            expect(settled.inventory.wheat).toBeLessThanOrEqual(4)
            expect(await held(OWNER, 'wheat')).toBe(settled.inventory.wheat!)
            expect(settled.state.tickProgressMs).toBeGreaterThan(0)
            expect(settled.state.lastSettledAt.getTime()).toBeGreaterThan(Date.now() - 10_000)

            // Settling again straight away must not mint anything extra.
            const again = await settleTownForRead(OWNER)
            expect(again.inventory.wheat).toBe(settled.inventory.wheat)
        })

        it('bakes a finished build into the building row', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })
            await seedBuilding(OWNER, plotId, 'house', 0)
            const { buildingId } = await placeBuilding(OWNER, plotId, 1, 0, 'farm')
            await db.update(townBuildings)
                .set({ completesAt: new Date(Date.now() - MINUTE) })
                .where(eq(townBuildings.id, buildingId))
            await rewindSettle(OWNER, 5 * MINUTE)

            const settled = await settleTownForRead(OWNER)

            expect(settled.completed).toEqual([{ id: buildingId, level: 1 }])
            expect(settled.buildings.find(b => b.id === buildingId)!.level).toBe(1)
        })

        it('reports what the window produced and how long it covered', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })
            await seedBuilding(OWNER, plotId, 'house', 0)
            await seedBuilding(OWNER, plotId, 'farm', 1)
            await rewindSettle(OWNER, 5 * MINUTE)

            const settled = await settleTownForRead(OWNER)

            expect(settled.delta.wheat).toBe(settled.inventory.wheat)
            expect(settled.delta.wheat).toBeGreaterThanOrEqual(3)
            expect(settled.delta.wheat).toBeLessThanOrEqual(4)
            expect(settled.elapsedMs).toBeGreaterThanOrEqual(5 * MINUTE)
            expect(settled.elapsedMs).toBeLessThan(6 * MINUTE)

            // Settling again immediately covers no time and produces nothing.
            const again = await settleTownForRead(OWNER)
            expect(again.delta).toEqual({})
            expect(again.elapsedMs).toBeLessThan(5_000)
        })

        it('hands back the plots and the buildings in world coordinates', async () => {
            const plotId = await foundFor(OWNER, { balance: '10000.0000' })
            const house = await seedBuilding(OWNER, plotId, 'house', 3)

            const settled = await settleTownForRead(OWNER)

            expect(settled.plots).toHaveLength(1)
            const plot = settled.plots.find(p => p.id === plotId)!
            const placed = settled.sim.find(b => b.id === house.id)!
            expect(placed.wx).toBe(plot.x * TOWN_PLOT_SIZE + 3)
            expect(placed.wy).toBe(plot.y * TOWN_PLOT_SIZE)
        })

        it('refuses to settle a player who never founded a town', async () => {
            await seedUser(OWNER)
            await expect(settleTownForRead(OWNER)).rejects.toThrow(/Found a town first/)
        })
    })

    describe('sellToFloor and buyFromCeiling', () => {
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

            // Buying goods back off the system is spending, not earning.
            await buyFromCeiling(OWNER, 'wheat', 1)
            expect((await stateOf(OWNER)).coinsEarned).toBe((townFloorPrice('wheat') * 10).toFixed(4))
        })

        it('sells goods back at the ceiling price', async () => {
            const ceiling = townCeilingPrice('wheat')
            await seedUser(OWNER, { balance: (ceiling * 3).toFixed(4) })

            const result = await buyFromCeiling(OWNER, 'wheat', 3)

            expect(result.price).toBe(ceiling)
            expect(result.total).toBe(ceiling * 3)
            expect(await getBalance(OWNER)).toBe('0.0000')
            expect(await held(OWNER, 'wheat')).toBe(3)

            await expect(buyFromCeiling(OWNER, 'wheat', 1)).rejects.toThrow()
            expect(await held(OWNER, 'wheat')).toBe(3)
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
            await seedBuilding(OWNER, plotId, 'house', 0, 0)
            await db.update(townBuildings)
                .set({ completesAt: new Date(Date.now() + 10 * MINUTE) })
                .where(eq(townBuildings.userId, OWNER))
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
            const plotId = await foundFor(OWNER, { balance: '100000.0000' })
            await seedBuilding(OWNER, plotId, 'house', 0)
            await stock(OWNER, 'wheat', 5)
            await placeTownOrder(OWNER, 'wheat', 'sell', 6, 5)

            await deleteTownForUser(OWNER)

            expect(await plotsOf(OWNER)).toHaveLength(0)
            expect(await buildingsOf(OWNER)).toHaveLength(0)
            expect(await openOrders(OWNER)).toHaveLength(0)
            expect(await held(OWNER, 'wheat')).toBe(0)
            expect(await db.query.townState.findFirst({ where: eq(townState.userId, OWNER) })).toBeUndefined()
        })
    })
})
