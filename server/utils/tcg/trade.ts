import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgTradeOffer, tcgTradeItem, tcgCopy, tcgCopyTransfer, tcgPrinting, tcgCard, tcgSheet, user } from '#server/database/schema'
import { credit, debit } from '#server/utils/balance'
import { copyEncumbrance } from '#server/utils/tcg/market'
import { TCG_MARKET, sellerProceeds } from '#shared/utils/tcg/market'

/*
 * Direct trades (§7.1): card-for-card ± Coins, directed at a chosen
 * counterparty — kept deliberately, anonymity not attempted. Offers escrow
 * NOTHING: both collections stay fully usable while an offer sits, and
 * everything (ownership, lifecycle, encumbrance, the coin leg) is validated
 * atomically when the receiver accepts. An item that moved in the meantime
 * simply fails the accept and the offer stays open for a retry or decline.
 *
 * The 5% burn taxes the coin leg only: the payer pays in full, the payee
 * receives 95%. Pure card-for-card swaps carry no fee — they move no Coins.
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

export interface TradeOfferInput {
    toUserId: string
    senderCopyIds: string[]
    receiverCopyIds: string[]
    senderCoins: number
    receiverCoins: number
    note: string | null
}

export interface TradeOfferRow {
    id: string
    state: string
}

export async function createOffer(userId: string, input: TradeOfferInput): Promise<TradeOfferRow> {
    const { toUserId, senderCopyIds, receiverCopyIds, senderCoins, receiverCoins, note } = input
    if (!toUserId || toUserId === userId) badRequest('Pick another player to trade with')
    if (note !== null && note.length > TCG_MARKET.noteMaxLength) badRequest('Note too long')
    if (!Number.isFinite(senderCoins) || !Number.isFinite(receiverCoins)
        || senderCoins < 0 || receiverCoins < 0
        || senderCoins > TCG_MARKET.maxPrice || receiverCoins > TCG_MARKET.maxPrice) {
        badRequest('Coin amount out of range')
    }
    if (senderCoins > 0 && receiverCoins > 0) badRequest('Coins go one way in a trade')
    if (senderCopyIds.length === 0 && receiverCopyIds.length === 0) badRequest('An empty trade is not a trade')
    if (senderCopyIds.length > TCG_MARKET.tradeMaxItemsPerSide
        || receiverCopyIds.length > TCG_MARKET.tradeMaxItemsPerSide) {
        badRequest(`At most ${TCG_MARKET.tradeMaxItemsPerSide} cards per side`)
    }
    const allIds = [...senderCopyIds, ...receiverCopyIds]
    if (new Set(allIds).size !== allIds.length) badRequest('Duplicate cards in the offer')

    return await db.transaction(async (tx) => {
        const [receiver] = await tx.select({ id: user.id }).from(user).where(eq(user.id, toUserId))
        if (!receiver) badRequest('No such player')

        const [counted] = await tx.select({ open: sql<number>`count(*)::int` }).from(tcgTradeOffer)
            .where(and(eq(tcgTradeOffer.fromUserId, userId), eq(tcgTradeOffer.state, 'open')))
        if ((counted?.open ?? 0) >= TCG_MARKET.tradeMaxOpenOffers) badRequest('Too many open offers')

        // Creation-time sanity: right owners, tradeable lifecycles. This can
        // all change before accept — accept re-validates under locks.
        const copies = allIds.length
            ? await tx.select({ id: tcgCopy.id, ownerId: tcgCopy.ownerId, lifecycle: tcgCopy.lifecycle })
                .from(tcgCopy).where(inArray(tcgCopy.id, allIds))
            : []
        const byId = new Map(copies.map(copy => [copy.id, copy]))
        for (const copyId of senderCopyIds) {
            const copy = byId.get(copyId)
            if (!copy || copy.ownerId !== userId) badRequest('You can only offer your own cards')
            if (copy!.lifecycle !== 'raw' && copy!.lifecycle !== 'slabbed') badRequest('Card is not tradeable')
        }
        for (const copyId of receiverCopyIds) {
            const copy = byId.get(copyId)
            if (!copy || copy.ownerId !== toUserId) badRequest('You can only ask for their own cards')
            if (copy!.lifecycle !== 'raw' && copy!.lifecycle !== 'slabbed') badRequest('Card is not tradeable')
        }

        const [offer] = await tx.insert(tcgTradeOffer).values({
            fromUserId: userId,
            toUserId,
            senderCoins: senderCoins.toFixed(4),
            receiverCoins: receiverCoins.toFixed(4),
            note
        }).returning()
        if (allIds.length) {
            await tx.insert(tcgTradeItem).values([
                ...senderCopyIds.map(copyId => ({ offerId: offer!.id, copyId, side: 'sender' as const })),
                ...receiverCopyIds.map(copyId => ({ offerId: offer!.id, copyId, side: 'receiver' as const }))
            ])
        }
        return offer as TradeOfferRow
    })
}

export async function cancelOffer(userId: string, offerId: string): Promise<void> {
    const [cancelled] = await db.update(tcgTradeOffer)
        .set({ state: 'cancelled', resolvedAt: new Date() })
        .where(and(
            eq(tcgTradeOffer.id, offerId),
            eq(tcgTradeOffer.fromUserId, userId),
            eq(tcgTradeOffer.state, 'open')
        ))
        .returning({ id: tcgTradeOffer.id })
    if (!cancelled) badRequest('Offer is not yours to cancel, or already gone')
}

export async function declineOffer(userId: string, offerId: string): Promise<void> {
    const [declined] = await db.update(tcgTradeOffer)
        .set({ state: 'declined', resolvedAt: new Date() })
        .where(and(
            eq(tcgTradeOffer.id, offerId),
            eq(tcgTradeOffer.toUserId, userId),
            eq(tcgTradeOffer.state, 'open')
        ))
        .returning({ id: tcgTradeOffer.id })
    if (!declined) badRequest('Offer is not yours to decline, or already gone')
}

export async function acceptOffer(userId: string, offerId: string): Promise<void> {
    await db.transaction(async (tx) => {
        // The claim: open → accepted, receiver only. A concurrent cancel or
        // second accept loses here.
        const [claimed] = await tx.update(tcgTradeOffer)
            .set({ state: 'accepted', resolvedAt: new Date() })
            .where(and(
                eq(tcgTradeOffer.id, offerId),
                eq(tcgTradeOffer.toUserId, userId),
                eq(tcgTradeOffer.state, 'open')
            ))
            .returning()
        if (!claimed) badRequest('Offer is gone')

        const items = await tx.select().from(tcgTradeItem).where(eq(tcgTradeItem.offerId, offerId))
        const copyIds = items.map(item => item.copyId).sort()

        // Lock every copy in id order (deadlock-free against every other
        // multi-copy flow) and re-validate the whole offer. A single failure
        // rolls back the accepted claim — the offer stays open.
        const copies = copyIds.length
            ? await tx.select().from(tcgCopy)
                .where(inArray(tcgCopy.id, copyIds))
                .orderBy(asc(tcgCopy.id))
                .for('update')
            : []
        const byId = new Map(copies.map(copy => [copy.id, copy]))
        for (const item of items) {
            const copy = byId.get(item.copyId)
            const owner = item.side === 'sender' ? claimed!.fromUserId : claimed!.toUserId
            if (!copy || copy.ownerId !== owner) badRequest('A card in this trade has changed hands')
            if (copy!.lifecycle !== 'raw' && copy!.lifecycle !== 'slabbed') {
                badRequest('A card in this trade is no longer tradeable')
            }
            if (await copyEncumbrance(tx, item.copyId)) {
                badRequest('A card in this trade is held by a listing, lot, auction or battler run')
            }
        }

        // The coin leg: payer pays in full, payee receives 95% — the burn
        // taxes the sweetener, never the cards.
        const senderCoins = parseFloat(claimed!.senderCoins)
        const receiverCoins = parseFloat(claimed!.receiverCoins)
        if (senderCoins > 0) {
            await debit(claimed!.fromUserId, senderCoins.toFixed(4), 'tcg:market', tx)
            await credit(claimed!.toUserId, sellerProceeds(senderCoins).toFixed(4), 'tcg:market', tx)
        } else if (receiverCoins > 0) {
            await debit(claimed!.toUserId, receiverCoins.toFixed(4), 'tcg:market', tx)
            await credit(claimed!.fromUserId, sellerProceeds(receiverCoins).toFixed(4), 'tcg:market', tx)
        }

        for (const item of items) {
            const newOwner = item.side === 'sender' ? claimed!.toUserId : claimed!.fromUserId
            const oldOwner = item.side === 'sender' ? claimed!.fromUserId : claimed!.toUserId
            await tx.update(tcgCopy).set({ ownerId: newOwner }).where(eq(tcgCopy.id, item.copyId))
            await tx.insert(tcgCopyTransfer).values({
                copyId: item.copyId,
                fromUserId: oldOwner,
                toUserId: newOwner,
                kind: 'trade',
                price: null
            })
        }
    })
}

export interface TradeItemView {
    copyId: string
    side: string
    cardName: string
    serial: string
    bundle: string | null
    assetNumber: string | null
    plaatjesCardId: string
    gradeService: string | null
    grade: string | null
}

export interface TradeOfferView {
    id: string
    fromUserId: string
    fromName: string
    toUserId: string
    toName: string
    senderCoins: number
    receiverCoins: number
    note: string | null
    state: string
    createdAt: string
    items: TradeItemView[]
}

/** All open offers involving the caller, items included. */
export async function offersFor(userId: string): Promise<TradeOfferView[]> {
    const fromUser = user
    const offers = await db.select({
        id: tcgTradeOffer.id,
        fromUserId: tcgTradeOffer.fromUserId,
        toUserId: tcgTradeOffer.toUserId,
        senderCoins: tcgTradeOffer.senderCoins,
        receiverCoins: tcgTradeOffer.receiverCoins,
        note: tcgTradeOffer.note,
        state: tcgTradeOffer.state,
        createdAt: tcgTradeOffer.createdAt
    })
        .from(tcgTradeOffer)
        .where(and(
            eq(tcgTradeOffer.state, 'open'),
            or(eq(tcgTradeOffer.fromUserId, userId), eq(tcgTradeOffer.toUserId, userId))
        ))
        .orderBy(desc(tcgTradeOffer.createdAt))
        .limit(100)
    if (offers.length === 0) return []

    const names = await db.select({ id: fromUser.id, name: fromUser.name }).from(fromUser)
        .where(inArray(fromUser.id, [...new Set(offers.flatMap(offer => [offer.fromUserId, offer.toUserId]))]))
    const nameById = new Map(names.map(row => [row.id, row.name]))

    const items = await db.select({
        offerId: tcgTradeItem.offerId,
        copyId: tcgTradeItem.copyId,
        side: tcgTradeItem.side,
        cardName: tcgCard.name,
        bundle: tcgPrinting.bundle,
        assetNumber: tcgPrinting.assetNumber,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset
    })
        .from(tcgTradeItem)
        .innerJoin(tcgCopy, eq(tcgTradeItem.copyId, tcgCopy.id))
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .where(inArray(tcgTradeItem.offerId, offers.map(offer => offer.id)))

    const itemsByOffer = new Map<string, TradeItemView[]>()
    for (const item of items) {
        const list = itemsByOffer.get(item.offerId) ?? []
        list.push({
            copyId: item.copyId,
            side: item.side,
            cardName: item.cardName,
            serial: `${item.sheetName} #${item.cutIndex * item.packSlots + item.slotOffset + 1}`,
            bundle: item.bundle,
            assetNumber: item.assetNumber,
            plaatjesCardId: item.plaatjesCardId,
            gradeService: item.gradeService,
            grade: item.grade
        })
        itemsByOffer.set(item.offerId, list)
    }

    return offers.map(offer => ({
        id: offer.id,
        fromUserId: offer.fromUserId,
        fromName: nameById.get(offer.fromUserId) ?? '?',
        toUserId: offer.toUserId,
        toName: nameById.get(offer.toUserId) ?? '?',
        senderCoins: parseFloat(offer.senderCoins),
        receiverCoins: parseFloat(offer.receiverCoins),
        note: offer.note,
        state: offer.state,
        createdAt: offer.createdAt.toISOString(),
        items: itemsByOffer.get(offer.id) ?? []
    }))
}

export interface CounterpartCopy {
    copyId: string
    printingId: string
    cardName: string
    serial: string
    finish: string
    pattern: string | null
    gradeService: string | null
    grade: string | null
}

/**
 * A counterpart's tradeable copies in one set — printings, serials and
 * public grades only. Condition never leaves the server (§6.1); a raw
 * card here is exactly as unknowable as it is on the market.
 */
export async function tradeableCopiesOf(ownerId: string, setId: string): Promise<CounterpartCopy[]> {
    const rows = await db.select({
        copyId: tcgCopy.id,
        printingId: tcgCopy.printingId,
        cardName: tcgCard.name,
        finish: tcgPrinting.finish,
        pattern: tcgPrinting.pattern,
        gradeService: tcgCopy.gradeService,
        grade: tcgCopy.grade,
        sheetName: tcgSheet.name,
        packSlots: tcgSheet.packSlots,
        cutIndex: tcgCopy.cutIndex,
        slotOffset: tcgCopy.slotOffset
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSheet, eq(tcgCopy.sheetId, tcgSheet.id))
        .where(and(
            eq(tcgCopy.ownerId, ownerId),
            eq(tcgCopy.setId, setId),
            inArray(tcgCopy.lifecycle, ['raw', 'slabbed'])
        ))
        .orderBy(tcgCard.name)
        .limit(500)
    return rows.map(row => ({
        copyId: row.copyId,
        printingId: row.printingId,
        cardName: row.cardName,
        serial: `${row.sheetName} #${row.cutIndex * row.packSlots + row.slotOffset + 1}`,
        finish: row.finish,
        pattern: row.pattern,
        gradeService: row.gradeService,
        grade: row.grade
    }))
}
