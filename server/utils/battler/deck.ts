import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgBattlerDeck, tcgCard } from '#server/database/schema'

/*
 * Saved decks (§12 addendum): a deck is up to DECK_CARD_LIMIT distinct card
 * identities that narrow the run's draft pool. Copies are never bound —
 * eligibility and instances resolve from the live collection at run start.
 */

export const DECK_LIMIT = 5
export const DECK_CARD_LIMIT = 30

export interface DeckCard {
    cardId: string
    /** Copies this deck fields at most — caps draft weight and merge depth. */
    copies: number
}

/** Legacy decks stored bare card-id strings — read them as full depth. */
export function normalizeDeckCards(value: unknown): DeckCard[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const cards: DeckCard[] = []
    for (const entry of value) {
        const cardId = typeof entry === 'string' ? entry : (entry as { cardId?: unknown })?.cardId
        if (typeof cardId !== 'string' || seen.has(cardId)) continue
        const raw = typeof entry === 'object' && entry !== null ? (entry as { copies?: unknown }).copies : 6
        const copies = typeof raw === 'number' && Number.isInteger(raw) ? Math.min(6, Math.max(1, raw)) : 6
        seen.add(cardId)
        cards.push({ cardId, copies })
    }
    return cards
}

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

export async function listDecks(userId: string) {
    const rows = await db.select({
        id: tcgBattlerDeck.id,
        name: tcgBattlerDeck.name,
        cards: tcgBattlerDeck.cards,
        updatedAt: tcgBattlerDeck.updatedAt
    })
        .from(tcgBattlerDeck)
        .where(eq(tcgBattlerDeck.userId, userId))
        .orderBy(desc(tcgBattlerDeck.createdAt))
    return rows.map(row => ({ ...row, cards: normalizeDeckCards(row.cards) }))
}

export async function getDeck(userId: string, deckId: string) {
    const [deck] = await db.select().from(tcgBattlerDeck)
        .where(and(eq(tcgBattlerDeck.id, deckId), eq(tcgBattlerDeck.userId, userId)))
    if (!deck) throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
    return { ...deck, cards: normalizeDeckCards(deck.cards) }
}

export async function saveDeck(userId: string, input: { id?: string | null, name: string, cards: DeckCard[] }) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 40) badRequest('Deck name must be 1–40 characters')
    const entries = Array.isArray(input.cards) ? input.cards : []
    const seen = new Set<string>()
    const cards: DeckCard[] = []
    for (const entry of entries) {
        if (typeof entry?.cardId !== 'string' || !entry.cardId) badRequest('Deck contains an invalid card entry')
        if (seen.has(entry.cardId)) continue
        if (typeof entry.copies !== 'number' || !Number.isInteger(entry.copies) || entry.copies < 1 || entry.copies > 6) {
            badRequest('Card copies must be between 1 and 6')
        }
        seen.add(entry.cardId)
        cards.push({ cardId: entry.cardId, copies: entry.copies })
    }
    if (cards.length === 0) badRequest('A deck needs at least one card')
    if (cards.length > DECK_CARD_LIMIT) badRequest(`A deck holds at most ${DECK_CARD_LIMIT} cards`)
    const cardIds = cards.map(card => card.cardId)
    const known = await db.select({ id: tcgCard.id }).from(tcgCard).where(inArray(tcgCard.id, cardIds))
    if (known.length !== cardIds.length) badRequest('Deck contains unknown cards')

    if (input.id) {
        const [updated] = await db.update(tcgBattlerDeck)
            .set({ name, cards, updatedAt: sql`now()` })
            .where(and(eq(tcgBattlerDeck.id, input.id), eq(tcgBattlerDeck.userId, userId)))
            .returning()
        if (!updated) throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
        return { id: updated.id, name: updated.name, cards: updated.cards }
    }

    // The advisory lock serializes creates per user, so a burst cannot all
    // pass the same count read (READ COMMITTED would let even a single
    // INSERT..SELECT-count statement race).
    return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`battler-deck:${userId}`}))`)
        const owned = await tx.select({ id: tcgBattlerDeck.id }).from(tcgBattlerDeck)
            .where(eq(tcgBattlerDeck.userId, userId))
        if (owned.length >= DECK_LIMIT) badRequest(`You can save at most ${DECK_LIMIT} decks`)
        const [created] = await tx.insert(tcgBattlerDeck)
            .values({ userId, name, cards })
            .returning()
        return { id: created!.id, name: created!.name, cards: created!.cards }
    })
}

export async function deleteDeck(userId: string, deckId: string) {
    const [deleted] = await db.delete(tcgBattlerDeck)
        .where(and(eq(tcgBattlerDeck.id, deckId), eq(tcgBattlerDeck.userId, userId)))
        .returning({ id: tcgBattlerDeck.id })
    if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Deck not found' })
    return { ok: true as const }
}
