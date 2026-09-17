/**
 * Battler decks: caps that survive bursts, ownership boundaries, and a deck
 * narrowing the run's draft pool. Real Postgres from .env; fixture shape
 * follows run.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgBattlerRun, tcgBattlerDeck } from '#server/database/schema'
import { listDecks, saveDeck, deleteDeck } from '#server/utils/battler/deck'
import { startRun, runView, runHistory, abandonRun } from '#server/utils/battler/run'
import type { RunState } from '#server/utils/battler/run'
import { mintCondition } from '#shared/utils/tcg/condition'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    builder: 'test-tcg-deck-builder',
    stranger: 'test-tcg-deck-stranger'
}
const createdSetIds: string[] = []

let setId: string
let cardIds: string[] = []
let sheetId: string
let packId: string
let nextSlot = 0

const pokemonRaw = (name: string, attackId: number) => ({
    category: 'Pokemon',
    name,
    hp: 60,
    type: 'Colorless',
    retreat: 1,
    attacks: [{ cost: ['Colorless'], name: 'Bonk', damage: '20', attackId }]
})

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `deck spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'DEKC',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    setId = set!.id
    cardIds = []
    const printingIds: string[] = []
    for (let i = 0; i < 5; i++) {
        const [card] = await db.insert(tcgCard).values({
            setId, plaatjesBaseId: `dek-${i}`, number: `00${i + 1}`, name: `Deckling ${i}`, rarity: 'Common', raw: pokemonRaw(`Deckling ${i}`, 100 + i)
        }).returning()
        cardIds.push(card!.id)
        const [printing] = await db.insert(tcgPrinting).values({
            setId, cardId: card!.id, plaatjesCardId: `dek-${i}`, finish: 'nonholo'
        }).returning()
        printingIds.push(printing!.id)
    }
    const [sheet] = await db.insert(tcgSheet).values({
        setId, name: 'd', role: 'base', packSlots: 1, layout: [printingIds[0]!]
    }).returning()
    sheetId = sheet!.id
    const [pack] = await db.insert(tcgPack).values({
        setId, ownerId: USERS.builder, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    packId = pack!.id
    // Two copies of each of the five cards for the builder.
    for (const printingId of printingIds) {
        for (let c = 0; c < 2; c++) {
            await db.insert(tcgCopy).values({
                printingId, setId, ownerId: USERS.builder, packId, sheetId,
                cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
            })
        }
    }
}

async function cleanup() {
    await db.delete(tcgBattlerRun).where(inArray(tcgBattlerRun.userId, Object.values(USERS)))
    await db.delete(tcgBattlerDeck).where(inArray(tcgBattlerDeck.userId, Object.values(USERS)))
    if (createdSetIds.length > 0) {
        await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
        createdSetIds.length = 0
    }
    await db.delete(tcgSet).where(eq(tcgSet.code, 'DEKC'))
}

describe.skipIf(SKIP)('tcg battler decks integration', () => {
    beforeAll(async () => {
        await cleanup()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '1000' })
        }
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanup()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    it('validates name, size and card existence', async () => {
        await expect(saveDeck(USERS.builder, { name: '', cards: [{ cardId: cardIds[0]!, copies: 2 }] }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(saveDeck(USERS.builder, { name: 'ok', cards: [] }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(saveDeck(USERS.builder, { name: 'ok', cards: Array.from({ length: 31 }, (_, i) => ({ cardId: `fake-${i}`, copies: 1 })) }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(saveDeck(USERS.builder, { name: 'ok', cards: [{ cardId: 'nope', copies: 1 }] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Deck contains unknown cards' })
    })

    it('caps decks at five even under a concurrent burst', async () => {
        const outcome = await burst(7, () => saveDeck(USERS.builder, { name: 'burst', cards: [{ cardId: cardIds[0]!, copies: 2 }] }))
        expect(outcome.ok).toBe(5)
        expect(outcome.rejected).toBe(2)
        expect(await listDecks(USERS.builder)).toHaveLength(5)
    })

    it('updates in place, refuses foreign decks, and delete frees a slot', async () => {
        const decks = await listDecks(USERS.builder)
        const target = decks[0]!
        const updated = await saveDeck(USERS.builder, { id: target.id, name: 'renamed', cards: [{ cardId: cardIds[1]!, copies: 1 }, { cardId: cardIds[2]!, copies: 2 }] })
        expect(updated.name).toBe('renamed')
        expect(updated.cards).toEqual([
            { cardId: cardIds[1], copies: 1 },
            { cardId: cardIds[2], copies: 2 }
        ])

        // Copies outside 1–6 are refused.
        await expect(saveDeck(USERS.builder, { id: target.id, name: 'renamed', cards: [{ cardId: cardIds[1]!, copies: 0 }] }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(saveDeck(USERS.builder, { id: target.id, name: 'renamed', cards: [{ cardId: cardIds[1]!, copies: 7 }] }))
            .rejects.toMatchObject({ statusCode: 400 })

        await expect(saveDeck(USERS.stranger, { id: target.id, name: 'steal', cards: [{ cardId: cardIds[0]!, copies: 2 }] }))
            .rejects.toMatchObject({ statusCode: 404 })
        await expect(deleteDeck(USERS.stranger, target.id))
            .rejects.toMatchObject({ statusCode: 404 })

        // At the cap a new create is refused; deleting frees the slot.
        await expect(saveDeck(USERS.builder, { name: 'sixth', cards: [{ cardId: cardIds[0]!, copies: 2 }] }))
            .rejects.toMatchObject({ statusCode: 400 })
        await deleteDeck(USERS.builder, target.id)
        const again = await saveDeck(USERS.builder, { name: 'sixth', cards: [{ cardId: cardIds[0]!, copies: 2 }] })
        expect(again.id).toBeTruthy()
    })

    it('a deck narrows the draft pool, caps instances, and stamps history', async () => {
        // The builder owns 2 copies of each card; the deck fields only 1.
        const deck = await saveDeck(USERS.builder, {
            id: (await listDecks(USERS.builder))[0]!.id,
            name: 'trio',
            cards: [
                { cardId: cardIds[0]!, copies: 1 },
                { cardId: cardIds[1]!, copies: 1 },
                { cardId: cardIds[2]!, copies: 1 }
            ]
        })
        await startRun(USERS.builder, deck.id)
        const view = await runView(USERS.builder)
        const state = view.run!.runState as RunState
        const deckIds = deck.cards.map(card => card.cardId)
        expect(state.pool.length).toBeLessThanOrEqual(3)
        for (const card of state.pool) {
            expect(deckIds).toContain(card.cardId)
            // Owned 2, deck says 1 — the deck cap wins.
            expect(card.instancesLeft).toBe(1)
        }

        await abandonRun(USERS.builder, view.run!.id)
        const history = await runHistory(USERS.builder)
        expect(history[0]!.deckName).toBe('trio')
    })

    it('a deck with fewer than three eligible cards refuses to start', async () => {
        const thin = await saveDeck(USERS.builder, {
            id: (await listDecks(USERS.builder))[0]!.id,
            name: 'thin',
            cards: [{ cardId: cardIds[0]!, copies: 6 }]
        })
        await expect(startRun(USERS.builder, thin.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'This deck has fewer than three battle-ready cards you own' })
        // Deckless start still drafts from the whole collection.
        await startRun(USERS.builder)
        const view = await runView(USERS.builder)
        expect((view.run!.runState as RunState).pool.length).toBe(5)
        await abandonRun(USERS.builder, view.run!.id)
    })
})
