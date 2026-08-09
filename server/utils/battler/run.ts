import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '#server/database'
import { tcgBattlerRun, tcgBattlerEscrow, tcgBattlerSnapshot, tcgCopy, tcgCard, tcgPrinting, tcgSet } from '#server/database/schema'
import { deriveKey } from '#server/utils/tcg/feistel'
import { lockCopyForUpdate, assertUnencumbered } from '#server/utils/tcg/market'
import { createBattlerRandom } from '#shared/utils/battler/rng'
import { deriveUnit } from '#shared/utils/battler/unit'
import type { BattlerUnitSpec } from '#shared/utils/battler/unit'
import { BATTLER, unitCostFor } from '#shared/utils/battler/shop'
import { draftPool } from '#shared/utils/battler/draft'
import { simulateBattle } from '#shared/utils/battler/combat'
import type { BattleUnit, BattleReplay } from '#shared/utils/battler/combat'
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
}

export interface RunShopOffer {
    cardId: string
    frozen: boolean
}

export interface SerializedOpponent {
    name: string
    board: (BattleUnit & { render: RunRender })[]
}

export interface RunState {
    pool: RunPoolCard[]
    shop: RunShopOffer[]
    board: RunBoardUnit[]
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
    return run.runState as RunState
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
    const available = state.pool.filter(card => card.instancesLeft > 0)
    const offers: RunShopOffer[] = [...kept]
    while (offers.length < width && available.length > 0) {
        offers.push({ cardId: rng.pick(available).cardId, frozen: false })
    }
    state.shop = offers
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
async function eligibleHoldings(userId: string): Promise<Holding[]> {
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
        const spec = deriveUnit(row.cardId, raw)
        if (!spec) continue
        // thepricedex pull-rate tier is the clean pricing vocabulary; the
        // rarity column mixes labels and sidecar codes across eras.
        const tier = (raw.pullRate as { tier?: string } | undefined)?.tier ?? row.rarity
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

/** How many draftable cards the caller has — the pre-run screen number. */
export async function eligibleCount(userId: string): Promise<number> {
    return (await eligibleHoldings(userId)).length
}

// ── Run lifecycle ──────────────────────────────────────────────────────────

export async function startRun(userId: string) {
    const holdings = await eligibleHoldings(userId)
    if (holdings.length < 3) {
        badRequest('You need at least three battle-ready cards — open some modern packs first')
    }

    const secret = randomBytes(32).toString('hex')
    const rng = createBattlerRandom(runSeed(secret, 'draft'))
    const drafted = draftPool(holdings.map(holding => ({ cardId: holding.cardId, copies: holding.copies })), rng)
    const byCard = new Map(holdings.map(holding => [holding.cardId, holding]))

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
        repositionLeft: BATTLER.repositionBudget,
        rollCounter: 0,
        unitCounter: 0,
        lastBattle: null
    }
    rollShop(state, secret, 1, false)

    try {
        const [run] = await db.insert(tcgBattlerRun).values({
            userId,
            secret,
            cash: BATTLER.cashFor(1),
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

export async function buyUnit(userId: string, runId: string, offerIndex: number, attackId: number | null, position: number | null) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        const state = stateOf(run)
        const offer = state.shop[offerIndex]
        if (!offer) badRequest('No such offer')
        const card = state.pool.find(entry => entry.cardId === offer!.cardId)
        if (!card || card.instancesLeft < 1) badRequest('No copies of that card left in the pool')
        if (run.cash < card!.cost) badRequest('Not enough Pokémon Dollars')

        // One eligible copy backs each instance (§12.10) — oldest first,
        // locked, and refused when anything else already holds it.
        const escrowed = await tx.select({ copyId: tcgBattlerEscrow.copyId }).from(tcgBattlerEscrow)
        const taken = new Set(escrowed.map(row => row.copyId))
        const candidates = await tx.select({ id: tcgCopy.id })
            .from(tcgCopy)
            .innerJoin(tcgPrinting, eq(tcgCopy.printingId, tcgPrinting.id))
            .where(and(
                eq(tcgCopy.ownerId, userId),
                eq(tcgCopy.lifecycle, 'raw'),
                eq(tcgPrinting.cardId, card!.cardId)
            ))
            .orderBy(asc(tcgCopy.createdAt), asc(tcgCopy.id))
        const free = candidates.find(candidate => !taken.has(candidate.id))
        if (!free) badRequest('No free copy of that card to field')
        const locked = await lockCopyForUpdate(tx, free!.id)
        if (!locked || locked.ownerId !== userId || locked.lifecycle !== 'raw') {
            badRequest('No free copy of that card to field')
        }
        await assertUnencumbered(tx, free!.id)

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
                escrowCopyIds: [free!.id]
            })
        }
        card!.instancesLeft -= 1

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
        const refund = card ? Math.max(0, card.cost - 1) * unit.instances : 0
        state.board.splice(index, 1)
        if (unit.escrowCopyIds.length > 0) {
            await tx.delete(tcgBattlerEscrow)
                .where(and(eq(tcgBattlerEscrow.runId, run.id), inArray(tcgBattlerEscrow.copyId, unit.escrowCopyIds)))
        }
        await saveState(tx, run.id, state, { cash: run.cash + refund })
        return { ok: true as const, refund }
    })
}

export async function rerollShop(userId: string, runId: string) {
    return await db.transaction(async (tx) => {
        const run = await lockRun(tx, userId, runId)
        if (run.cash < BATTLER.rerollCost) badRequest('Not enough Pokémon Dollars')
        const state = stateOf(run)
        rollShop(state, run.secret, run.round, true)
        await saveState(tx, run.id, state, { cash: run.cash - BATTLER.rerollCost })
        return { ok: true as const }
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

function boardToBattleUnits(state: RunState): (BattleUnit & { render: RunRender })[] {
    return [...state.board]
        .sort((a, b) => a.position - b.position)
        .map((unit) => {
            const card = state.pool.find(entry => entry.cardId === unit.cardId)!
            return {
                key: unit.key,
                spec: card.spec,
                attackId: unit.attackId,
                instances: unit.instances,
                render: card.render
            }
        })
}

/** Catalog for generated opponents: eligible cards across committed sets. */
async function opponentCatalog(): Promise<{ spec: BattlerUnitSpec, render: RunRender }[]> {
    const rows = await db.select({
        cardId: tcgCard.id,
        raw: tcgCard.raw,
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
        const spec = deriveUnit(row.cardId, row.raw as Record<string, unknown>)
        if (!spec) continue
        catalog.push({
            spec,
            render: { bundle: row.bundle, plaatjesCardId: row.plaatjesCardId, assetNumber: row.assetNumber }
        })
    }
    return catalog
}

export interface FightResult {
    result: 'win' | 'loss' | 'draw'
    seed: number
    myBoard: (BattleUnit & { render: RunRender })[]
    opponent: SerializedOpponent
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
    if (snapshots.length > 0) {
        const chosen = rng.pick(snapshots)
        const [owner] = await db.select({ name: sql<string>`(select name from "user" where id = ${chosen.userId})` })
            .from(tcgBattlerSnapshot).where(eq(tcgBattlerSnapshot.id, chosen.id))
        opponent = {
            name: owner?.name ?? 'A trainer',
            board: chosen.board as unknown as (BattleUnit & { render: RunRender })[]
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

        const myBoard = boardToBattleUnits(state)
        const replay = simulateBattle(myBoard, opponent.board, seed)
        const result: 'win' | 'loss' | 'draw' = replay.result === 'a' ? 'win' : replay.result === 'b' ? 'loss' : 'draw'

        const wins = locked.wins + (result === 'win' ? 1 : 0)
        const losses = locked.losses + (result === 'loss' ? 1 : 0)
        const finished = losses >= BATTLER.maxLosses || wins >= BATTLER.winsToComplete
        const nextRound = locked.round + 1

        await tx.insert(tcgBattlerSnapshot).values({
            userId,
            runId: locked.id,
            round: locked.round,
            board: myBoard as unknown as Record<string, unknown>[]
        })

        state.lastBattle = { round: locked.round, opponent, seed, result }
        state.repositionLeft = BATTLER.repositionBudget
        if (!finished) rollShop(state, locked.secret, nextRound, true)

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
    if (!run) {
        return { run: null, eligibleCards: await eligibleCount(userId) }
    }
    // The secret must never leave the server (a known seed scouts the shop).
    const { secret: _secret, ...safe } = run
    return { run: { ...safe, runState: stateOf(run) }, eligibleCards: null }
}
