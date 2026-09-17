import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgBuyOrder, tcgListing, tcgCopy, tcgCopyTransfer, tcgPrinting, tcgCard, tcgSheet, tcgSet } from '#server/database/schema'
import { credit, debit } from '#server/utils/balance'
import { lockCopyForUpdate, assertUnencumbered } from '#server/utils/tcg/market'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'

/*
 * The bid side (§7.1): standing buy orders for SLABBED cards only. A slab's
 * grade is public and certified, so (printing, service, grade, designation)
 * is a sufficient identity and the book can auto-match — the raw market
 * never touches this file.
 *
 * Modeled on the gem exchange: escrow is debit-on-place (price × quantity
 * Coins leave the bidder immediately), refund-on-cancel for the unfilled
 * remainder, and every mutation of one book is serialized by a transaction-
 * scoped advisory lock so a fill can never race a cancel or another fill.
 * Fills execute at the resting bid's price; the seller receives 95%, the 5%
 * is burned (the bidder escrowed the full price — the burn comes out of the
 * spread, exactly as with listings).
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface BookKey {
    printingId: string
    gradeService: string
    grade: string
    gradeDesignation: string | null
}

/** Normalize a grade the way grading.ts writes it: String(Number(x)). */
export function normalizeGrade(grade: string): string {
    const n = Number(grade)
    if (!Number.isFinite(n)) badRequest('Invalid grade')
    return String(n)
}

function bookLockName(key: BookKey): string {
    return `tcg-book-${key.printingId}|${key.gradeService}|${key.grade}|${key.gradeDesignation ?? ''}`
}

/** Serialize every mutation of one (printing, grade) book. */
async function lockBook(tx: Tx, key: BookKey): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${bookLockName(key)}))`)
}

function keyConditions(key: BookKey) {
    return and(
        eq(tcgBuyOrder.printingId, key.printingId),
        eq(tcgBuyOrder.gradeService, key.gradeService),
        eq(tcgBuyOrder.grade, key.grade),
        key.gradeDesignation === null
            ? sql`${tcgBuyOrder.gradeDesignation} is null`
            : eq(tcgBuyOrder.gradeDesignation, key.gradeDesignation)
    )
}

export interface BuyOrderRow {
    id: string
    price: string
    quantity: number
    filled: number
    status: string
}

export async function placeBuyOrder(
    userId: string,
    key: BookKey,
    price: number,
    quantity: number
): Promise<BuyOrderRow> {
    if (!Number.isFinite(price) || price < TCG_MARKET.minPrice || price > TCG_MARKET.maxPrice) {
        badRequest('Price out of range')
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > TCG_MARKET.maxOrderQuantity) {
        badRequest('Quantity out of range')
    }
    const grade = normalizeGrade(key.grade)
    const normalized = { ...key, grade }

    return await db.transaction(async (tx) => {
        await lockBook(tx, normalized)

        const [printing] = await tx.select({ id: tcgPrinting.id }).from(tcgPrinting)
            .where(eq(tcgPrinting.id, normalized.printingId))
        if (!printing) badRequest('Unknown printing')

        const [counted] = await tx.select({ open: sql<number>`count(*)::int` }).from(tcgBuyOrder)
            .where(and(eq(tcgBuyOrder.userId, userId), eq(tcgBuyOrder.status, 'open')))
        if ((counted?.open ?? 0) >= TCG_MARKET.maxOpenOrders) badRequest('Too many open buy orders')

        // Escrow the whole order up front — the book only ever shows funded
        // bids, which is what makes "sell instantly" instant.
        await debit(userId, (price * quantity).toFixed(4), 'tcg:market', tx)

        const [row] = await tx.insert(tcgBuyOrder).values({
            userId,
            printingId: normalized.printingId,
            gradeService: normalized.gradeService,
            grade: normalized.grade,
            gradeDesignation: normalized.gradeDesignation,
            price: price.toFixed(4),
            quantity
        }).returning()
        return row as BuyOrderRow
    })
}

export async function cancelBuyOrder(userId: string, orderId: string): Promise<void> {
    await db.transaction(async (tx) => {
        const [order] = await tx.select().from(tcgBuyOrder).where(eq(tcgBuyOrder.id, orderId))
        if (!order || order.userId !== userId) badRequest('Order is not yours to cancel')
        await lockBook(tx, order!)

        const [cancelled] = await tx.update(tcgBuyOrder)
            .set({ status: 'cancelled' })
            .where(and(
                eq(tcgBuyOrder.id, orderId),
                eq(tcgBuyOrder.userId, userId),
                eq(tcgBuyOrder.status, 'open')
            ))
            .returning()
        if (!cancelled) badRequest('Order is already gone')

        const remaining = cancelled!.quantity - cancelled!.filled
        if (remaining > 0) {
            await credit(userId, (parseFloat(cancelled!.price) * remaining).toFixed(4), 'tcg:market', tx)
        }
    })
}

export interface BookFill {
    orderId: string
    price: number
    proceeds: number
    buyerId: string
}

/**
 * Sell a slabbed copy into the best standing bid for its exact grade key.
 * The whole §7.1 liquidity promise in one call: no listing, no waiting.
 */
export async function sellIntoBid(userId: string, copyId: string): Promise<BookFill> {
    return await db.transaction(async (tx) => {
        const copy = await lockCopyForUpdate(tx, copyId)
        if (!copy || copy.ownerId !== userId) badRequest('Copy is not yours to sell')
        if (copy!.lifecycle !== 'slabbed' || !copy!.gradeService || !copy!.grade) {
            badRequest('Only slabbed copies trade on the book')
        }
        await assertUnencumbered(tx, copyId)

        // Low serials are excluded from the book even when slabbed (§7.1):
        // blind-filling a bid with #007 cheats one side or the other.
        const [sheet] = await tx.select({ packSlots: tcgSheet.packSlots }).from(tcgSheet)
            .where(eq(tcgSheet.id, copy!.sheetId))
        const serial = copy!.cutIndex * (sheet?.packSlots ?? 1) + copy!.slotOffset + 1
        if (serial <= TCG_MARKET.lowSerialMax) {
            badRequest('Low-serial copies do not trade on the book — list or auction them')
        }

        const key: BookKey = {
            printingId: copy!.printingId,
            gradeService: copy!.gradeService!,
            grade: copy!.grade!,
            gradeDesignation: copy!.gradeDesignation
        }
        await lockBook(tx, key)

        // Best bid: highest price first, oldest first at a level (price-time
        // priority, the gem-exchange discipline). Selling into your own bid
        // is refused — it would only burn your own 5%.
        const [best] = await tx.select().from(tcgBuyOrder)
            .where(and(
                keyConditions(key),
                eq(tcgBuyOrder.status, 'open'),
                gt(sql`${tcgBuyOrder.quantity} - ${tcgBuyOrder.filled}`, 0),
                sql`${tcgBuyOrder.userId} <> ${userId}`
            ))
            .orderBy(desc(tcgBuyOrder.price), asc(tcgBuyOrder.createdAt))
            .limit(1)
        if (!best) badRequest('No standing bid for this card')

        const [filled] = await tx.update(tcgBuyOrder)
            .set({
                filled: sql`${tcgBuyOrder.filled} + 1`,
                status: sql`case when ${tcgBuyOrder.filled} + 1 >= ${tcgBuyOrder.quantity} then 'filled' else 'open' end`
            })
            .where(and(eq(tcgBuyOrder.id, best!.id), eq(tcgBuyOrder.status, 'open')))
            .returning()
        if (!filled) throw createError({ statusCode: 500, statusMessage: 'Order book conflict' })

        const price = parseFloat(best!.price)
        const proceeds = sellerProceeds(price)
        // The bidder escrowed the full price at placement; the seller gets
        // 95% and the 5% spread is burned — nothing more moves for the buyer.
        await credit(userId, proceeds.toFixed(4), 'tcg:market', tx)

        await tx.update(tcgCopy).set({ ownerId: best!.userId }).where(eq(tcgCopy.id, copyId))
        await tx.insert(tcgCopyTransfer).values({
            copyId,
            fromUserId: userId,
            toUserId: best!.userId,
            kind: 'sale',
            price: best!.price
        })
        // A synthetic sold listing row: sales history, price displays and the
        // §7.2 views pick the fill up with zero extra plumbing.
        await tx.insert(tcgListing).values({
            copyId,
            sellerId: userId,
            buyerId: best!.userId,
            price: best!.price,
            state: 'sold',
            soldAt: new Date(),
            soldGradeService: copy!.gradeService,
            soldGrade: copy!.grade,
            soldDesignation: copy!.gradeDesignation
        })

        return { orderId: best!.id, price, proceeds, buyerId: best!.userId }
    })
}

export interface BookLevel {
    price: number
    quantity: number
    orders: number
}

export interface BookView {
    levels: BookLevel[]
    own: { id: string, price: number, quantity: number, filled: number }[]
}

/** Aggregated bid levels for one grade key, plus the caller's own orders. */
export async function bookFor(userId: string, key: BookKey): Promise<BookView> {
    const grade = normalizeGrade(key.grade)
    const normalized = { ...key, grade }
    const levels = await db.select({
        price: tcgBuyOrder.price,
        quantity: sql<number>`sum(${tcgBuyOrder.quantity} - ${tcgBuyOrder.filled})::int`,
        orders: sql<number>`count(*)::int`
    })
        .from(tcgBuyOrder)
        .where(and(keyConditions(normalized), eq(tcgBuyOrder.status, 'open')))
        .groupBy(tcgBuyOrder.price)
        .orderBy(desc(tcgBuyOrder.price))
        .limit(12)

    const own = await db.select().from(tcgBuyOrder)
        .where(and(keyConditions(normalized), eq(tcgBuyOrder.userId, userId), eq(tcgBuyOrder.status, 'open')))
        .orderBy(desc(tcgBuyOrder.createdAt))

    return {
        levels: levels.map(level => ({
            price: parseFloat(level.price),
            quantity: level.quantity,
            orders: level.orders
        })),
        own: own.map(order => ({
            id: order.id,
            price: parseFloat(order.price),
            quantity: order.quantity,
            filled: order.filled
        }))
    }
}

/** Every open order of one user, joined for display on the market page. */
export async function ownOrders(userId: string) {
    return await db.select({
        id: tcgBuyOrder.id,
        printingId: tcgBuyOrder.printingId,
        gradeService: tcgBuyOrder.gradeService,
        grade: tcgBuyOrder.grade,
        gradeDesignation: tcgBuyOrder.gradeDesignation,
        price: tcgBuyOrder.price,
        quantity: tcgBuyOrder.quantity,
        filled: tcgBuyOrder.filled,
        createdAt: tcgBuyOrder.createdAt,
        cardName: tcgCard.name,
        cardNumber: tcgCard.number,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        printRunLabel: tcgPrinting.printRunLabel,
        setId: tcgPrinting.setId,
        setName: tcgSet.name
    })
        .from(tcgBuyOrder)
        .innerJoin(tcgPrinting, eq(tcgBuyOrder.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSet, eq(tcgPrinting.setId, tcgSet.id))
        .where(and(eq(tcgBuyOrder.userId, userId), eq(tcgBuyOrder.status, 'open')))
        .orderBy(desc(tcgBuyOrder.createdAt))
}
