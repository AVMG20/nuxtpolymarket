/**
 * Battler runs (§12.2, §12.10): single-run claim, draft eligibility, hard
 * escrow that plugs into the market encumbrance, and the run ladder. Real
 * Postgres from .env; fixture shape follows lots.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgListing, tcgBattlerRun, tcgBattlerEscrow, tcgBattlerSnapshot } from '#server/database/schema'
import { startRun, buyUnit, sellUnit, rerollShop, toggleFreeze, moveUnit, fight, abandonRun, runView, eligibleCount } from '#server/utils/battler/run'
import type { RunState } from '#server/utils/battler/run'
import { listCopy } from '#server/utils/tcg/market'
import { vendorCopy } from '#server/utils/tcg/vendor'
import { mintCondition } from '#shared/utils/tcg/condition'
import { SKIP, burst, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    player: 'test-tcg-battler-player',
    rival: 'test-tcg-battler-rival'
}
const createdSetIds: string[] = []

let setId: string
let commonPrintingId: string
let chasePrintingId: string
let sidekickPrintingId: string
let sheetId: string
let packId: string
let nextSlot = 0

const COMMON_RAW = {
    category: 'Pokemon',
    name: 'Battleling',
    hp: 60,
    type: 'Colorless',
    retreat: 1,
    attacks: [{ cost: ['Colorless'], name: 'Bonk', damage: '20', attackId: 11 }],
    weakness: { type: 'Fighting', amount: '2' }
}

const SIDEKICK_RAW = {
    category: 'Pokemon',
    name: 'Sidekickling',
    hp: 90,
    type: 'Water',
    retreat: 0,
    attacks: [{ cost: ['Water', 'Water'], name: 'Splash Cannon', damage: '40', attackId: 31 }],
    resistance: { type: 'Fighting', amount: '-30' }
}

const CHASE_RAW = {
    category: 'Pokemon',
    name: 'Battleling ex',
    hp: 200,
    type: 'Fire',
    retreat: 2,
    // The pricedex tier is the pricing truth; the rarity column carries the
    // sidecar code for this card (as several real imports do).
    pullRate: { tier: 'Double Rare' },
    attacks: [
        { cost: ['Fire', 'Fire'], name: 'Sear', damage: '60', attackId: 21 },
        { cost: ['Fire', 'Fire', 'Fire', 'Fire'], name: 'Inferno', damage: '180', attackId: 22 }
    ]
}

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `battler spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'BATL',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [common] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'bat-0', number: '001', name: 'Battleling', rarity: 'Common', raw: COMMON_RAW
    }).returning()
    const [chase] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'bat-1', number: '002', name: 'Battleling ex', rarity: '2R', raw: CHASE_RAW
    }).returning()
    const [sidekick] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'bat-3', number: '004', name: 'Sidekickling', rarity: 'Uncommon', raw: SIDEKICK_RAW
    }).returning()
    const [legacy] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'bat-2', number: '003', name: 'Oldling', rarity: 'Common', raw: { category: 'Pokemon', name: 'Oldling', hp: null, attacks: [] }
    }).returning()
    const [commonPrinting] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: common!.id, plaatjesCardId: 'bat-0', finish: 'nonholo'
    }).returning()
    const [chasePrinting] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: chase!.id, plaatjesCardId: 'bat-1', finish: 'nonholo'
    }).returning()
    const [sidekickPrinting] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: sidekick!.id, plaatjesCardId: 'bat-3', finish: 'nonholo'
    }).returning()
    sidekickPrintingId = sidekickPrinting!.id
    await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: legacy!.id, plaatjesCardId: 'bat-2', finish: 'nonholo'
    })
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'b', role: 'base', packSlots: 1, layout: [commonPrinting!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.player, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    setId = set!.id
    commonPrintingId = commonPrinting!.id
    chasePrintingId = chasePrinting!.id
    sheetId = sheet!.id
    packId = pack!.id
}

async function seedCopies(ownerId: string, printingId: string, count: number): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
        const [copy] = await db.insert(tcgCopy).values({
            printingId, setId, ownerId, packId, sheetId,
            cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
        }).returning()
        ids.push(copy!.id)
    }
    return ids
}

async function cleanupRuns() {
    await db.delete(tcgBattlerRun).where(inArray(tcgBattlerRun.userId, Object.values(USERS)))
    await db.delete(tcgBattlerSnapshot).where(inArray(tcgBattlerSnapshot.userId, Object.values(USERS)))
}

async function activeRun(userId: string) {
    const view = await runView(userId)
    if (!view.run) throw new Error('expected an active run')
    return view.run
}

describe.skipIf(SKIP)('tcg battler runs integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '1000' })
        }
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanupRuns()
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        await cleanupRuns()
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'BATL'))
    }

    it('drafts from eligible copies only and claims a single active run', async () => {
        await seedCopies(USERS.player, commonPrintingId, 6)
        await seedCopies(USERS.player, chasePrintingId, 2)
        await seedCopies(USERS.player, sidekickPrintingId, 4)
        // A slabbed copy neither drafts nor counts toward the ceiling.
        const [slabbed] = await seedCopies(USERS.player, commonPrintingId, 1)
        await db.update(tcgCopy).set({ lifecycle: 'slabbed' }).where(eq(tcgCopy.id, slabbed!))

        expect(await eligibleCount(USERS.player)).toBe(3) // legacy card has no stats

        const outcome = await burst(4, () => startRun(USERS.player))
        expect(outcome.ok).toBe(1)
        expect(outcome.rejected).toBe(3)

        const run = await activeRun(USERS.player)
        const state = run.runState as RunState
        expect(state.pool.length).toBe(3)
        const common = state.pool.find(card => card.name === 'Battleling')!
        expect(common.instancesLeft).toBe(6) // the slabbed seventh copy is invisible
        expect(common.cost).toBe(3)
        const chase = state.pool.find(card => card.name === 'Battleling ex')!
        expect(chase.instancesLeft).toBe(2)
        expect(chase.spec.bounty).toBe(2)
        expect(chase.cost).toBe(6) // pricedex tier beats the '2R' rarity code
        expect(state.shop.length).toBe(3)
        expect(run.cash).toBe(10)
        expect((run as unknown as { secret?: string }).secret).toBeUndefined()
    })

    it('buying escrows a copy that the market then refuses; merging follows thresholds', async () => {
        const run = await activeRun(USERS.player)
        const state = run.runState as RunState
        const commonIndex = state.shop.findIndex(offer =>
            state.pool.find(card => card.cardId === offer.cardId)!.name === 'Battleling')
        // Ensure a common offer exists — reroll until one shows.
        let index = commonIndex
        for (let i = 0; index === -1 && i < 10; i++) {
            await rerollShop(USERS.player, run.id)
            const rolled = (await activeRun(USERS.player)).runState as RunState
            index = rolled.shop.findIndex(offer =>
                rolled.pool.find(card => card.cardId === offer.cardId)!.name === 'Battleling')
        }
        expect(index).toBeGreaterThanOrEqual(0)

        await buyUnit(USERS.player, run.id, index, null, 0)
        let current = (await activeRun(USERS.player)).runState as RunState
        expect(current.board).toHaveLength(1)
        expect(current.board[0]!.instances).toBe(1)

        const escrowedCopy = current.board[0]!.escrowCopyIds[0]!
        await expect(listCopy(USERS.player, escrowedCopy, 100, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is fielded in a battler run' })
        await expect(vendorCopy(USERS.player, escrowedCopy, 1))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is fielded in a battler run' })

        // Two more instances merge the unit to level 2.
        for (let bought = 1; bought < 3; bought++) {
            let view = (await activeRun(USERS.player)).runState as RunState
            let offerIndex = view.shop.findIndex(offer => offer.cardId === current.board[0]!.cardId)
            while (offerIndex === -1) {
                await rerollShop(USERS.player, run.id)
                view = (await activeRun(USERS.player)).runState as RunState
                offerIndex = view.shop.findIndex(offer => offer.cardId === current.board[0]!.cardId)
            }
            await buyUnit(USERS.player, run.id, offerIndex, null, null)
        }
        current = (await activeRun(USERS.player)).runState as RunState
        expect(current.board[0]!.instances).toBe(3)
        expect(current.board[0]!.escrowCopyIds).toHaveLength(3)

        // Selling releases every backing copy.
        await sellUnit(USERS.player, run.id, current.board[0]!.key)
        const escrow = await db.select().from(tcgBattlerEscrow)
        expect(escrow.filter(row => row.runId === run.id)).toHaveLength(0)
        await expect(listCopy(USERS.player, escrowedCopy, 100, null)).resolves.toBeDefined()
        // Tear the proof-listing down so later buys can escrow this copy again.
        await db.delete(tcgListing).where(eq(tcgListing.copyId, escrowedCopy))
    })

    it('freeze persists an offer across rerolls and move respects the budget', async () => {
        const run = await activeRun(USERS.player)
        let state = (await activeRun(USERS.player)).runState as RunState
        await toggleFreeze(USERS.player, run.id, 0)
        const frozenCard = state.shop[0]!.cardId
        await rerollShop(USERS.player, run.id)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.shop.some(offer => offer.cardId === frozenCard && offer.frozen)).toBe(true)

        // Buy one unit to have something to move.
        const offerIndex = 0
        await buyUnit(USERS.player, run.id, offerIndex, null, 0)
        state = (await activeRun(USERS.player)).runState as RunState
        const unit = state.board[state.board.length - 1]!
        const retreat = state.pool.find(card => card.cardId === unit.cardId)!.spec.retreat
        await moveUnit(USERS.player, run.id, unit.key, 4)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.board.find(entry => entry.key === unit.key)!.position).toBe(4)
        // Zero-retreat units are fluid; heavy ones spend the budget (§12.4).
        expect(state.repositionLeft).toBe(2 - retreat)
    })

    it('fighting advances the ladder, snapshots the board and ends after 3 losses', async () => {
        const run = await activeRun(USERS.player)
        let losses = 0
        let wins = 0
        for (let round = 0; round < 15; round++) {
            const view = await runView(USERS.player)
            if (!view.run) break
            const outcome = await fight(USERS.player, view.run.id)
            expect(outcome.replay.events.length).toBeGreaterThan(0)
            if (outcome.result === 'loss') losses++
            if (outcome.result === 'win') wins++
            if (outcome.run.state !== 'active') break
        }
        const [finished] = await db.select().from(tcgBattlerRun).where(eq(tcgBattlerRun.id, run.id))
        expect(['won', 'lost']).toContain(finished!.state)
        expect(finished!.losses).toBe(losses)
        expect(finished!.wins).toBe(wins)

        // Escrow fully released at run end.
        const escrow = await db.select().from(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, run.id))
        expect(escrow).toHaveLength(0)
        // Snapshots recorded for the rounds fought.
        const snapshots = await db.select().from(tcgBattlerSnapshot).where(eq(tcgBattlerSnapshot.runId, run.id))
        expect(snapshots.length).toBeGreaterThan(0)
    })

    it('abandon releases escrow and frees the claim for a new run', async () => {
        await startRun(USERS.player)
        const run = await activeRun(USERS.player)
        const state = run.runState as RunState
        await buyUnit(USERS.player, run.id, 0, null, 0)
        void state
        await abandonRun(USERS.player, run.id)
        const escrow = await db.select().from(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, run.id))
        expect(escrow).toHaveLength(0)
        const view = await runView(USERS.player)
        expect(view.run).toBeNull()
        expect(view.eligibleCards).toBeGreaterThan(0)
    })
})
