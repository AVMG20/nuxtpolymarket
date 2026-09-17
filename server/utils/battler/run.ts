import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '#server/database'
import { tcgBattlerRun, tcgBattlerEscrow, tcgBattlerSnapshot, tcgBattlerRating, tcgCopy, tcgCard, tcgPrinting, tcgSet } from '#server/database/schema'
import { deriveKey } from '#server/utils/tcg/feistel'
import { eloDelta } from '#shared/utils/battler/elo'
import { lockCopyForUpdate, assertUnencumbered } from '#server/utils/tcg/market'
import { getDeck } from '#server/utils/battler/deck'
import { createBattlerRandom } from '#shared/utils/battler/rng'
import { deriveUnit } from '#shared/utils/battler/unit'
import { deriveItem, itemCostFor } from '#shared/utils/battler/items'
import type { BattlerItemSpec, BattlerStadiumEffect } from '#shared/utils/battler/items'
import type { BattlerUnitSpec } from '#shared/utils/battler/unit'
import { BATTLER, unitCostFor } from '#shared/utils/battler/shop'
import { draftPool } from '#shared/utils/battler/draft'
import { simulateBattle } from '#shared/utils/battler/combat'
import type { BattleUnit, BattleItem, BattleReplay } from '#shared/utils/battler/combat'
import { generateBoard } from '#shared/utils/battler/generate'

/*
 * The auto-battler run (§12): draft → shop → deterministic combat, with
 * hard escrow on every purchased copy (§12.10). The run row FOR UPDATE is
 * the serialization point for every mutation, and the partial unique index
 * on (user_id) where state='active' is the one-live-run claim. All
 * randomness derives from the run's server-held secret — the seed is never
 * client-supplied and never serialized (a known seed would let a player
 * scout the shop).
 */

const badRequest = (statusMessage: string): never => {
    throw createError({ statusCode: 400, statusMessage })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface RunRender {
    bundle: string | null
    plaatjesCardId: string | null
    assetNumber: string | null
}

export interface RunPoolCard {
    cardId: string
    name: string
    rarity: string | null
    cost: number
    /** Instances still purchasable this run — min(copies_owned, 6) at draft. */
    instancesLeft: number
    spec: BattlerUnitSpec
    render: RunRender
}

export interface RunBoardUnit {
    key: string
    cardId: string
    attackId: number
    instances: number
    /** 0 is the active shield, 1–5 the bench (§12.5). */
    position: number
    escrowCopyIds: string[]
    /** Attached tools (§12.6) — at most one per unit. */
    items: { cardId: string, name: string, escrowCopyId: string }[]
}

export interface RunItemCard {
    cardId: string
    name: string
    rarity: string | null
    cost: number
    instancesLeft: number
    spec: BattlerItemSpec
    render: RunRender
}

export interface RunShopOffer {
    cardId: string
    frozen: boolean
}

export interface SerializedOpponent {
    name: string
    board: (BattleUnit & { render: RunRender })[]
    stadium?: { name: string, effect: BattlerStadiumEffect } | null
}

export interface RunState {
    pool: RunPoolCard[]
    shop: RunShopOffer[]
    board: RunBoardUnit[]
    itemPool: RunItemCard[]
    itemShop: RunShopOffer[]
    /** One Stadium in play per run (§12.6). */
    stadium: { cardId: string, name: string, escrowCopyId: string } | null
    freeRerolls: number
    /** Team-wide supporter buffs applying to the next battle only. */
    nextBattle: { atk: number, hp: number }
    repositionLeft: number
    rollCounter: number
    unitCounter: number
    lastBattle: {
        round: number
        opponent: SerializedOpponent
        seed: number
        result: 'win' | 'loss' | 'draw'
    } | null
}

function runSeed(secret: string, label: string): number {
    return deriveKey(secret, label).readUInt32BE(0)
}

/** The run row, locked; every mutation queues here. */
async function lockRun(tx: Tx, userId: string, runId: string) {
    const [run] = await tx.select().from(tcgBattlerRun)
        .where(and(eq(tcgBattlerRun.id, runId), eq(tcgBattlerRun.userId, userId)))
        .for('update')
    if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
    if (run.state !== 'active') badRequest('Run is over')
    return run
}

function stateOf(run: { runState: unknown }): RunState {
    const state = run.runState as RunState
    // Runs from before items existed normalize in place.
    state.itemPool ??= []
    state.itemShop ??= []
    state.stadium ??= null
    state.freeRerolls ??= 0
    state.nextBattle ??= { atk: 0, hp: 0 }
    for (const unit of state.board) unit.items ??= []
    return state
}

async function saveState(tx: Tx, runId: string, state: RunState, patch: Partial<{ round: number, wins: number, losses: number, cash: number, state: string, finishedAt: Date }> = {}) {
    await tx.update(tcgBattlerRun)
        .set({ runState: state as unknown as Record<string, unknown>, updatedAt: sql`now()`, ...patch })
        .where(eq(tcgBattlerRun.id, runId))
}

/** Fill the shop track to width with seeded draws from the drafted pool. */
function rollShop(state: RunState, secret: string, round: number, keepFrozen: boolean) {
    const width = BATTLER.trackWidthFor(round)
    const kept = keepFrozen ? state.shop.filter(offer => offer.frozen) : []
    const rng = createBattlerRandom(runSeed(secret, `shop:${round}:${state.rollCounter}`))
    state.rollCounter += 1
    const offers: RunShopOffer[] = [...kept]
    // Duplicates are fine, but never offer more tiles of a card than the
    // pool can actually deliver.
    const offered = (cardId: string) => offers.filter(offer => offer.cardId === cardId).length
    while (offers.length < width) {
        const drawable = state.pool.filter(card => card.instancesLeft > offered(card.cardId))
        if (drawable.length === 0) break
        offers.push({ cardId: rng.pick(drawable).cardId, frozen: false })
    }
    state.shop = offers
}

/** Fill the item track with seeded draws from the drafted Trainer pool. */
function rollItemShop(state: RunState, secret: string, round: number, keepFrozen: boolean) {
    const kept = keepFrozen ? state.itemShop.filter(offer => offer.frozen) : []
    const rng = createBattlerRandom(runSeed(secret, `itemshop:${round}:${state.rollCounter}`))
    state.rollCounter += 1
    const offers: RunShopOffer[] = [...kept]
    const offered = (cardId: string) => offers.filter(offer => offer.cardId === cardId).length
    while (offers.length < BATTLER.itemTrackWidth) {
        const drawable = state.itemPool.filter(card => card.instancesLeft > offered(card.cardId))
        if (drawable.length === 0) break
        offers.push({ cardId: rng.pick(drawable).cardId, frozen: false })
    }
    state.itemShop = offers
}

// ── Eligible holdings ──────────────────────────────────────────────────────

interface Holding {
    cardId: string
    copies: number
    name: string
    rarity: string | null
    spec: BattlerUnitSpec
    render: RunRender
}

/**
 * The caller's draftable collection: raw, unslabbed, unescrowed copies of
 * cards whose imported data can derive a unit (§12.2). Legacy imports whose
 * combat fields never arrived fall out naturally at deriveUnit.
 */
export async function eligibleHoldings(userId: string): Promise<Holding[]> {
    const rows = await db.select({
        cardId: tcgCard.id,
        name: tcgCard.name,
        rarity: tcgCard.rarity,
        raw: tcgCard.raw,
        copyId: tcgCopy.id,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .leftJoin(tcgBattlerEscrow, eq(tcgBattlerEscrow.copyId, tcgCopy.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            eq(tcgCopy.lifecycle, 'raw'),
            eq(tcgSet.status, 'committed'),
            sql`${tcgBattlerEscrow.id} is null`
        ))

    const byCard = new Map<string, Holding>()
    for (const row of rows) {
        const existing = byCard.get(row.cardId)
        if (existing) {
            existing.copies += 1
            continue
        }
        const raw = row.raw as Record<string, unknown>
        // thepricedex pull-rate tier is the clean pricing vocabulary; the
        // rarity column mixes labels and sidecar codes across eras.
        const tier = (raw.pullRate as { tier?: string } | undefined)?.tier ?? row.rarity
        const spec = deriveUnit(row.cardId, raw, tier)
        if (!spec) continue
        byCard.set(row.cardId, {
            cardId: row.cardId,
            copies: 1,
            name: row.name,
            rarity: tier,
            spec,
            render: { bundle: row.bundle, plaatjesCardId: row.plaatjesCardId, assetNumber: row.assetNumber }
        })
    }
    return [...byCard.values()]
}

interface ItemHolding {
    cardId: string
    copies: number
    name: string
    rarity: string | null
    spec: BattlerItemSpec
    render: RunRender
}

/** The caller's draftable Trainers (§12.6) — same eligibility as units. */
export async function eligibleItemHoldings(userId: string): Promise<ItemHolding[]> {
    const rows = await db.select({
        cardId: tcgCard.id,
        name: tcgCard.name,
        rarity: tcgCard.rarity,
        raw: tcgCard.raw,
        copyId: tcgCopy.id,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber
    })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .innerJoin(tcgCard, eq(tcgPrinting.cardId, tcgCard.id))
        .innerJoin(tcgSet, eq(tcgCopy.setId, tcgSet.id))
        .leftJoin(tcgBattlerEscrow, eq(tcgBattlerEscrow.copyId, tcgCopy.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            eq(tcgCopy.lifecycle, 'raw'),
            eq(tcgSet.status, 'committed'),
            sql`${tcgBattlerEscrow.id} is null`
        ))
    const byCard = new Map<string, ItemHolding>()
    for (const row of rows) {
        const existing = byCard.get(row.cardId)
        if (existing) {
            existing.copies += 1
            continue
        }
        const raw = row.raw as Record<string, unknown>
        const tier = (raw.pullRate as { tier?: string } | undefined)?.tier ?? row.rarity
        const spec = deriveItem(row.cardId, raw, tier)
        if (!spec) continue
        byCard.set(row.cardId, {
            cardId: row.cardId,
            copies: 1,
            name: row.name,
            rarity: tier,
            spec,
            render: { bundle: row.bundle, plaatjesCardId: row.plaatjesCardId, assetNumber: row.assetNumber }
        })
    }
    return [...byCard.values()]
}

/** Finished runs, newest first — the win/lose history. */
export async function runHistory(userId: string, limit = 25) {
    return await db.select({
        id: tcgBattlerRun.id,
        state: tcgBattlerRun.state,
        round: tcgBattlerRun.round,
        wins: tcgBattlerRun.wins,
        losses: tcgBattlerRun.losses,
        deckName: tcgBattlerRun.deckName,
        createdAt: tcgBattlerRun.createdAt,
        finishedAt: tcgBattlerRun.finishedAt
    })
        .from(tcgBattlerRun)
        .where(and(eq(tcgBattlerRun.userId, userId), ne(tcgBattlerRun.state, 'active')))
        .orderBy(desc(tcgBattlerRun.createdAt))
        .limit(limit)
}

/** How many draftable cards the caller has — the pre-run screen number. */
export async function eligibleCount(userId: string): Promise<number> {
    return (await eligibleHoldings(userId)).length
}

// ── Run lifecycle ──────────────────────────────────────────────────────────

export async function startRun(userId: string, deckId: string | null = null) {
    let holdings = await eligibleHoldings(userId)
    let deckName: string | null = null
    if (deckId) {
        const deck = await getDeck(userId, deckId)
        const allowed = new Map(deck.cards.map(card => [card.cardId, card.copies]))
        // The deck caps copies: both the copies² draft weight and the merge
        // depth a drafted card enters with.
        holdings = holdings
            .filter(holding => allowed.has(holding.cardId))
            .map(holding => ({ ...holding, copies: Math.min(holding.copies, allowed.get(holding.cardId)!) }))
        deckName = deck.name
        if (holdings.length < 3) {
            badRequest('This deck has fewer than three battle-ready cards you own')
        }
    }
    if (holdings.length < 3) {
        badRequest('You need at least three battle-ready cards — open some modern packs first')
    }

    let itemHoldings = await eligibleItemHoldings(userId)
    if (deckId) {
        const deck = await getDeck(userId, deckId)
        const allowed = new Map(deck.cards.map(card => [card.cardId, card.copies]))
        itemHoldings = itemHoldings
            .filter(holding => allowed.has(holding.cardId))
            .map(holding => ({ ...holding, copies: Math.min(holding.copies, allowed.get(holding.cardId)!) }))
    }

    const secret = randomBytes(32).toString('hex')
    const rng = createBattlerRandom(runSeed(secret, 'draft'))
    const drafted = draftPool(holdings.map(holding => ({ cardId: holding.cardId, copies: holding.copies })), rng)
    const byCard = new Map(holdings.map(holding => [holding.cardId, holding]))
    const itemRng = createBattlerRandom(runSeed(secret, 'draft:items'))
    const draftedItems = draftPool(
        itemHoldings.map(holding => ({ cardId: holding.cardId, copies: holding.copies })),
        itemRng, BATTLER.draftItems, BATTLER.itemInstances
    )
    const itemByCard = new Map(itemHoldings.map(holding => [holding.cardId, holding]))

    const state: RunState = {
        pool: drafted.map((entry) => {
            const holding = byCard.get(entry.cardId)!
            return {
                cardId: entry.cardId,
                name: holding.name,
                rarity: holding.rarity,
                cost: unitCostFor(holding.rarity),
                instancesLeft: entry.instances,
                spec: holding.spec,
                render: holding.render
            }
        }),
        shop: [],
        board: [],
        itemPool: draftedItems.map((entry) => {
            const holding = itemByCard.get(entry.cardId)!
            return {
                cardId: entry.cardId,
                name: holding.name,
                rarity: holding.rarity,
                cost: itemCostFor(holding.rarity),
                instancesLeft: entry.instances,
                spec: holding.spec,
                render: holding.render
            }
        }),
        itemShop: [],
        stadium: null,
        freeRerolls: 0,
        nextBattle: { atk: 0, hp: 0 },
        repositionLeft: BATTLER.repositionBudget,
        rollCounter: 0,
        unitCounter: 0,
        lastBattle: null
    }
    rollShop(state, secret, 1, false)
    rollItemShop(state, secret, 1, false)

    try {
        const [run] = await db.insert(tcgBattlerRun).values({
            userId,
            secret,
            cash: BATTLER.cashFor(1),
            deckId,
            deckName,
            runState: state as unknown as Record<string, unknown>
        }).returning()
        return run!
    } catch (error) {
        const cause = (error as { cause?: { constraint?: string } }).cause
        if (cause?.constraint === 'tcg_battler_runs_active_unique') {
            throw createError({ statusCode: 409, statusMessage: 'A run is already active' })
        }
        throw error
    }
}

export async function abandonRun(userId: string, runId: string) {
    await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        await tx.delete(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, run.id))
        await tx.update(tcgBattlerRun)
            .set({ state: 'abandoned', finishedAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(tcgBattlerRun.id, run.id))
    })
}

// ── Shop mutations ─────────────────────────────────────────────────────────

/**
 * One eligible copy backs each purchased instance (§12.10) — oldest first,
 * locked, and refused when anything else already holds it. Returns the id;
 * the caller records it in the escrow table and the run state.
 */
async function escrowFreeCopy(tx: Tx, userId: string, cardId: string): Promise<string> {
    const escrowed = await tx.select({ copyId: tcgBattlerEscrow.copyId }).from(tcgBattlerEscrow)
    const taken = new Set(escrowed.map(row => row.copyId))
    const candidates = await tx.select({ id: tcgCopy.id })
        .from(tcgCopy)
        .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
        .where(and(
            eq(tcgCopy.ownerId, userId),
            eq(tcgCopy.lifecycle, 'raw'),
            eq(tcgPrinting.cardId, cardId)
        ))
        .orderBy(asc(tcgCopy.createdAt), asc(tcgCopy.id))
    const free = candidates.find(candidate => !taken.has(candidate.id))
    if (!free) badRequest('No free copy of that card to field')
    const locked = await lockCopyForUpdate(tx, free!.id)
    if (!locked || locked.ownerId !== userId || locked.lifecycle !== 'raw') {
        badRequest('No free copy of that card to field')
    }
    await assertUnencumbered(tx, free!.id)
    return free!.id
}

export async function buyUnit(userId: string, runId: string, offerIndex: number, attackId: number | null, position: number | null) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const offer = state.shop[offerIndex]
        if (!offer) badRequest('No such offer')
        const card = state.pool.find(entry => entry.cardId === offer!.cardId)
        if (!card || card.instancesLeft < 1) badRequest('No copies of that card left in the pool')
        if (run.cash < card!.cost) badRequest('Not enough Pokémon Dollars')

        const free = { id: await escrowFreeCopy(tx, userId, card!.cardId) }

        const existing = state.board.find(unit => unit.cardId === card!.cardId)
        if (existing) {
            if (existing.instances >= BATTLER.maxInstances) badRequest('That unit is already at full depth')
            existing.instances += 1
            existing.escrowCopyIds.push(free!.id)
        } else {
            if (state.board.length >= BATTLER.boardSlots) badRequest('The board is full')
            const usable = card!.spec.attacks
            const chosen = attackId !== null && usable.some(attack => attack.attackId === attackId)
                ? attackId
                : usable[0]!.attackId
            const occupied = new Set(state.board.map(unit => unit.position))
            let slot = position
            if (slot === null || slot < 0 || slot >= BATTLER.boardSlots || occupied.has(slot)) {
                slot = [...Array(BATTLER.boardSlots).keys()].find(index => !occupied.has(index))!
            }
            state.unitCounter += 1
            state.board.push({
                key: `u${state.unitCounter}`,
                cardId: card!.cardId,
                attackId: chosen,
                instances: 1,
                position: slot,
                escrowCopyIds: [free!.id],
                items: []
            })
        }
        card!.instancesLeft -= 1
        // A purchase consumes its shop tile — the slot stays empty until a
        // reroll or the next round refills the track. A depleted card takes
        // its duplicate tiles with it.
        state.shop.splice(offerIndex, 1)
        if (card!.instancesLeft === 0) {
            state.shop = state.shop.filter(offer => offer.cardId !== card!.cardId)
        }

        await tx.insert(tcgBattlerEscrow).values({ runId: run.id, copyId: free!.id })
        await saveState(tx, run.id, state, { cash: run.cash - card!.cost })
        return { ok: true as const }
    })
}

export async function sellUnit(userId: string, runId: string, unitKey: string) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const index = state.board.findIndex(unit => unit.key === unitKey)
        if (index === -1) badRequest('No such unit')
        const unit = state.board[index]!
        const card = state.pool.find(entry => entry.cardId === unit.cardId)
        if (card) card.instancesLeft += unit.instances
        let refund = card ? Math.max(0, card.cost - 1) * unit.instances : 0
        // Attached tools come off with the unit and refund too.
        const releasedCopyIds = [...unit.escrowCopyIds]
        for (const attached of unit.items) {
            const item = state.itemPool.find(entry => entry.cardId === attached.cardId)
            if (item) {
                item.instancesLeft += 1
                refund += BATTLER.sellRefund(item.cost)
            }
            releasedCopyIds.push(attached.escrowCopyId)
        }
        state.board.splice(index, 1)
        if (releasedCopyIds.length > 0) {
            await tx.delete(tcgBattlerEscrow)
                .where(and(eq(tcgBattlerEscrow.runId, run.id), inArray(tcgBattlerEscrow.copyId, releasedCopyIds)))
        }
        await saveState(tx, run.id, state, { cash: run.cash + refund })
        return { ok: true as const, refund }
    })
}

export async function rerollShop(userId: string, runId: string) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const free = state.freeRerolls > 0
        if (!free && run.cash < BATTLER.rerollCost) badRequest('Not enough Pokémon Dollars')
        if (free) state.freeRerolls -= 1
        rollShop(state, run.secret, run.round, true)
        rollItemShop(state, run.secret, run.round, true)
        await saveState(tx, run.id, state, { cash: free ? run.cash : run.cash - BATTLER.rerollCost })
        return { ok: true as const }
    })
}

export async function buyItem(userId: string, runId: string, offerIndex: number, targetUnitKey: string | null) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const offer = state.itemShop[offerIndex]
        if (!offer) badRequest('No such offer')
        const item = state.itemPool.find(entry => entry.cardId === offer!.cardId)
        if (!item || item.instancesLeft < 1) badRequest('No copies of that Trainer left in the pool')
        if (run.cash < item!.cost) badRequest('Not enough Pokémon Dollars')

        let cash = run.cash - item!.cost
        const subtype = item!.spec.subtype
        if (subtype === 'tool') {
            const unit = state.board.find(entry => entry.key === targetUnitKey)
            if (!unit) badRequest('Pick a unit to hold the item')
            if (unit!.items.length >= 1) badRequest('That unit already holds an item')
            const copyId = await escrowFreeCopy(tx, userId, item!.cardId)
            await tx.insert(tcgBattlerEscrow).values({ runId: run.id, copyId })
            unit!.items.push({ cardId: item!.cardId, name: item!.name, escrowCopyId: copyId })
        } else if (subtype === 'stadium') {
            if (state.stadium) badRequest('A Stadium is already in play — sell it first')
            const copyId = await escrowFreeCopy(tx, userId, item!.cardId)
            await tx.insert(tcgBattlerEscrow).values({ runId: run.id, copyId })
            state.stadium = { cardId: item!.cardId, name: item!.name, escrowCopyId: copyId }
        } else {
            // Supporter: consumed on the spot. The copy stays escrowed until
            // the run ends — nothing is destroyed (§12.6).
            const copyId = await escrowFreeCopy(tx, userId, item!.cardId)
            await tx.insert(tcgBattlerEscrow).values({ runId: run.id, copyId })
            const effect = item!.spec.consume ?? {}
            cash += effect.cash ?? 0
            state.freeRerolls += effect.freeRerolls ?? 0
            if (effect.reposition) state.repositionLeft = BATTLER.repositionBudget
            state.nextBattle.atk += effect.teamAtk ?? 0
            state.nextBattle.hp += effect.teamHp ?? 0
        }

        item!.instancesLeft -= 1
        state.itemShop.splice(offerIndex, 1)
        if (item!.instancesLeft === 0) {
            state.itemShop = state.itemShop.filter(entry => entry.cardId !== item!.cardId)
        }
        await saveState(tx, run.id, state, { cash })
        return { ok: true as const }
    })
}

/** Sell an attached tool (by holder unit) or the Stadium back to the pool. */
export async function sellItem(userId: string, runId: string, target: { unitKey?: string, stadium?: boolean }) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        let sold: { cardId: string, escrowCopyId: string } | null = null
        if (target.stadium) {
            if (!state.stadium) badRequest('No Stadium in play')
            sold = state.stadium!
            state.stadium = null
        } else {
            const unit = state.board.find(entry => entry.key === target.unitKey)
            if (!unit || unit.items.length === 0) badRequest('No item to sell there')
            sold = unit!.items.pop()!
        }
        const item = state.itemPool.find(entry => entry.cardId === sold!.cardId)
        if (item) item.instancesLeft += 1
        const refund = item ? BATTLER.sellRefund(item.cost) : 0
        await tx.delete(tcgBattlerEscrow)
            .where(and(eq(tcgBattlerEscrow.runId, run.id), eq(tcgBattlerEscrow.copyId, sold!.escrowCopyId)))
        await saveState(tx, run.id, state, { cash: run.cash + refund })
        return { ok: true as const, refund }
    })
}

export async function toggleFreeze(userId: string, runId: string, offerIndex: number) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const offer = state.shop[offerIndex]
        if (!offer) badRequest('No such offer')
        offer!.frozen = !offer!.frozen
        await saveState(tx, run.id, state)
        return { ok: true as const, frozen: offer!.frozen }
    })
}

export async function moveUnit(userId: string, runId: string, unitKey: string, position: number) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const unit = state.board.find(entry => entry.key === unitKey)
        if (!unit) badRequest('No such unit')
        if (!Number.isInteger(position) || position < 0 || position >= BATTLER.boardSlots) {
            badRequest('Invalid position')
        }
        const card = state.pool.find(entry => entry.cardId === unit!.cardId)
        const cost = card?.spec.retreat ?? 1
        if (state.repositionLeft < cost) badRequest('Not enough reposition points — heavy units are anchors')
        const occupant = state.board.find(entry => entry.position === position)
        if (occupant && occupant.key !== unit!.key) {
            // Swap: the displaced unit slides into the vacated slot for free.
            occupant.position = unit!.position
        }
        unit!.position = position
        state.repositionLeft -= cost
        await saveState(tx, run.id, state)
        return { ok: true as const, repositionLeft: state.repositionLeft }
    })
}

// ── The fight ──────────────────────────────────────────────────────────────

function boardToBattleUnits(state: RunState, withBuffs = false): (BattleUnit & { render: RunRender })[] {
    return [...state.board]
        .sort((a, b) => a.position - b.position)
        .map((unit) => {
            const items: BattleItem[] = unit.items.map((attached) => {
                const item = state.itemPool.find(entry => entry.cardId === attached.cardId)
                return { name: attached.name, effect: item?.spec.attach ?? {} }
            })
            if (withBuffs && (state.nextBattle.atk > 0 || state.nextBattle.hp > 0)) {
                items.push({ name: 'Supporter', effect: { atk: state.nextBattle.atk, hp: state.nextBattle.hp } })
            }
            const card = state.pool.find(entry => entry.cardId === unit.cardId)!
            return {
                key: unit.key,
                spec: card.spec,
                attackId: unit.attackId,
                instances: unit.instances,
                items,
                render: card.render
            }
        })
}

/** The stadium effect a run currently fields, if any. */
function stadiumOf(state: RunState): { name: string, effect: BattlerStadiumEffect } | null {
    if (!state.stadium) return null
    const item = state.itemPool.find(entry => entry.cardId === state.stadium!.cardId)
    return item?.spec.stadium ? { name: item.name, effect: item.spec.stadium } : null
}

/** Catalog for generated opponents: eligible cards across committed sets. */
async function opponentCatalog(): Promise<{ spec: BattlerUnitSpec, render: RunRender }[]> {
    const rows = await db.select({
        cardId: tcgCard.id,
        raw: tcgCard.raw,
        rarity: tcgCard.rarity,
        bundle: tcgPrinting.bundle,
        plaatjesCardId: tcgPrinting.plaatjesCardId,
        assetNumber: tcgPrinting.assetNumber
    })
        .from(tcgCard)
        .innerJoin(tcgSet, eq(tcgCard.setId, tcgSet.id))
        .innerJoin(tcgPrinting, and(eq(tcgPrinting.cardId, tcgCard.id), eq(tcgPrinting.finish, 'nonholo')))
        .where(eq(tcgSet.status, 'committed'))
        .limit(400)
    const catalog: { spec: BattlerUnitSpec, render: RunRender }[] = []
    const seen = new Set<string>()
    for (const row of rows) {
        if (seen.has(row.cardId)) continue
        seen.add(row.cardId)
        const spec = deriveUnit(row.cardId, row.raw as Record<string, unknown>, row.rarity)
        if (!spec) continue
        catalog.push({
            spec,
            render: { bundle: row.bundle, plaatjesCardId: row.plaatjesCardId, assetNumber: row.assetNumber }
        })
    }
    return catalog
}

/**
 * Move both ratings for a fight against a real snapshot. Rows are locked in
 * user-id order so two concurrent fights over the same players cannot
 * deadlock; the deltas are negations, so the rating pool is conserved.
 */
async function applyElo(tx: Tx, attackerId: string, defenderId: string, result: 'win' | 'loss' | 'draw') {
    await tx.insert(tcgBattlerRating)
        .values([{ userId: attackerId }, { userId: defenderId }])
        .onConflictDoNothing()
    const rows = await tx.select().from(tcgBattlerRating)
        .where(inArray(tcgBattlerRating.userId, [attackerId, defenderId]))
        .orderBy(asc(tcgBattlerRating.userId))
        .for('update')
    const mine = rows.find(row => row.userId === attackerId)!
    const theirs = rows.find(row => row.userId === defenderId)!
    const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0
    const delta = eloDelta(mine.rating, theirs.rating, score)
    await tx.update(tcgBattlerRating)
        .set({ rating: mine.rating + delta, fights: mine.fights + 1, updatedAt: sql`now()` })
        .where(eq(tcgBattlerRating.userId, attackerId))
    await tx.update(tcgBattlerRating)
        .set({ rating: theirs.rating - delta, fights: theirs.fights + 1, updatedAt: sql`now()` })
        .where(eq(tcgBattlerRating.userId, defenderId))
    return { rating: mine.rating + delta, delta }
}

export interface FightResult {
    result: 'win' | 'loss' | 'draw'
    seed: number
    myBoard: (BattleUnit & { render: RunRender })[]
    opponent: SerializedOpponent
    /** The stadium that governed the battle — the defender's holds (§12.6). */
    stadium: { name: string, effect: BattlerStadiumEffect, source: 'mine' | 'theirs' } | null
    /** Rating movement — null for wild-trainer fights (never rated). */
    elo: { rating: number, delta: number } | null
    replay: BattleReplay
    run: { state: string, round: number, wins: number, losses: number, cash: number }
}

export async function fight(userId: string, runId: string): Promise<FightResult> {
    // The opponent pick and catalog read happen before the transaction —
    // never hold the run lock across the wider table scans.
    const [run] = await db.select().from(tcgBattlerRun)
        .where(and(eq(tcgBattlerRun.id, runId), eq(tcgBattlerRun.userId, userId)))
    if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
    if (run.state !== 'active') badRequest('Run is over')
    const preState = stateOf(run)
    if (preState.board.length === 0) badRequest('Field at least one unit before fighting')

    const seed = runSeed(run.secret, `battle:${run.round}`)
    const rng = createBattlerRandom(seed)

    const snapshots = await db.select().from(tcgBattlerSnapshot)
        .where(and(eq(tcgBattlerSnapshot.round, run.round), ne(tcgBattlerSnapshot.userId, userId)))
        .limit(50)
    let opponent: SerializedOpponent
    let defenderId: string | null = null
    if (snapshots.length > 0) {
        const chosen = rng.pick(snapshots)
        defenderId = chosen.userId
        const [owner] = await db.select({ name: sql<string>`(select name from "user" where id = ${chosen.userId})` })
            .from(tcgBattlerSnapshot).where(eq(tcgBattlerSnapshot.id, chosen.id))
        // Snapshots from before items were a bare board array.
        const raw = chosen.board as unknown
        const wrapped = Array.isArray(raw)
            ? { units: raw as (BattleUnit & { render: RunRender })[], stadium: null }
            : raw as { units: (BattleUnit & { render: RunRender })[], stadium: { name: string, effect: BattlerStadiumEffect } | null }
        opponent = {
            name: owner?.name ?? 'A trainer',
            board: wrapped.units,
            stadium: wrapped.stadium ?? null
        }
    } else {
        const catalog = await opponentCatalog()
        const generated = generateBoard(run.round, catalog.map(entry => entry.spec), rng)
        const renderBySpec = new Map(catalog.map(entry => [entry.spec, entry.render]))
        opponent = {
            name: 'Wild trainer',
            board: generated.map(unit => ({
                ...unit,
                render: renderBySpec.get(unit.spec) ?? { bundle: null, plaatjesCardId: null, assetNumber: null }
            }))
        }
    }

    return await db.transaction(async (tx) => {
        const locked = await lockRun(tx, userId, runId)
        if (locked.round !== run.round) badRequest('The round already resolved')
        const state = stateOf(locked)

        const myBoard = boardToBattleUnits(state, true)
        const myStadium = stadiumOf(state)
        // On conflict the defender's Stadium holds (§12.6) — the snapshot is
        // the defender here.
        const governing = opponent.stadium
            ? { ...opponent.stadium, source: 'theirs' as const }
            : myStadium ? { ...myStadium, source: 'mine' as const } : null
        const replay = simulateBattle(myBoard, opponent.board, seed, governing?.effect ?? null)
        const result: 'win' | 'loss' | 'draw' = replay.result === 'a' ? 'win' : replay.result === 'b' ? 'loss' : 'draw'
        const elo = defenderId ? await applyElo(tx, userId, defenderId, result) : null

        const wins = locked.wins + (result === 'win' ? 1 : 0)
        const losses = locked.losses + (result === 'loss' ? 1 : 0)
        const finished = losses >= BATTLER.maxLosses || wins >= BATTLER.winsToComplete
        const nextRound = locked.round + 1

        await tx.insert(tcgBattlerSnapshot).values({
            userId,
            runId: locked.id,
            round: locked.round,
            board: { units: myBoard, stadium: myStadium } as unknown as Record<string, unknown>[]
        })

        state.lastBattle = { round: locked.round, opponent, seed, result }
        state.nextBattle = { atk: 0, hp: 0 }
        state.repositionLeft = BATTLER.repositionBudget
        if (!finished) {
            rollShop(state, locked.secret, nextRound, true)
            rollItemShop(state, locked.secret, nextRound, true)
        }

        if (finished) {
            await tx.delete(tcgBattlerEscrow).where(eq(tcgBattlerEscrow.runId, locked.id))
            await saveState(tx, locked.id, state, {
                wins,
                losses,
                state: wins >= BATTLER.winsToComplete ? 'won' : 'lost',
                finishedAt: new Date()
            })
        } else {
            await saveState(tx, locked.id, state, {
                wins,
                losses,
                round: nextRound,
                cash: BATTLER.cashFor(nextRound)
            })
        }

        return {
            result,
            seed,
            myBoard,
            opponent,
            stadium: governing,
            elo,
            replay,
            run: {
                state: finished ? (wins >= BATTLER.winsToComplete ? 'won' : 'lost') : 'active',
                round: finished ? locked.round : nextRound,
                wins,
                losses,
                cash: finished ? 0 : BATTLER.cashFor(nextRound)
            }
        }
    })
}

// ── Read model ─────────────────────────────────────────────────────────────

export async function runView(userId: string) {
    const [run] = await db.select().from(tcgBattlerRun)
        .where(and(eq(tcgBattlerRun.userId, userId), eq(tcgBattlerRun.state, 'active')))
    const [ratingRow] = await db.select().from(tcgBattlerRating).where(eq(tcgBattlerRating.userId, userId))
    const rating = ratingRow ? { rating: ratingRow.rating, fights: ratingRow.fights } : null
    if (!run) {
        return {
            run: null,
            rating,
            eligibleCards: await eligibleCount(userId),
            eligibleItems: (await eligibleItemHoldings(userId)).length
        }
    }
    // The secret must never leave the server (a known seed scouts the shop).
    const { secret: _secret, ...safe } = run
    return { run: { ...safe, runState: stateOf(run) }, rating, eligibleCards: null }
}
