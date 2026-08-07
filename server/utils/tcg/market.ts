import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '#server/database'
import {
    tcgListing, tcgCopyTransfer, tcgCopy, tcgPrinting, tcgCard, tcgSet, tcgSheet, tcgPack, user
} from '#server/database/schema'
import { credit, debit } from '#server/utils/balance'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'
import type { TcgListingSummary, TcgSaleRow, TcgChainEntry } from '#shared/types/tcg'

/*
 * The marketplace (§7.1): fixed-price listings in Coins, 5% burned fee.
 *
 * Concurrency: every copy-state mutation across market AND grading first
 * takes SELECT … FOR UPDATE on the copy row (CLAUDE.md pattern B), then
 * checks, then acts — this serializes listing against grading/cracking.
 * The partial unique index (one active listing per copy) is the backstop.
 *
 * All trades are atomic: debit, credit, ownership flip, snapshot and the
 * transfer row commit together or not at all. No partial states, ever.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The unified copy-state guard: lock the row, everyone queues behind it. */
export async function lockCopyForUpdate(tx: Tx, copyId: string) {
    const [copy] = await tx.select().from(tcgCopy)
        .where(eq(tcgCopy.id, copyId))
        .for('update')
    return copy ?? null
}

export async function hasActiveListing(tx: Tx, copyId: string): Promise<boolean> {
    const [row] = await tx.select({ id: tcgListing.id }).from(tcgListing)
        .where(and(eq(tcgListing.copyId, copyId), eq(tcgListing.state, 'active')))
    return !!row
}

export interface ListingRow {
    id: string
    copyId: string
    price: string
    state: string
}

export async function listCopy(userId: string, copyId: string, price: number, note: string | null): Promise<ListingRow> {
    if (!Number.isFinite(price) || price < TCG_MARKET.minPrice || price > TCG_MARKET.maxPrice) {
        badRequest('Price out of range')
    }
    if (note !== null && note.length > TCG_MARKET.noteMaxLength) {
        badRequest('Note too long')
    }
    return await db.transaction(async (tx) => {
        const copy = await lockCopyForUpdate(tx, copyId)
        if (!copy || copy.ownerId !== userId) badRequest('Copy is not yours to list')
        if (copy!.lifecycle !== 'raw' && copy!.lifecycle !== 'slabbed') {
            badRequest('Copy is not available for listing')
        }
        if (await hasActiveListing(tx, copyId)) badRequest('Copy is already listed')

        const [row] = await tx.insert(tcgListing).values({
            copyId,
            sellerId: userId,
            price: price.toFixed(4),
            note
        }).returning()
        return row as ListingRow
    })
}

export async function cancelListing(userId: string, listingId: string): Promise<void> {
    const [cancelled] = await db.update(tcgListing)
        .set({ state: 'cancelled' })
        .where(and(
            eq(tcgListing.id, listingId),
            eq(tcgListing.sellerId, userId),
            eq(tcgListing.state, 'active')
        ))
        .returning({ id: tcgListing.id })
    if (!cancelled) badRequest('Listing is not yours to cancel, or already gone')
}

export interface PurchaseResult {
    listingId: string
    copyId: string
    price: number
    proceeds: number
}

export async function buyListing(userId: string, listingId: string): Promise<PurchaseResult> {
    return await db.transaction(async (tx) => {
        // The claim: active → sold. A burst of buyers resolves to one winner.
        // Buying your own listing is refused — cheap wash-trade friction.
        const [claimed] = await tx.update(tcgListing)
            .set({ state: 'sold', buyerId: userId, soldAt: new Date() })
            .where(and(
                eq(tcgListing.id, listingId),
                eq(tcgListing.state, 'active'),
                sql`${tcgListing.sellerId} <> ${userId}`
            ))
            .returning()
        if (!claimed) badRequest('Listing is gone, or your own')

        const copy = await lockCopyForUpdate(tx, claimed!.copyId)
        if (!copy || copy.ownerId !== claimed!.sellerId) {
            // Should be impossible with the lock discipline; refuse loudly
            // rather than move a card the seller no longer owns.
            throw createError({ statusCode: 500, statusMessage: 'Listing out of sync with copy' })
        }

        const price = parseFloat(claimed!.price)
        const proceeds = sellerProceeds(price)
        // The 5% difference is BURNED: debited from the buyer, never credited
        // to anyone (§7.6). Never accumulateRake — the host's rakeback would
        // leak a fifth of the sink back out.
        await debit(userId, price.toFixed(4), 'tcg:market', tx)
        await credit(claimed!.sellerId, proceeds.toFixed(4), 'tcg:market', tx)

        // Snapshot the grade as sold: the copy can be cracked later and the
        // sales history must not mutate under it.
        await tx.update(tcgListing)
            .set({
                soldGradeService: copy!.gradeService,
                soldGrade: copy!.grade,
                soldDesignation: copy!.gradeDesignation
            })
            .where(eq(tcgListing.id, listingId))

        await tx.update(tcgCopy)
            .set({ ownerId: userId })
            .where(eq(tcgCopy.id, copy!.id))

        await tx.insert(tcgCopyTransfer).values({
            copyId: copy!.id,
            fromUserId: claimed!.sellerId,
            toUserId: userId,
            kind: 'sale',
            price: claimed!.price
        })

        return { listingId, copyId: copy!.id, price, proceeds }
    })
}

export async function listingsFor(setId: string): Promise<TcgListingSummary[]> {
    const rows = await db.select({
        id: tcgListing.id,
        copyId: tcgListing.copyId,
        price: tcgListing.price,
        note: tcgListing.note,
        sellerId: tcgListing.sellerId,
        sellerName: user.name,
        createdAt: tcgListing.createdAt,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        printingId: tcgCopy.printingId,
        cardName: tcgCard.name,
        rarity: tcgCard.rarity,
        number: tcgCard.number,
        setTotal: tcgCard.setTotal,
        setName: tcgSet.name,
        setCode: tcgSet.code,
        releaseDate: tcgSet.releaseDate,
        bundle: tcgPrinting.bundle,
        assetNumber: tcgPrinting.assetNumber,
        maskKind: tcgPrinting.maskKind,
        foilEffect: tcgPrinting.foilEffect,
        pattern: tcgPrinting.pattern,
        finish: tcgPrinting.finish,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        printRunLabel: tcgPrinting.printRunLabel,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        gradeScore: tcgCopy.gradeScore,
        gradeDesignation: tcgCopy.gradeDesignation,
        gradeSubs: tcgCopy.gradeSubs,
        gradeFlaws: tcgCopy.gradeFlaws,
        certNumber: tcgCopy.certNumber,
        gradedAt: tcgCopy.gradedAt
    })
        .from(tcgListing)
        .innerJoin(tcgCopy, eq(tcgListing.copyId, tcgCopy.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .innerJoin(user, eq(tcgListing.sellerId, user.id))
        .where(and(eq(tcgListing.state, 'active'), eq(tcgCopy.setId, setId)))
        .orderBy(desc(tcgListing.createdAt))
        .limit(200)

    return rows.map(row => ({
        id: row.id,
        copyId: row.copyId,
        price: parseFloat(row.price),
        note: row.note,
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        createdAt: row.createdAt.toISOString(),
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        printingId: row.printingId,
        card: {
            name: row.cardName,
            rarity: row.rarity,
            number: row.number,
            setTotal: row.setTotal,
            setName: row.setName,
            setCode: row.setCode,
            releaseDate: row.releaseDate
        },
        render: {
            bundle: row.bundle,
            assetNumber: row.assetNumber,
            maskKind: row.maskKind,
            foilEffect: row.foilEffect,
            pattern: row.pattern,
            finish: row.finish,
            plaatjesCardId: row.plaatjesCardId,
            printRunLabel: row.printRunLabel
        },
        grade: row.grade && row.gradeService && row.certNumber && row.gradedAt
            ? {
                    service: row.gradeService,
                    grade: row.grade,
                    score: row.gradeScore,
                    designation: row.gradeDesignation,
                    subGrades: row.gradeSubs,
                    flaws: row.gradeFlaws,
                    certNumber: row.certNumber,
                    gradedAt: row.gradedAt.toISOString()
                }
            : null
    }))
}

/**
 * Sales history for one printing (§7.2): the honest display for a thin
 * market is the raw sale list. Slab rows carry the grade snapshot; raw rows
 * are "condition unknown" — no index, no smoothing.
 */
export async function salesHistory(printingId: string): Promise<TcgSaleRow[]> {
    const buyerUser = alias(user, 'buyer_user')
    const rows = await db.select({
        price: tcgListing.price,
        soldAt: tcgListing.soldAt,
        gradeService: tcgListing.soldGradeService,
        grade: tcgListing.soldGrade,
        designation: tcgListing.soldDesignation,
        sellerName: user.name,
        buyerName: buyerUser.name
    })
        .from(tcgListing)
        .innerJoin(tcgCopy, eq(tcgListing.copyId, tcgCopy.id))
        .innerJoin(user, eq(tcgListing.sellerId, user.id))
        .innerJoin(buyerUser, eq(buyerUser.id, tcgListing.buyerId))
        .where(and(eq(tcgListing.state, 'sold'), eq(tcgCopy.printingId, printingId)))
        .orderBy(desc(tcgListing.soldAt))
        .limit(50)

    return rows.map(row => ({
        price: parseFloat(row.price),
        soldAt: row.soldAt!.toISOString(),
        gradeService: row.gradeService,
        grade: row.grade,
        designation: row.designation,
        sellerName: row.sellerName,
        buyerName: row.buyerName
    }))
}

/**
 * The ownership chain (§11.3): a synthesized mint entry (from the pack the
 * copy was pulled from) followed by every recorded transfer. Public.
 */
export async function ownershipChain(copyId: string): Promise<TcgChainEntry[]> {
    const [copy] = await db.select({
        packOwner: user.name,
        openedAt: tcgPack.openedAt,
        packCreatedAt: tcgPack.createdAt,
        copyCreatedAt: tcgCopy.createdAt
    })
        .from(tcgCopy)
        .innerJoin(tcgPack, eq(tcgCopy.packId, tcgPack.id))
        .innerJoin(user, eq(tcgPack.ownerId, user.id))
        .where(eq(tcgCopy.id, copyId))
    if (!copy) throw createError({ statusCode: 404, statusMessage: 'Copy not found' })

    const transfers = await db.select({
        toName: user.name,
        price: tcgCopyTransfer.price,
        createdAt: tcgCopyTransfer.createdAt
    })
        .from(tcgCopyTransfer)
        .innerJoin(user, eq(tcgCopyTransfer.toUserId, user.id))
        .where(eq(tcgCopyTransfer.copyId, copyId))
        .orderBy(asc(tcgCopyTransfer.createdAt))

    return [
        {
            kind: 'mint' as const,
            userName: copy.packOwner,
            price: null,
            at: (copy.openedAt ?? copy.copyCreatedAt).toISOString()
        },
        ...transfers.map(t => ({
            kind: 'sale' as const,
            userName: t.toName,
            price: t.price ? parseFloat(t.price) : null,
            at: t.createdAt.toISOString()
        }))
    ]
}
