import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '#server/database'
import { transactions, townState, townPlots, townBuildings } from '#server/database/schema'
import { getBalance } from '#server/utils/balance'
import {
    buyPlotFromPlayer,
    deleteTownForUser,
    foundTown,
    getWorldView,
    listPlot,
    sellPlotToSystem
} from '#server/utils/town'
import {
    TOWN_FOUNDING_GAP,
    TOWN_MAX_PLOTS,
    TOWN_PLOT_MAX_LIST_PRICE,
    TOWN_PLOT_MIN_LIST_PRICE,
    TOWN_PLOT_REFUND_SHARE,
    isValidTownListPrice,
    townPlotDistance,
    townPlotPrice,
    townPlotRefundFor,
    townSpiralCoords
} from '#shared/utils/gamelogic/town'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const OWNER = 'test-plotmkt-owner'
const SELLER = 'test-plotmkt-seller'
const BUYER = 'test-plotmkt-buyer'
const RIVAL = 'test-plotmkt-rival'
const USERS = [OWNER, SELLER, BUYER, RIVAL]

const SEED_NAME = 'concurrency test user'

type PlotRow = typeof townPlots.$inferSelect

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe('plot market rules', () => {
    describe('townPlotRefundFor', () => {
        it('pays back a quarter of what the plot cost its owner', () => {
            for (const paid of [0, 1, 50_000, 225_000, 1_012_500]) {
                expect(townPlotRefundFor(paid)).toBe(Math.floor(paid * TOWN_PLOT_REFUND_SHARE))
            }
            expect(townPlotRefundFor(townPlotPrice(2))).toBe(12_500)
        })

        it('pays nothing for a plot that cost nothing', () => {
            expect(townPlotRefundFor(0)).toBe(0)
            expect(townPlotRefundFor(-5)).toBe(0)
        })

        it('never returns more than was paid', () => {
            for (const paid of [1, 1_000, 50_000, 10_000_000]) {
                expect(townPlotRefundFor(paid)).toBeLessThan(paid)
            }
        })

        it('cannot be pumped by trading: a cheap plot refunds a cheap price', () => {
            // The exploit this replaced: buy a plot off a neighbour for one
            // coin, sell it back at the price of your NEXT land-office plot.
            expect(townPlotRefundFor(1)).toBeLessThan(townPlotRefundFor(townPlotPrice(12)))
            expect(townPlotRefundFor(1)).toBe(0)
        })
    })

    describe('isValidTownListPrice', () => {
        it('accepts a whole or two-decimal price inside the band', () => {
            expect(isValidTownListPrice(TOWN_PLOT_MIN_LIST_PRICE)).toBe(true)
            expect(isValidTownListPrice(TOWN_PLOT_MAX_LIST_PRICE)).toBe(true)
            expect(isValidTownListPrice(250)).toBe(true)
            expect(isValidTownListPrice(1.5)).toBe(true)
            expect(isValidTownListPrice(1.25)).toBe(true)
        })

        it('rejects anything under the minimum', () => {
            expect(isValidTownListPrice(TOWN_PLOT_MIN_LIST_PRICE - 0.01)).toBe(false)
            expect(isValidTownListPrice(0)).toBe(false)
            expect(isValidTownListPrice(-100)).toBe(false)
        })

        it('rejects anything over the maximum', () => {
            expect(isValidTownListPrice(TOWN_PLOT_MAX_LIST_PRICE + 1)).toBe(false)
            expect(isValidTownListPrice(Number.MAX_SAFE_INTEGER)).toBe(false)
        })

        it('rejects more than two decimals and non-finite prices', () => {
            expect(isValidTownListPrice(1.005)).toBe(false)
            expect(isValidTownListPrice(10.123)).toBe(false)
            expect(isValidTownListPrice(Number.NaN)).toBe(false)
            expect(isValidTownListPrice(Number.POSITIVE_INFINITY)).toBe(false)
        })
    })

    describe('townPlotDistance', () => {
        it('measures Chebyshev distance, so a diagonal step is one plot', () => {
            expect(townPlotDistance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0)
            expect(townPlotDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1)
            expect(townPlotDistance({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3)
            expect(townPlotDistance({ x: -2, y: 5 }, { x: 1, y: 4 })).toBe(3)
        })

        it('is symmetric', () => {
            const a = { x: 4, y: -7 }
            const b = { x: -1, y: 2 }
            expect(townPlotDistance(a, b)).toBe(townPlotDistance(b, a))
        })
    })
})

// ─── Database ────────────────────────────────────────────────────────────────

async function plotsOf(id: string) {
    return db.select().from(townPlots).where(eq(townPlots.userId, id))
}

async function stateOf(id: string) {
    const row = await db.query.townState.findFirst({ where: eq(townState.userId, id) })
    return row!
}

async function plotRow(id: string) {
    return db.query.townPlots.findFirst({ where: eq(townPlots.id, id) })
}

async function ledger(id: string, type: 'credit' | 'debit') {
    return db.select().from(transactions).where(and(eq(transactions.userId, id), eq(transactions.type, type)))
}

async function allPlots() {
    return db.select({ x: townPlots.x, y: townPlots.y, userId: townPlots.userId }).from(townPlots)
}

/** The row at a given square, from what a seeding helper handed back. */
function pick(rows: PlotRow[], x: number, y: number) {
    const row = rows.find(p => p.x === x && p.y === y)
    if (!row) throw new Error(`no seeded plot at ${x},${y}`)
    return row
}

const REGION_HALF_WIDTH = 16

/**
 * A patch of the shared realm nothing else is standing on. Where `foundTown`
 * lands depends on every other town in the database, so the specs that need
 * exact adjacency place their plots by hand out here instead.
 */
async function freeRegion() {
    const taken = await allPlots()
    for (let x = 500; x < 100_000; x += REGION_HALF_WIDTH * 2) {
        const clash = taken.some(p => Math.abs(p.x - x) <= REGION_HALF_WIDTH && Math.abs(p.y - 500) <= REGION_HALF_WIDTH)
        if (!clash) return { x, y: 500 }
    }
    throw new Error('no free region left in the realm')
}

/**
 * Seed a player with a town whose land sits exactly where the spec wants it:
 * found normally (so the state row exists), then move the plots out to the
 * given squares. `plotsBought` follows the number of plots unless overridden.
 */
async function townAt(
    id: string,
    coords: { x: number, y: number }[],
    opts: { balance?: string, plotsBought?: number, paidPrice?: string } = {}
): Promise<PlotRow[]> {
    await seedUser(id, { balance: opts.balance })
    await foundTown(id)
    await db.delete(townPlots).where(eq(townPlots.userId, id))
    // Plots remember what they cost; the refund is a share of that.
    const paidPrice = opts.paidPrice ?? townPlotPrice(2).toFixed(4)
    const rows = await db.insert(townPlots).values(coords.map(c => ({ userId: id, x: c.x, y: c.y, paidPrice }))).returning()
    await db.update(townState)
        .set({ plotsBought: opts.plotsBought ?? coords.length })
        .where(eq(townState.userId, id))
    return rows
}

/** Drop a finished building onto a plot — the thing that stops it changing hands. */
async function seedBuilding(userId: string, plotId: string, type = 'road', tileX = 0, level = 1) {
    const [row] = await db.insert(townBuildings).values({
        userId,
        plotId,
        type,
        tileX,
        tileY: 0,
        level,
        completesAt: new Date(Date.now() - 60_000)
    }).returning()
    return row!
}

async function cleanup() {
    for (const id of USERS) {
        await deleteTownForUser(id)
        await cleanupUser(id)
    }
}

describe.skipIf(SKIP)('polytown plot market (database)', () => {
    beforeEach(cleanup)
    afterEach(cleanup)
    afterAll(async () => { await db.$client.end() })

    describe('foundTown — one shared realm', () => {
        it('leaves TOWN_FOUNDING_GAP empty plots around every new town', async () => {
            const before = await allPlots()

            for (const id of [OWNER, SELLER, BUYER]) {
                await seedUser(id)
                await foundTown(id)
            }

            const mine = [
                ...await plotsOf(OWNER),
                ...await plotsOf(SELLER),
                ...await plotsOf(BUYER)
            ]
            expect(mine).toHaveLength(3)

            // Nobody landed on top of the realm as it already stood…
            for (const seeded of mine) {
                for (const existing of before) {
                    expect(townPlotDistance(seeded, existing)).toBeGreaterThan(TOWN_FOUNDING_GAP)
                }
            }
            // …nor on top of each other: at least two empty plots in between.
            for (const a of mine) {
                for (const b of mine) {
                    if (a.id === b.id) continue
                    expect(townPlotDistance(a, b)).toBeGreaterThanOrEqual(TOWN_FOUNDING_GAP + 1)
                }
            }
        })

        it('plants the town on the first spiral square that clears the gap', async () => {
            const before = await allPlots()
            const expected = (() => {
                for (let i = 0; i < 100_000; i++) {
                    const spot = townSpiralCoords(i)
                    if (!before.some(p => townPlotDistance(p, spot) <= TOWN_FOUNDING_GAP)) return spot
                }
                throw new Error('no free spiral square')
            })()

            await seedUser(OWNER)
            await foundTown(OWNER)

            const [plot] = await plotsOf(OWNER)
            expect({ x: plot!.x, y: plot!.y }).toEqual(expected)
        })

        it('spaces a run of foundings without ever reusing a square', async () => {
            for (const id of [OWNER, SELLER, BUYER, RIVAL]) {
                await seedUser(id)
                await foundTown(id)
            }
            const squares = (await allPlots()).map(p => `${p.x},${p.y}`)
            expect(new Set(squares).size).toBe(squares.length)
        })
    })

    describe('listPlot', () => {
        it('sets and clears the asking price', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            const spare = pick(rows, at.x + 1, at.y)

            const listed = await listPlot(OWNER, spare.id, 1_250.5)
            expect(listed.listPrice).toBe(1_250.5)
            expect((await plotRow(spare.id))!.listPrice).toBe('1250.5000')

            const cleared = await listPlot(OWNER, spare.id, null)
            expect(cleared.listPrice).toBeNull()
            expect((await plotRow(spare.id))!.listPrice).toBeNull()
        })

        it('refuses a plot that is not yours', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            await townAt(RIVAL, [{ x: at.x + 5, y: at.y }])

            await expect(listPlot(RIVAL, pick(rows, at.x + 1, at.y).id, 500)).rejects.toThrow(/not yours/)
            expect((await plotRow(pick(rows, at.x + 1, at.y).id))!.listPrice).toBeNull()
        })

        it('refuses a plot with a building on it — roads count', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            const spare = pick(rows, at.x + 1, at.y)
            await seedBuilding(OWNER, spare.id, 'road')

            await expect(listPlot(OWNER, spare.id, 500)).rejects.toThrow(/Clear every building/)
            expect((await plotRow(spare.id))!.listPrice).toBeNull()
        })

        it('refuses the last plot a mayor has left', async () => {
            const at = await freeRegion()
            const [only] = await townAt(OWNER, [{ x: at.x, y: at.y }])

            await expect(listPlot(OWNER, only!.id, 500)).rejects.toThrow(/last plot/)
            expect((await plotRow(only!.id))!.listPrice).toBeNull()
        })

        it('still lets a mayor take their last plot off the market', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            const spare = pick(rows, at.x + 1, at.y)
            await listPlot(OWNER, spare.id, 500)
            await db.delete(townPlots).where(eq(townPlots.id, pick(rows, at.x, at.y).id))

            await expect(listPlot(OWNER, spare.id, null)).resolves.toMatchObject({ listPrice: null })
            expect((await plotRow(spare.id))!.listPrice).toBeNull()
        })

        it('refuses a price outside the allowed band', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            const spare = pick(rows, at.x + 1, at.y)

            for (const price of [
                TOWN_PLOT_MIN_LIST_PRICE - 0.01,
                0,
                -1,
                TOWN_PLOT_MAX_LIST_PRICE + 1,
                10.123
            ]) {
                await expect(listPlot(OWNER, spare.id, price)).rejects.toThrow(/at least 1 coin/)
            }
            expect((await plotRow(spare.id))!.listPrice).toBeNull()
        })
    })

    describe('sellPlotToSystem', () => {
        it('pays a quarter of the plot price, removes the plot and steps plotsBought back', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }], { balance: '0' })
            const spare = pick(rows, at.x + 1, at.y)
            const refund = townPlotRefundFor(townPlotPrice(2))

            const result = await sellPlotToSystem(OWNER, spare.id)

            expect(result.refund).toBe(refund)
            expect(await getBalance(OWNER)).toBe(refund.toFixed(4))
            expect(await plotRow(spare.id)).toBeUndefined()
            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect((await stateOf(OWNER)).plotsBought).toBe(1)
        })

        it('never drops plotsBought below one', async () => {
            const at = await freeRegion()
            const rows = await townAt(
                OWNER,
                [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }],
                // A plot that cost nothing refunds nothing, and the counter
                // cannot go below the one plot every town keeps.
                { balance: '0', plotsBought: 1, paidPrice: '0' }
            )

            const result = await sellPlotToSystem(OWNER, pick(rows, at.x + 1, at.y).id)

            expect(result.refund).toBe(0)
            expect(await getBalance(OWNER)).toBe('0.0000')
            expect(await ledger(OWNER, 'credit')).toHaveLength(0)
            expect((await stateOf(OWNER)).plotsBought).toBe(1)
        })

        it('refuses a plot that still has something standing on it', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }], { balance: '0' })
            const spare = pick(rows, at.x + 1, at.y)
            await seedBuilding(OWNER, spare.id, 'house')

            await expect(sellPlotToSystem(OWNER, spare.id)).rejects.toThrow(/Clear every building/)
            expect(await plotsOf(OWNER)).toHaveLength(2)
            expect(await getBalance(OWNER)).toBe('0.0000')
        })

        it('refuses the last plot a mayor has left', async () => {
            const at = await freeRegion()
            const [only] = await townAt(OWNER, [{ x: at.x, y: at.y }], { balance: '0' })

            await expect(sellPlotToSystem(OWNER, only!.id)).rejects.toThrow(/last plot/)
            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe('0.0000')
        })

        it('refuses a plot that is not yours', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }])
            await townAt(RIVAL, [{ x: at.x + 5, y: at.y }], { balance: '0' })

            await expect(sellPlotToSystem(RIVAL, pick(rows, at.x + 1, at.y).id)).rejects.toThrow(/not yours/)
            expect(await plotsOf(OWNER)).toHaveLength(2)
            expect(await getBalance(RIVAL)).toBe('0.0000')
        })

        it('sells the plot once under a burst, and pays one refund', async () => {
            const at = await freeRegion()
            const rows = await townAt(OWNER, [{ x: at.x, y: at.y }, { x: at.x + 1, y: at.y }], { balance: '0' })
            const spare = pick(rows, at.x + 1, at.y)
            const refund = townPlotRefundFor(townPlotPrice(2))

            const result = await burst(5, () => sellPlotToSystem(OWNER, spare.id))

            expect(result.ok).toBe(1)
            expect(await plotsOf(OWNER)).toHaveLength(1)
            expect(await ledger(OWNER, 'credit')).toHaveLength(1)
            expect(await getBalance(OWNER)).toBe(refund.toFixed(4))
            expect((await stateOf(OWNER)).plotsBought).toBe(1)
        })
    })

    describe('buyPlotFromPlayer', () => {
        /** A buyer next door to a seller whose middle plot is on the market. */
        async function marketPair(price: number | null = 250) {
            const at = await freeRegion()
            const buyerPlots = await townAt(BUYER, [{ x: at.x, y: at.y }], { balance: '10000.0000' })
            const sellerPlots = await townAt(
                SELLER,
                [{ x: at.x + 1, y: at.y }, { x: at.x + 2, y: at.y }],
                { balance: '0' }
            )
            const forSale = pick(sellerPlots, at.x + 1, at.y)
            if (price !== null) await listPlot(SELLER, forSale.id, price)
            return {
                at,
                price,
                buyerPlot: pick(buyerPlots, at.x, at.y),
                forSale,
                sellerKeeps: pick(sellerPlots, at.x + 2, at.y)
            }
        }

        it('moves the land, the coins and both plot counters', async () => {
            const { price, forSale } = await marketPair(250)

            const result = await buyPlotFromPlayer(BUYER, forSale.id)

            expect(result).toMatchObject({ plotId: forSale.id, price: 250, sellerId: SELLER })
            expect(await getBalance(BUYER)).toBe((10_000 - price!).toFixed(4))
            expect(await getBalance(SELLER)).toBe(price!.toFixed(4))

            const row = await plotRow(forSale.id)
            expect(row!.userId).toBe(BUYER)
            expect(row!.listPrice).toBeNull()

            expect(await plotsOf(BUYER)).toHaveLength(2)
            expect(await plotsOf(SELLER)).toHaveLength(1)
            expect((await stateOf(BUYER)).plotsBought).toBe(2)
            expect((await stateOf(SELLER)).plotsBought).toBe(1)
        })

        it('floors the seller plot counter at one', async () => {
            const at = await freeRegion()
            await townAt(BUYER, [{ x: at.x, y: at.y }], { balance: '10000.0000' })
            const sellerPlots = await townAt(
                SELLER,
                [{ x: at.x + 1, y: at.y }, { x: at.x + 2, y: at.y }],
                { balance: '0', plotsBought: 1 }
            )
            const forSale = pick(sellerPlots, at.x + 1, at.y)
            await listPlot(SELLER, forSale.id, 100)

            await buyPlotFromPlayer(BUYER, forSale.id)

            expect((await stateOf(SELLER)).plotsBought).toBe(1)
        })

        it('refuses a plot nobody put on the market', async () => {
            const { forSale } = await marketPair(null)

            await expect(buyPlotFromPlayer(BUYER, forSale.id)).rejects.toThrow(/not for sale/)
            expect((await plotRow(forSale.id))!.userId).toBe(SELLER)
            expect(await getBalance(BUYER)).toBe('10000.0000')
        })

        it('refuses your own listing', async () => {
            const at = await freeRegion()
            const buyerPlots = await townAt(
                BUYER,
                [{ x: at.x, y: at.y }, { x: at.x, y: at.y + 1 }],
                { balance: '10000.0000' }
            )
            const own = pick(buyerPlots, at.x, at.y + 1)
            await listPlot(BUYER, own.id, 400)

            await expect(buyPlotFromPlayer(BUYER, own.id)).rejects.toThrow(/already yours/)
            expect(await getBalance(BUYER)).toBe('10000.0000')
            expect((await plotRow(own.id))!.listPrice).toBe('400.0000')
        })

        it('refuses a listing with a building still on it', async () => {
            const { forSale } = await marketPair(250)
            await seedBuilding(SELLER, forSale.id, 'road')

            await expect(buyPlotFromPlayer(BUYER, forSale.id)).rejects.toThrow(/Clear every building/)
            expect((await plotRow(forSale.id))!.userId).toBe(SELLER)
            expect(await getBalance(BUYER)).toBe('10000.0000')
            expect(await getBalance(SELLER)).toBe('0.0000')
        })

        it('refuses a listing that does not touch land you already own', async () => {
            const { at, sellerKeeps } = await marketPair(250)
            await listPlot(SELLER, sellerKeeps.id, 300)
            expect(Math.abs(sellerKeeps.x - at.x) + Math.abs(sellerKeeps.y - at.y)).toBe(2)

            await expect(buyPlotFromPlayer(BUYER, sellerKeeps.id)).rejects.toThrow(/does not touch your land/)
            expect((await plotRow(sellerKeeps.id))!.userId).toBe(SELLER)
            expect(await getBalance(BUYER)).toBe('10000.0000')
        })

        it('refuses a buyer who is already at the plot cap', async () => {
            const at = await freeRegion()
            const full = Array.from({ length: TOWN_MAX_PLOTS }, (_, i) => ({ x: at.x, y: at.y + i }))
            await townAt(BUYER, full, { balance: '10000.0000' })
            const sellerPlots = await townAt(
                SELLER,
                [{ x: at.x + 1, y: at.y }, { x: at.x + 2, y: at.y }],
                { balance: '0' }
            )
            const forSale = pick(sellerPlots, at.x + 1, at.y)
            await listPlot(SELLER, forSale.id, 250)

            await expect(buyPlotFromPlayer(BUYER, forSale.id)).rejects.toThrow(/maximum number of plots/)
            expect((await plotRow(forSale.id))!.userId).toBe(SELLER)
            expect(await plotsOf(BUYER)).toHaveLength(TOWN_MAX_PLOTS)
            expect(await getBalance(BUYER)).toBe('10000.0000')
        })

        it('sells a contested listing to exactly one of two racing buyers', async () => {
            const at = await freeRegion()
            await townAt(BUYER, [{ x: at.x, y: at.y }], { balance: '10000.0000' })
            await townAt(RIVAL, [{ x: at.x + 2, y: at.y }], { balance: '10000.0000' })
            const sellerPlots = await townAt(
                SELLER,
                [{ x: at.x + 1, y: at.y }, { x: at.x + 1, y: at.y + 1 }],
                { balance: '0' }
            )
            const forSale = pick(sellerPlots, at.x + 1, at.y)
            const price = 750
            await listPlot(SELLER, forSale.id, price)

            const result = await burst(6, i => buyPlotFromPlayer(i % 2 === 0 ? BUYER : RIVAL, forSale.id))

            expect(result.ok).toBe(1)

            const row = await plotRow(forSale.id)
            expect(row!.listPrice).toBeNull()
            expect([BUYER, RIVAL]).toContain(row!.userId)

            // The seller is paid once, and only the winner is charged.
            expect(await ledger(SELLER, 'credit')).toHaveLength(1)
            expect(await getBalance(SELLER)).toBe(price.toFixed(4))
            expect((await stateOf(SELLER)).plotsBought).toBe(1)

            const winner = row!.userId
            const loser = winner === BUYER ? RIVAL : BUYER
            expect(await getBalance(winner)).toBe((10_000 - price).toFixed(4))
            expect(await getBalance(loser)).toBe('10000.0000')
            expect(await ledger(winner, 'debit')).toHaveLength(1)
            expect(await ledger(loser, 'debit')).toHaveLength(0)
            expect(await plotsOf(winner)).toHaveLength(2)
            expect(await plotsOf(loser)).toHaveLength(1)
        })
    })

    describe('getWorldView', () => {
        it('reports the neighbours, their buildings and what they have listed', async () => {
            const at = await freeRegion()
            const [ownPlot] = await townAt(OWNER, [{ x: at.x, y: at.y }])
            const sellerPlots = await townAt(
                SELLER,
                [{ x: at.x + 1, y: at.y }, { x: at.x + 1, y: at.y + 1 }],
                { balance: '0' }
            )
            const forSale = pick(sellerPlots, at.x + 1, at.y)
            const homestead = pick(sellerPlots, at.x + 1, at.y + 1)
            await listPlot(SELLER, forSale.id, 900)
            await seedBuilding(SELLER, homestead.id, 'house', 1, 1)
            // Still under construction — the map should not draw it yet.
            await seedBuilding(SELLER, homestead.id, 'farm', 2, 0)

            const view = await getWorldView(OWNER, [{ x: ownPlot!.x, y: ownPlot!.y }])

            expect(view.towns).toHaveLength(2)
            expect(view.towns.map(t => t.id)).not.toContain(ownPlot!.id)

            const listedView = view.towns.find(t => t.id === forSale.id)!
            expect(listedView).toMatchObject({ x: forSale.x, y: forSale.y, ownerId: SELLER, ownerName: SEED_NAME, listPrice: 900 })
            expect(listedView.buildings).toHaveLength(0)

            const homesteadView = view.towns.find(t => t.id === homestead.id)!
            expect(homesteadView.listPrice).toBeNull()
            expect(homesteadView.buildings).toHaveLength(1)
            expect(homesteadView.buildings[0]).toMatchObject({ type: 'house', level: 1 })

            expect(view.listings).toEqual([
                { plotId: forSale.id, x: forSale.x, y: forSale.y, ownerName: SEED_NAME, price: 900 }
            ])
        })

        it('leaves out land far outside the radius', async () => {
            const at = await freeRegion()
            const [ownPlot] = await townAt(OWNER, [{ x: at.x, y: at.y }])
            const nearPlots = await townAt(SELLER, [{ x: at.x + 1, y: at.y }, { x: at.x + 2, y: at.y }], { balance: '0' })
            const far = await townAt(RIVAL, [{ x: at.x + 12, y: at.y }])
            await listPlot(SELLER, pick(nearPlots, at.x + 1, at.y).id, 50)

            const view = await getWorldView(OWNER, [{ x: ownPlot!.x, y: ownPlot!.y }], 6)

            expect(view.towns.map(t => t.id)).not.toContain(far[0]!.id)
            expect(view.towns.map(t => t.ownerId)).not.toContain(RIVAL)
            expect(view.towns.map(t => t.id).sort()).toEqual(nearPlots.map(p => p.id).sort())
            expect(view.listings).toHaveLength(1)
        })

        it('returns nothing for a mayor with no land', async () => {
            await seedUser(OWNER)
            expect(await getWorldView(OWNER, [])).toEqual({ towns: [], listings: [] })
        })
    })
})
