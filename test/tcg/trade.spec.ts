/**
 * Direct trades (§7.1): the sender's coins escrow on creation, cards do not,
 * accept-time validation is atomic and the coin leg pays 95/5.
 * Real Postgres from .env.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { user, tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgCopyTransfer, tcgTradeOffer } from '#server/database/schema'
import { createOffer, acceptOffer, declineOffer, cancelOffer } from '#server/utils/tcg/trade'
import { listCopy } from '#server/utils/tcg/market'
import { vendorCopy } from '#server/utils/tcg/vendor'
import { mintCondition } from '#shared/utils/tcg/condition'
import { sellerProceeds } from '#shared/utils/tcg/market'
import { credit } from '#server/utils/balance'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    ann: 'test-tcg-trade-ann',
    ben: 'test-tcg-trade-ben'
}
const createdSetIds: string[] = []

let setId: string
let printingId: string
let sheetId: string
let packId: string
let nextSlot = 0

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `trade spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'TRDE',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'trd-0', number: '001', name: 'Tradeling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'trd-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 't', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.ann, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    setId = set!.id
    printingId = printing!.id
    sheetId = sheet!.id
    packId = pack!.id
}

async function seedCopy(ownerId: string): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId, setId, ownerId, packId, sheetId,
        cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
    }).returning()
    return copy!.id
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
    return parseFloat(row!.balance)
}

describe.skipIf(SKIP)('tcg direct trades integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '1000000' })
        }
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'TRDE'))
    }

    it('accept swaps atomically with the coin leg at 95/5', async () => {
        const annCard1 = await seedCopy(USERS.ann)
        const annCard2 = await seedCopy(USERS.ann)
        const benCard = await seedCopy(USERS.ben)

        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben,
            senderCopyIds: [annCard1, annCard2],
            receiverCopyIds: [benCard],
            senderCoins: 500,
            receiverCoins: 0,
            note: 'two commons and coins for your card'
        })

        // Cards escrow nothing: ann's stay fully usable while the offer sits.
        await listCopy(USERS.ann, annCard1, 100, null)
        // …but an encumbered item makes the accept fail cleanly.
        await expect(acceptOffer(USERS.ben, offer.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'A card in this trade is held by a listing, lot, auction or battler run' })
        const [still] = await db.select({ state: tcgTradeOffer.state }).from(tcgTradeOffer)
            .where(eq(tcgTradeOffer.id, offer.id))
        expect(still!.state).toBe('open')

        // Unlist and accept for real.
        const { cancelListing } = await import('#server/utils/tcg/market')
        const [listing] = await db.select().from((await import('#server/database/schema')).tcgListing)
            .where(eq((await import('#server/database/schema')).tcgListing.copyId, annCard1))
        await cancelListing(USERS.ann, listing!.id)

        // Coins, though, left ann the moment she made the offer — accept only
        // moves what is already held, so her balance does not change again.
        const annBefore = await balanceOf(USERS.ann)
        const benBefore = await balanceOf(USERS.ben)
        await acceptOffer(USERS.ben, offer.id)

        expect(await balanceOf(USERS.ann)).toBeCloseTo(annBefore, 4)
        expect(await balanceOf(USERS.ben)).toBeCloseTo(benBefore + sellerProceeds(500), 4)

        const copies = await db.select({ id: tcgCopy.id, ownerId: tcgCopy.ownerId }).from(tcgCopy)
            .where(inArray(tcgCopy.id, [annCard1, annCard2, benCard]))
        const ownerById = new Map(copies.map(copy => [copy.id, copy.ownerId]))
        expect(ownerById.get(annCard1)).toBe(USERS.ben)
        expect(ownerById.get(annCard2)).toBe(USERS.ben)
        expect(ownerById.get(benCard)).toBe(USERS.ann)

        const transfers = await db.select().from(tcgCopyTransfer)
            .where(inArray(tcgCopyTransfer.copyId, [annCard1, annCard2, benCard]))
        expect(transfers.filter(row => row.kind === 'trade')).toHaveLength(3)
    }, 30_000)

    it('accept fails cleanly when an item left the collection; burst accepts once', async () => {
        const gone = await seedCopy(USERS.ann)
        const benCard = await seedCopy(USERS.ben)
        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben,
            senderCopyIds: [gone],
            receiverCopyIds: [benCard],
            senderCoins: 0,
            receiverCoins: 0,
            note: null
        })
        await vendorCopy(USERS.ann, gone, 1)
        await expect(acceptOffer(USERS.ben, offer.id))
            .rejects.toMatchObject({ statusCode: 400 })
        await declineOffer(USERS.ben, offer.id)

        const a = await seedCopy(USERS.ann)
        const b = await seedCopy(USERS.ben)
        const second = await createOffer(USERS.ann, {
            toUserId: USERS.ben,
            senderCopyIds: [a],
            receiverCopyIds: [b],
            senderCoins: 0,
            receiverCoins: 0,
            note: null
        })
        const result = await burst(6, () => acceptOffer(USERS.ben, second.id))
        expect(result).toEqual({ ok: 1, rejected: 5 })
    }, 30_000)

    it('escrows the sender coins on creation and refunds them on cancel', async () => {
        const card = await seedCopy(USERS.ann)
        const before = await balanceOf(USERS.ann)

        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [card], receiverCopyIds: [],
            senderCoins: 250, receiverCoins: 0, note: null
        })
        expect(await balanceOf(USERS.ann)).toBeCloseTo(before - 250, 4)
        const [held] = await db.select({ escrow: tcgTradeOffer.senderEscrow }).from(tcgTradeOffer)
            .where(eq(tcgTradeOffer.id, offer.id))
        expect(parseFloat(held!.escrow)).toBeCloseTo(250, 4)

        await cancelOffer(USERS.ann, offer.id)
        expect(await balanceOf(USERS.ann)).toBeCloseTo(before, 4)
        const [released] = await db.select({ escrow: tcgTradeOffer.senderEscrow }).from(tcgTradeOffer)
            .where(eq(tcgTradeOffer.id, offer.id))
        expect(parseFloat(released!.escrow)).toBe(0)
    }, 30_000)

    it('refunds the escrow when the receiver declines', async () => {
        const card = await seedCopy(USERS.ann)
        const before = await balanceOf(USERS.ann)
        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [card], receiverCopyIds: [],
            senderCoins: 120, receiverCoins: 0, note: null
        })
        expect(await balanceOf(USERS.ann)).toBeCloseTo(before - 120, 4)
        await declineOffer(USERS.ben, offer.id)
        expect(await balanceOf(USERS.ann)).toBeCloseTo(before, 4)
    }, 30_000)

    // The point of escrowing: an offer the sender cannot fund never reaches
    // the receiver, instead of failing under them at accept.
    it('refuses an offer the sender cannot fund, and creates nothing', async () => {
        const card = await seedCopy(USERS.ann)
        const before = await balanceOf(USERS.ann)
        const openBefore = await db.select({ id: tcgTradeOffer.id }).from(tcgTradeOffer)
            .where(eq(tcgTradeOffer.fromUserId, USERS.ann))

        await expect(createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [card], receiverCopyIds: [],
            senderCoins: before + 1000, receiverCoins: 0, note: null
        })).rejects.toMatchObject({ statusCode: 400 })

        expect(await balanceOf(USERS.ann)).toBeCloseTo(before, 4)
        const openAfter = await db.select({ id: tcgTradeOffer.id }).from(tcgTradeOffer)
            .where(eq(tcgTradeOffer.fromUserId, USERS.ann))
        expect(openAfter).toHaveLength(openBefore.length)
    }, 30_000)

    // Coins ASKED FOR are never escrowed — the receiver has not agreed yet, so
    // they pay at accept, which is the moment they do.
    it('leaves the receiver side unescrowed until accept', async () => {
        const annCard = await seedCopy(USERS.ann)
        const benBefore = await balanceOf(USERS.ben)
        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [annCard], receiverCopyIds: [],
            senderCoins: 0, receiverCoins: 300, note: null
        })
        expect(await balanceOf(USERS.ben)).toBeCloseTo(benBefore, 4)

        const annBefore = await balanceOf(USERS.ann)
        await acceptOffer(USERS.ben, offer.id)
        expect(await balanceOf(USERS.ben)).toBeCloseTo(benBefore - 300, 4)
        expect(await balanceOf(USERS.ann)).toBeCloseTo(annBefore + sellerProceeds(300), 4)
    }, 30_000)

    // A burst of cancels must refund once, not six times.
    it('refunds exactly once under a burst of cancels', async () => {
        const card = await seedCopy(USERS.ann)
        const before = await balanceOf(USERS.ann)
        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [card], receiverCopyIds: [],
            senderCoins: 400, receiverCoins: 0, note: null
        })
        const result = await burst(6, () => cancelOffer(USERS.ann, offer.id))
        expect(result).toEqual({ ok: 1, rejected: 5 })
        expect(await balanceOf(USERS.ann)).toBeCloseTo(before, 4)
    }, 30_000)

    // Offers made before escrow existed carry senderEscrow 0 with coins owed:
    // accept must still take them, or the payout would mint coins.
    it('debits at accept for an offer that predates escrow', async () => {
        const annCard = await seedCopy(USERS.ann)
        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [annCard], receiverCopyIds: [],
            senderCoins: 200, receiverCoins: 0, note: null
        })
        // Rewind to the pre-migration shape: coins promised, nothing held.
        await db.update(tcgTradeOffer).set({ senderEscrow: '0' })
            .where(eq(tcgTradeOffer.id, offer.id))
        await credit(USERS.ann, '200.0000', 'test')

        const annBefore = await balanceOf(USERS.ann)
        const benBefore = await balanceOf(USERS.ben)
        await acceptOffer(USERS.ben, offer.id)
        expect(await balanceOf(USERS.ann)).toBeCloseTo(annBefore - 200, 4)
        expect(await balanceOf(USERS.ben)).toBeCloseTo(benBefore + sellerProceeds(200), 4)
    }, 30_000)

    it('validation: direction of coins, sides, caps, self-trades, cancel', async () => {
        const a = await seedCopy(USERS.ann)
        await expect(createOffer(USERS.ann, {
            toUserId: USERS.ann, senderCopyIds: [a], receiverCopyIds: [], senderCoins: 0, receiverCoins: 0, note: null
        })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Pick another player to trade with' })
        await expect(createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [a], receiverCopyIds: [], senderCoins: 10, receiverCoins: 10, note: null
        })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Coins go one way in a trade' })
        await expect(createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [], receiverCopyIds: [], senderCoins: 0, receiverCoins: 0, note: null
        })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'An empty trade is not a trade' })
        const theirs = await seedCopy(USERS.ben)
        await expect(createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [theirs], receiverCopyIds: [], senderCoins: 0, receiverCoins: 0, note: null
        })).rejects.toMatchObject({ statusCode: 400, statusMessage: 'You can only offer your own cards' })

        const offer = await createOffer(USERS.ann, {
            toUserId: USERS.ben, senderCopyIds: [a], receiverCopyIds: [], senderCoins: 0, receiverCoins: 0, note: null
        })
        await cancelOffer(USERS.ann, offer.id)
        await expect(acceptOffer(USERS.ben, offer.id))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Offer is gone' })
    })
})
