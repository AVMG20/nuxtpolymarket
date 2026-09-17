import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgLot, tcgLotItem, tcgCopy, tcgCopyTransfer, tcgPrinting, tcgCard, user } from '#server/database/schema'
import { credit, debit } from '#server/utils/balance'
import { copyEncumbrance } from '#server/utils/tcg/market'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'

/*
 * Bulk lots (§7.1): raw copies sold explicitly as unsorted and uninspected.
 * The buyer sees a count and a price — never renders, never serials. The
 * seller picks PRINTINGS AND COUNTS, not copies: the server selects the
 * actual copies, which is what "unsorted" means and keeps the flow as easy
 * as selling one card. Copies in an active lot are encumbered until the lot
 * sells or is cancelled.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

export interface LotPick {
    printingId: string
    count: number
}

export interface LotRow {
    id: string
    price: string
    state: string
}

export async function createLot(
    userId: string,
    setId: string,
    picks: LotPick[],
    price: number,
    note: string | null
): Promise<LotRow> {
    if (!Number.isFinite(price) || price < TCG_MARKET.minPrice || price > TCG_MARKET.maxPrice) {
        badRequest('Price out of range')
    }
    if (note !== null && note.length > TCG_MARKET.noteMaxLength) badRequest('Note too long')
    if (!Array.isArray(picks) || picks.length === 0) badRequest('Empty lot')
    const total = picks.reduce((sum, pick) => sum + pick.count, 0)
    if (picks.some(pick => !Number.isInteger(pick.count) || pick.count < 1)) badRequest('Bad pick count')
    if (total < TCG_MARKET.lotMinCopies || total > TCG_MARKET.lotMaxCopies) {
        badRequest(`A lot holds ${TCG_MARKET.lotMinCopies}–${TCG_MARKET.lotMaxCopies} copies`)
    }

    return await db.transaction(async (tx) => {
        // Select and lock candidate copies per pick, oldest first — "the
        // server picks" is what makes the lot genuinely unsorted. Locking
        // FOR UPDATE serializes against every other copy-state mutation;
        // ordering by id keeps concurrent lot builds deadlock-free.
        const chosen: string[] = []
        for (const pick of picks) {
            const candidates = await tx.select({ id: tcgCopy.id }).from(tcgCopy)
                .where(and(
                    eq(tcgCopy.ownerId, userId),
                    eq(tcgCopy.setId, setId),
                    eq(tcgCopy.printingId, pick.printingId),
                    eq(tcgCopy.lifecycle, 'raw')
                ))
                .orderBy(asc(tcgCopy.id))
                .for('update')
            const free: string[] = []
            for (const candidate of candidates) {
                if (free.length >= pick.count) break
                if (!(await copyEncumbrance(tx, candidate.id))) free.push(candidate.id)
            }
            if (free.length < pick.count) {
                badRequest('Not enough free raw copies for one of the picks')
            }
            chosen.push(...free)
        }

        const [lot] = await tx.insert(tcgLot).values({
            sellerId: userId,
            setId,
            price: price.toFixed(4),
            note
        }).returning()
        await tx.insert(tcgLotItem).values(chosen.map(copyId => ({ lotId: lot!.id, copyId })))
        return lot as LotRow
    })
}

export async function cancelLot(userId: string, lotId: string): Promise<void> {
    const [cancelled] = await db.update(tcgLot)
        .set({ state: 'cancelled' })
        .where(and(eq(tcgLot.id, lotId), eq(tcgLot.sellerId, userId), eq(tcgLot.state, 'active')))
        .returning({ id: tcgLot.id })
    if (!cancelled) badRequest('Lot is not yours to cancel, or already gone')
}

export interface LotPurchase {
    lotId: string
    price: number
    proceeds: number
    copies: number
}

export async function buyLot(userId: string, lotId: string): Promise<LotPurchase> {
    return await db.transaction(async (tx) => {
        // The claim: active → sold, never your own lot.
        const [claimed] = await tx.update(tcgLot)
            .set({ state: 'sold', buyerId: userId, soldAt: new Date() })
            .where(and(
                eq(tcgLot.id, lotId),
                eq(tcgLot.state, 'active'),
                sql`${tcgLot.sellerId} <> ${userId}`
            ))
            .returning()
        if (!claimed) badRequest('Lot is gone, or your own')

        const items = await tx.select({ copyId: tcgLotItem.copyId }).from(tcgLotItem)
            .where(eq(tcgLotItem.lotId, lotId))
        const copyIds = items.map(item => item.copyId).sort()
        // Lock every copy (sorted → deadlock-free) and verify the lot is
        // intact: still the seller's, still raw. Anything else is a bug —
        // encumbrance should have frozen them — so refuse loudly.
        const copies = await tx.select({ id: tcgCopy.id, ownerId: tcgCopy.ownerId, lifecycle: tcgCopy.lifecycle })
            .from(tcgCopy)
            .where(inArray(tcgCopy.id, copyIds))
            .orderBy(asc(tcgCopy.id))
            .for('update')
        if (copies.length !== copyIds.length
            || copies.some(copy => copy.ownerId !== claimed!.sellerId || copy.lifecycle !== 'raw')) {
            throw createError({ statusCode: 500, statusMessage: 'Lot out of sync with its copies' })
        }

        const price = parseFloat(claimed!.price)
        const proceeds = sellerProceeds(price)
        await debit(userId, price.toFixed(4), 'tcg:market', tx)
        await credit(claimed!.sellerId, proceeds.toFixed(4), 'tcg:market', tx)

        await tx.update(tcgCopy).set({ ownerId: userId }).where(inArray(tcgCopy.id, copyIds))
        await tx.insert(tcgCopyTransfer).values(copyIds.map(copyId => ({
            copyId,
            fromUserId: claimed!.sellerId,
            toUserId: userId,
            kind: 'sale' as const,
            price: null
        })))

        return { lotId, price, proceeds, copies: copyIds.length }
    })
}

export interface LotSummary {
    id: string
    sellerId: string
    sellerName: string
    price: number
    note: string | null
    copies: number
    createdAt: string
}

export async function lotsFor(setId: string): Promise<LotSummary[]> {
    const rows = await db.select({
        id: tcgLot.id,
        sellerId: tcgLot.sellerId,
        sellerName: user.name,
        price: tcgLot.price,
        note: tcgLot.note,
        createdAt: tcgLot.createdAt,
        copies: sql<number>`(select count(*) from tcg_lot_items where lot_id = ${tcgLot.id})::int`
    })
        .from(tcgLot)
        .innerJoin(user, eq(tcgLot.sellerId, user.id))
        .where(and(eq(tcgLot.setId, setId), eq(tcgLot.state, 'active')))
        .orderBy(desc(tcgLot.createdAt))
        .limit(100)
    return rows.map(row => ({
        ...row,
        price: parseFloat(row.price),
        createdAt: row.createdAt.toISOString()
    }))
}

/** The caller's sellable raw counts per printing, for the lot builder. */
export async function rawCountsFor(userId: string, setId: string) {
    return await db.select({
        printingId: tcgCopy.printingId,
        cardName: tcgCard.name,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        count: sql<number>`count(*)::int`
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            eq(tcgCopy.setId, setId),
            eq(tcgCopy.lifecycle, 'raw'),
            // Copies already held by a listing, lot or auction can't be
            // lotted — the count shown should be what createLot can take.
            sql`not exists (select 1 from tcg_listings l where l.copy_id = ${tcgCopy.id} and l.state = 'active')`,
            sql`not exists (select 1 from tcg_lot_items li join tcg_lots lo on lo.id = li.lot_id
                where li.copy_id = ${tcgCopy.id} and lo.state = 'active')`,
            sql`not exists (select 1 from tcg_auctions a where a.copy_id = ${tcgCopy.id} and a.state = 'active')`
        ))
        .groupBy(tcgCopy.printingId, tcgCard.name, tcgPrinting.finish, tcgPrinting.pattern)
        .orderBy(tcgCard.name)
}
