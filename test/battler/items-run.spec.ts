/**
 * Trainers inside a run (§12.6): the item draft, tool escrow that the
 * market then refuses, supporter consumption, and the one-stadium rule.
 * Real Postgres from .env; fixture shape follows run.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgBattlerRun, tcgBattlerEscrow, tcgBattlerSnapshot } from '#server/database/schema'
import { startRun, buyUnit, buyItem, sellItem, sellUnit, runView, abandonRun } from '#server/utils/battler/run'
import type { RunState } from '#server/utils/battler/run'
import { listCopy } from '#server/utils/tcg/market'
import { mintCondition } from '#shared/utils/tcg/condition'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = { player: 'test-tcg-item-player' }
const createdSetIds: string[] = []

let setId: string
let sheetId: string
let packId: string
let nextSlot = 0

const pokemonRaw = (name: string, attackId: number) => ({
    category: 'Pokemon', name, hp: 60, type: 'Colorless', retreat: 1,
    attacks: [{ cost: ['Colorless'], name: 'Bonk', damage: '20', attackId }]
})

const TRAINERS = ['Muscle Band', 'Switch', 'Broken Ground Gym'] as const

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `item spec set ${crypto.randomUUID().slice(0, 8)}`, code: 'ITMS', status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    setId = set!.id
    const printings: { id: string, count: number }[] = []
    for (let i = 0; i < 3; i++) {
        const [card] = await db.insert(tcgCard).values({
            setId, plaatjesBaseId: `itm-p${i}`, number: `00${i + 1}`, name: `Fightling ${i}`, rarity: 'Common', raw: pokemonRaw(`Fightling ${i}`, 200 + i)
        }).returning()
        const [printing] = await db.insert(tcgPrinting).values({
            setId, cardId: card!.id, plaatjesCardId: `itm-p${i}`, finish: 'nonholo'
        }).returning()
        printings.push({ id: printing!.id, count: 2 })
    }
    for (const [i, name] of TRAINERS.entries()) {
        const [card] = await db.insert(tcgCard).values({
            setId, plaatjesBaseId: `itm-t${i}`, number: `01${i}`, name, rarity: 'Common', raw: { category: 'Trainer', name }
        }).returning()
        const [printing] = await db.insert(tcgPrinting).values({
            setId, cardId: card!.id, plaatjesCardId: `itm-t${i}`, finish: 'nonholo'
        }).returning()
        printings.push({ id: printing!.id, count: 2 })
    }
    const [sheet] = await db.insert(tcgSheet).values({
        setId, name: 'i', role: 'base', packSlots: 1, layout: [printings[0]!.id]
    }).returning()
    sheetId = sheet!.id
    const [pack] = await db.insert(tcgPack).values({
        setId, ownerId: USERS.player, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    packId = pack!.id
    for (const printing of printings) {
        for (let c = 0; c < printing.count; c++) {
            await db.insert(tcgCopy).values({
                printingId: printing.id, setId, ownerId: USERS.player, packId, sheetId,
                cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition()
            })
        }
    }
}

async function cleanup() {
    await db.delete(tcgBattlerRun).where(inArray(tcgBattlerRun.userId, Object.values(USERS)))
    await db.delete(tcgBattlerSnapshot).where(inArray(tcgBattlerSnapshot.userId, Object.values(USERS)))
    if (createdSetIds.length > 0) {
        await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
        createdSetIds.length = 0
    }
    await db.delete(tcgSet).where(eq(tcgSet.code, 'ITMS'))
}

async function activeRun(userId: string) {
    const view = await runView(userId)
    if (!view.run) throw new Error('expected an active run')
    return view.run
}

async function fund(runId: string) {
    await db.update(tcgBattlerRun).set({ cash: 15 }).where(eq(tcgBattlerRun.id, runId))
}

/** Reroll-free way to surface a specific item offer during tests. */
async function forceItemOffer(runId: string, cardId: string) {
    const [row] = await db.select().from(tcgBattlerRun).where(eq(tcgBattlerRun.id, runId))
    const state = row!.runState as unknown as RunState
    if (!state.itemShop.some(offer => offer.cardId === cardId)) {
        state.itemShop = [{ cardId, frozen: false }, ...state.itemShop.filter(offer => offer.cardId !== cardId)]
        await db.update(tcgBattlerRun).set({ runState: state as unknown as Record<string, unknown> }).where(eq(tcgBattlerRun.id, runId))
    }
    const fresh = (await db.select().from(tcgBattlerRun).where(eq(tcgBattlerRun.id, runId)))[0]!
    return (fresh.runState as unknown as RunState).itemShop.findIndex(offer => offer.cardId === cardId)
}

function itemCardId(state: RunState, name: string): string {
    const item = state.itemPool.find(entry => entry.name === name)
    if (!item) throw new Error(`${name} not in item pool`)
    return item.cardId
}

describe.skipIf(SKIP)('tcg battler items integration', () => {
    beforeAll(async () => {
        await cleanup()
        await cleanupUser(USERS.player)
        await seedUser(USERS.player, { balance: '1000' })
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanup()
        await cleanupUser(USERS.player)
        await db.$client.end()
    })

    it('drafts the Trainer pool alongside units', async () => {
        await startRun(USERS.player)
        const run = await activeRun(USERS.player)
        const state = run.runState as RunState
        expect(state.itemPool.length).toBe(3) // all three trainers drafted
        expect(state.itemShop.length).toBeGreaterThan(0)
        const gym = state.itemPool.find(entry => entry.name === 'Broken Ground Gym')!
        expect(gym.spec.subtype).toBe('stadium')
    })

    it('tools attach to a unit, escrow the copy, and sell back off', async () => {
        const run = await activeRun(USERS.player)
        await fund(run.id)
        await buyUnit(USERS.player, run.id, 0, null, 0)
        let state = (await activeRun(USERS.player)).runState as RunState
        const holder = state.board[0]!

        const index = await forceItemOffer(run.id, itemCardId(state, 'Muscle Band'))
        await fund(run.id)
        await buyItem(USERS.player, run.id, index, holder.key)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.board[0]!.items).toHaveLength(1)
        const escrowedCopy = state.board[0]!.items[0]!.escrowCopyId
        await expect(listCopy(USERS.player, escrowedCopy, 100, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Copy is fielded in a battler run' })

        // A second tool on the same unit is refused.
        const again = await forceItemOffer(run.id, itemCardId(state, 'Muscle Band'))
        await fund(run.id)
        await expect(buyItem(USERS.player, run.id, again, state.board[0]!.key))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'That unit already holds an item' })

        await sellItem(USERS.player, run.id, { unitKey: state.board[0]!.key })
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.board[0]!.items).toHaveLength(0)
        const escrow = await db.select().from(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.copyId, escrowedCopy))
        expect(escrow).toHaveLength(0)
    })

    it('supporters consume on the spot and hold the copy till run end', async () => {
        const run = await activeRun(USERS.player)
        let state = (await activeRun(USERS.player)).runState as RunState
        const index = await forceItemOffer(run.id, itemCardId(state, 'Switch'))
        await db.update(tcgBattlerRun).set({ cash: 15 }).where(eq(tcgBattlerRun.id, run.id))
        // Drain the reposition budget so the refill is observable.
        state = (await activeRun(USERS.player)).runState as RunState
        state.repositionLeft = 0
        await db.update(tcgBattlerRun).set({ runState: state as unknown as Record<string, unknown> }).where(eq(tcgBattlerRun.id, run.id))

        await buyItem(USERS.player, run.id, index, null)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.repositionLeft).toBe(2) // Switch refills the budget
        const switchItem = state.itemPool.find(entry => entry.name === 'Switch')!
        expect(switchItem.instancesLeft).toBe(1) // one of two consumed
        // The consumed copy stays escrowed until the run ends.
        const escrow = await db.select().from(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, run.id))
        expect(escrow.length).toBeGreaterThan(0)
    })

    it('one stadium at a time; abandon releases every held copy', async () => {
        const run = await activeRun(USERS.player)
        let state = (await activeRun(USERS.player)).runState as RunState
        const index = await forceItemOffer(run.id, itemCardId(state, 'Broken Ground Gym'))
        await fund(run.id)
        await buyItem(USERS.player, run.id, index, null)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.stadium?.name).toBe('Broken Ground Gym')

        const second = await forceItemOffer(run.id, itemCardId(state, 'Broken Ground Gym'))
        await fund(run.id)
        await expect(buyItem(USERS.player, run.id, second, null))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'A Stadium is already in play — sell it first' })

        await abandonRun(USERS.player, run.id)
        const escrow = await db.select().from(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, run.id))
        expect(escrow).toHaveLength(0)
    })

    it('selling a unit releases its attachment too', async () => {
        await startRun(USERS.player)
        const run = await activeRun(USERS.player)
        await fund(run.id)
        await buyUnit(USERS.player, run.id, 0, null, 0)
        let state = (await activeRun(USERS.player)).runState as RunState
        const index = await forceItemOffer(run.id, itemCardId(state, 'Muscle Band'))
        await fund(run.id)
        await buyItem(USERS.player, run.id, index, state.board[0]!.key)
        state = (await activeRun(USERS.player)).runState as RunState
        const copyIds = [...state.board[0]!.escrowCopyIds, state.board[0]!.items[0]!.escrowCopyId]

        await sellUnit(USERS.player, run.id, state.board[0]!.key)
        const escrow = await db.select().from(tcgBattlerEscrow).where(inArray(tcgBattlerEscrow.copyId, copyIds))
        expect(escrow).toHaveLength(0)
        state = (await activeRun(USERS.player)).runState as RunState
        expect(state.itemPool.find(entry => entry.name === 'Muscle Band')!.instancesLeft).toBe(2)
        await abandonRun(USERS.player, run.id)
    })
})
