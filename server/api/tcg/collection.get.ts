import { and, asc, count, eq, ne } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgCopy } from '#server/database/schema'
import { requireUserId } from '#server/utils/auth'
import type { CollectionCard, CollectionPayload, CollectionPrinting, TcgFinish } from '#shared/types/tcg'

export default defineEventHandler(async (event): Promise<CollectionPayload> => {
    const userId = await requireUserId(event)
    const setId = getQuery(event).setId
    if (typeof setId !== 'string' || !setId) {
        throw createError({ statusCode: 400, statusMessage: 'setId is required' })
    }

    const [set] = await db.select({ id: tcgSet.id, status: tcgSet.status })
        .from(tcgSet).where(eq(tcgSet.id, setId))
    if (!set || set.status !== 'committed') {
        throw createError({ statusCode: 404, statusMessage: 'Set not found' })
    }

    // Copy counts select printing_id + count ONLY — the condition column must
    // never be read into any payload (§6.1).
    const [cards, printings, ownedRows] = await Promise.all([
        db.select().from(tcgCard).where(eq(tcgCard.setId, setId)).orderBy(asc(tcgCard.sortOrder)),
        db.select().from(tcgPrinting).where(eq(tcgPrinting.setId, setId)),
        db.select({ printingId: tcgCopy.printingId, owned: count() })
            .from(tcgCopy)
            .where(and(
                eq(tcgCopy.ownerId, userId),
                eq(tcgCopy.setId, setId),
                // Vendored copies no longer count as owned (§7.4).
                ne(tcgCopy.lifecycle, 'destroyed')
            ))
            .groupBy(tcgCopy.printingId)
    ])
    const ownedByPrinting = new Map(ownedRows.map(row => [row.printingId, row.owned]))

    const printingsByCard = new Map<string, CollectionPrinting[]>()
    for (const printing of printings) {
        const list = printingsByCard.get(printing.cardId) ?? []
        list.push({
            id: printing.id,
            plaatjesCardId: printing.plaatjesCardId,
            finish: printing.finish as TcgFinish,
            pattern: printing.pattern,
            printRunLabel: printing.printRunLabel,
            bundle: printing.bundle,
            assetNumber: printing.assetNumber,
            maskKind: printing.maskKind,
            foilEffect: printing.foilEffect,
            foilMask: printing.foilMask,
            owned: ownedByPrinting.get(printing.id) ?? 0
        })
        printingsByCard.set(printing.cardId, list)
    }

    const collectionCards: CollectionCard[] = cards.map(card => ({
        id: card.id,
        plaatjesBaseId: card.plaatjesBaseId,
        name: card.name,
        number: card.number,
        setTotal: card.setTotal,
        rarity: card.rarity,
        rarityCode: card.rarityCode,
        category: card.category,
        sortOrder: card.sortOrder,
        printings: printingsByCard.get(card.id) ?? []
    }))

    const printingsOwned = printings.filter(p => (ownedByPrinting.get(p.id) ?? 0) > 0).length
    const cardsOwnedAnyFinish = collectionCards
        .filter(card => card.printings.some(p => p.owned > 0)).length

    return {
        cards: collectionCards,
        stats: {
            printingsOwned,
            printingsTotal: printings.length,
            cardsOwnedAnyFinish,
            cardsTotal: cards.length
        }
    }
})
