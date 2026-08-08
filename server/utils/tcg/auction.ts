import { and, desc, eq, lte, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgAuction, tcgAuctionBid, tcgCopy, tcgCopyTransfer, tcgListing, tcgPack, tcgPrinting, tcgCard, user } from '#server/database/schema'
import { credit, debit } from '#server/utils/balance'
import { lockCopyForUpdate, assertUnencumbered } from '#server/utils/tcg/market'
import { TCG_MARKET, sellerProceeds, minNextBid } from '#shared/utils/tcg/market'

/*
 * Auctions (§7.1): high-value singles and sealed product. Only the standing
 * top bid is ever escrowed — a displaced bidder is refunded in the same
 * transaction that replaces them, so at any moment exactly one bidder's
 * coins are held. Settlement is lazy (grading's returnsAt pattern): a
 * conditional claim gated on endsAt, run from reads and from bids that
 * arrive after the end. An active auction encumbers its item.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface AuctionRow {
    id: string
    kind: string
    state: string
    endsAt: Date
}

export async function createAuction(
    userId: string,
    item: { kind: 'copy', copyId: string } | { kind: 'pack', packId: string },
    startPrice: number,
    durationMs: number
): Promise<AuctionRow> {
    if (!Number.isFinite(startPrice) || startPrice < TCG_MARKET.minPrice || startPrice > TCG_MARKET.maxPrice) {
        badRequest('Start price out of range')
    }
    if (!(TCG_MARKET.auctionDurationsMs as readonly number[]).includes(durationMs)) {
        badRequest('Invalid duration')
    }
    const endsAt = new Date(Date.now() + durationMs)

    return await db.transaction(async (tx) => {
        if (item.kind === 'copy') {
            const copy = await lockCopyForUpdate(tx, item.copyId)
            if (!copy || copy.ownerId !== userId) badRequest('Copy is not yours to auction')
            if (copy!.lifecycle !== 'raw' && copy!.lifecycle !== 'slabbed') {
                badRequest('Copy is not available for auction')
            }
            await assertUnencumbered(tx, item.copyId)
            const [row] = await tx.insert(tcgAuction).values({
                sellerId: userId,
                kind: 'copy',
                copyId: item.copyId,
                startPrice: startPrice.toFixed(4),
                endsAt
            }).returning()
            return row as AuctionRow
        }

        const [pack] = await tx.select().from(tcgPack)
            .where(eq(tcgPack.id, item.packId))
            .for('update')
        if (!pack || pack.ownerId !== userId) badRequest('Pack is not yours to auction')
        if (pack!.state !== 'sealed') badRequest('Only sealed packs can be auctioned')
        const [held] = await tx.select({ id: tcgAuction.id }).from(tcgAuction)
            .where(and(eq(tcgAuction.packId, item.packId), eq(tcgAuction.state, 'active')))
        if (held) badRequest('Pack is already at auction')
        const [row] = await tx.insert(tcgAuction).values({
            sellerId: userId,
            kind: 'pack',
            packId: item.packId,
            startPrice: startPrice.toFixed(4),
            endsAt
        }).returning()
        return row as AuctionRow
    })
}

/**
 * Settle one due auction inside an existing transaction. Idempotent: the
 * claim is the state flip, and a burst settles exactly once.
 */
async function settleIn(tx: Tx, auctionId: string): Promise<boolean> {
    const [claimed] = await tx.update(tcgAuction)
        .set({ state: 'settled', settledAt: new Date() })
        .where(and(
            eq(tcgAuction.id, auctionId),
            eq(tcgAuction.state, 'active'),
            lte(tcgAuction.endsAt, new Date())
        ))
        .returning()
    if (!claimed) return false

    if (!claimed.currentBidderId || !claimed.currentBid) return true // bidless: item released

    const price = parseFloat(claimed.currentBid)
    // The winner's coins are already escrowed; the seller gets 95%, the 5%
    // burns — same split as every other coin leg on this market.
    await credit(claimed.sellerId, sellerProceeds(price).toFixed(4), 'tcg:market', tx)

    if (claimed.kind === 'copy' && claimed.copyId) {
        const copy = await lockCopyForUpdate(tx, claimed.copyId)
        if (!copy || copy.ownerId !== claimed.sellerId) {
            throw createError({ statusCode: 500, statusMessage: 'Auction out of sync with copy' })
        }
        await tx.update(tcgCopy).set({ ownerId: claimed.currentBidderId }).where(eq(tcgCopy.id, claimed.copyId))
        await tx.insert(tcgCopyTransfer).values({
            copyId: claimed.copyId,
            fromUserId: claimed.sellerId,
            toUserId: claimed.currentBidderId,
            kind: 'sale',
            price: claimed.currentBid
        })
        // Synthetic sold listing: the hammer price joins the sales history.
        await tx.insert(tcgListing).values({
            copyId: claimed.copyId,
            sellerId: claimed.sellerId,
            buyerId: claimed.currentBidderId,
            price: claimed.currentBid,
            state: 'sold',
            soldAt: new Date(),
            soldGradeService: copy!.gradeService,
            soldGrade: copy!.grade,
            soldDesignation: copy!.gradeDesignation
        })
    } else if (claimed.kind === 'pack' && claimed.packId) {
        const [moved] = await tx.update(tcgPack)
            .set({ ownerId: claimed.currentBidderId })
            .where(and(
                eq(tcgPack.id, claimed.packId),
                eq(tcgPack.ownerId, claimed.sellerId),
                eq(tcgPack.state, 'sealed')
            ))
            .returning({ id: tcgPack.id })
        if (!moved) throw createError({ statusCode: 500, statusMessage: 'Auction out of sync with pack' })
    }
    return true
}

/** Settle every due auction — called from list reads. */
export async function settleDueAuctions(): Promise<void> {
    const due = await db.select({ id: tcgAuction.id }).from(tcgAuction)
        .where(and(eq(tcgAuction.state, 'active'), lte(tcgAuction.endsAt, new Date())))
    for (const auction of due) {
        await db.transaction(tx => settleIn(tx, auction.id).then(() => {}))
    }
}

export async function bid(userId: string, auctionId: string, amount: number): Promise<{ amount: number }> {
    if (!Number.isFinite(amount) || amount < TCG_MARKET.minPrice || amount > TCG_MARKET.maxPrice) {
        badRequest('Bid out of range')
    }
    return await db.transaction(async (tx) => {
        // Lock the auction row: bids, outbids and settlement serialize here.
        const [auction] = await tx.select().from(tcgAuction)
            .where(eq(tcgAuction.id, auctionId))
            .for('update')
        if (!auction) throw createError({ statusCode: 404, statusMessage: 'Auction not found' })
        if (auction.state !== 'active') badRequest('Auction is over')
        // A late bid must not settle here: this transaction is about to be
        // rolled back by the rejection. Callers settle due auctions first
        // (the bid endpoint and every list read do).
        if (auction.endsAt.getTime() <= Date.now()) badRequest('Auction has ended')
        if (auction.sellerId === userId) badRequest('You cannot bid on your own auction')

        const current = auction.currentBid ? parseFloat(auction.currentBid) : null
        const minimum = minNextBid(parseFloat(auction.startPrice), current)
        if (amount < minimum) badRequest(`Bid at least ${minimum}`)

        // Escrow the new top bid, then release the displaced one — at every
        // instant exactly one bidder's coins are held.
        await debit(userId, amount.toFixed(4), 'tcg:market', tx)
        if (auction.currentBidderId && auction.currentBid) {
            await credit(auction.currentBidderId, auction.currentBid, 'tcg:market', tx)
        }

        await tx.update(tcgAuction)
            .set({ currentBid: amount.toFixed(4), currentBidderId: userId })
            .where(eq(tcgAuction.id, auctionId))
        await tx.insert(tcgAuctionBid).values({
            auctionId,
            bidderId: userId,
            amount: amount.toFixed(4)
        })
        return { amount }
    })
}

export async function cancelAuction(userId: string, auctionId: string): Promise<void> {
    const [cancelled] = await db.update(tcgAuction)
        .set({ state: 'cancelled' })
        .where(and(
            eq(tcgAuction.id, auctionId),
            eq(tcgAuction.sellerId, userId),
            eq(tcgAuction.state, 'active'),
            sql`${tcgAuction.currentBidderId} is null`
        ))
        .returning({ id: tcgAuction.id })
    if (!cancelled) badRequest('Auction has bids, is not yours, or is already gone')
}

export interface AuctionSummary {
    id: string
    kind: string
    sellerId: string
    sellerName: string
    startPrice: number
    currentBid: number | null
    currentBidderId: string | null
    endsAt: string
    copyId: string | null
    packId: string | null
    bids: number
    /** Copy auctions: what the lot IS, for the tile. */
    cardName: string | null
    bundle: string | null
    assetNumber: string | null
    plaatjesCardId: string | null
    gradeService: string | null
    grade: string | null
}

export async function auctionsFor(setId: string): Promise<AuctionSummary[]> {
    await settleDueAuctions()
    const rows = await db.select({
        id: tcgAuction.id,
        kind: tcgAuction.kind,
        sellerId: tcgAuction.sellerId,
        sellerName: user.name,
        startPrice: tcgAuction.startPrice,
        currentBid: tcgAuction.currentBid,
        currentBidderId: tcgAuction.currentBidderId,
        endsAt: tcgAuction.endsAt,
        copyId: tcgAuction.copyId,
        packId: tcgAuction.packId,
        copySetId: tcgCopy.setId,
        packSetId: tcgPack.setId,
        cardName: tcgCard.name,
        bundle: tcgPrinting.bundle,
        assetNumber: tcgPrinting.assetNumber,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        bids: sql<number>`(select count(*) from tcg_auction_bids where auction_id = ${tcgAuction.id})::int`
    })
        .from(tcgAuction)
        .innerJoin(user, eq(tcgAuction.sellerId, user.id))
        .leftJoin(tcgCopy, eq(tcgAuction.copyId, tcgCopy.id))
        .leftJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .leftJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .leftJoin(tcgPack, eq(tcgAuction.packId, tcgPack.id))
        .where(eq(tcgAuction.state, 'active'))
        .orderBy(desc(tcgAuction.createdAt))
        .limit(100)
    return rows
        .filter(row => (row.copySetId ?? row.packSetId) === setId)
        .map(row => ({
            id: row.id,
            kind: row.kind,
            sellerId: row.sellerId,
            sellerName: row.sellerName,
            startPrice: parseFloat(row.startPrice),
            currentBid: row.currentBid !== null ? parseFloat(row.currentBid) : null,
            currentBidderId: row.currentBidderId,
            endsAt: row.endsAt.toISOString(),
            copyId: row.copyId,
            packId: row.packId,
            bids: row.bids,
            cardName: row.cardName,
            bundle: row.bundle,
            assetNumber: row.assetNumber,
            plaatjesCardId: row.plaatjesCardId,
            gradeService: row.gradeService,
            grade: row.grade
        }))
}
