/**
 * Direct trades (§7.1): no escrow until accept, atomic accept-time
 * validation, coin leg 95/5. Real Postgres from .env.
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

        // Offers escrow nothing: ann's cards stay fully usable while it sits.
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

        const annBefore = await balanceOf(USERS.ann)
        const benBefore = await balanceOf(USERS.ben)
        await acceptOffer(USERS.ben, offer.id)

        expect(await balanceOf(USERS.ann)).toBeCloseTo(annBefore - 500, 4)
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
