/**
 * Traits on the server (`traits.md`, `shared/utils/hero-quest/traits.ts`): the live board, the
 * payload the scene draws, and the four mutations — roll, lock, store and load.
 *
 * Every mutation is **lock-then-read** on the `hq_state` row: it takes the row with `FOR UPDATE`,
 * reads the board under it, and spends Trait Gems with a guarded decrement (`trait_gems >= cost`)
 * in the same transaction. Two rolls at once queue on the lock, so each prices its own board and
 * pays for it once; a burst can never spend past zero or roll a slot that was locked in between.
 * Nothing here takes a raid row, so the lock order raids rely on (raid row, then `hq_state`) is
 * never inverted.
 */

import { and, eq, gte, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '#server/database'
import { hqState, hqTraitSaveSlots, hqTraitSlots } from '#server/database/schema'
import { getShopLevels, getTraitBoard, type HqStateRow } from '#server/utils/hero-quest'
import {
    MAX_TRAIT_SAVE_SLOTS,
    TRAIT_SAVE_LOAD_COST,
    TRAIT_SET_TIERS,
    TRAIT_SLOT_COUNT
} from '#shared/utils/hero-quest/constants'
import { TRAIT_SETS, getTraitSet, getTraitStat } from '#shared/utils/hero-quest/content/traits'
import { shopTrackCost } from '#shared/utils/hero-quest/content/shop'
import {
    activeTraitSets,
    autoRollTraitBoard,
    canRollTraits,
    lockedCount,
    rerollTraitBoard,
    traitRollCost,
    traitRollsOf,
    traitSaveSlotsAt,
    traitSetCounts,
    traitSlotOf,
    traitValue,
    type TraitBoard,
    type TraitSlotState
} from '#shared/utils/hero-quest/traits'
import type { TraitGrade } from '#shared/utils/hero-quest/types'
import { randomFloat } from '#shared/utils/random'

type TraitSaveRow = typeof hqTraitSaveSlots.$inferSelect

export async function getTraitSaves(userId: string, tx: DbExecutor = db): Promise<TraitSaveRow[]> {
    return tx.select().from(hqTraitSaveSlots).where(eq(hqTraitSaveSlots.userId, userId))
}

/** A stored board, slot by slot; null when any slot no longer reads as a Trait. */
function savedBoardOf(row: TraitSaveRow): TraitSlotState[] | null {
    const slots = Array.from({ length: TRAIT_SLOT_COUNT }, (_, i) => traitSlotOf(row.snapshot[i]))
    return slots.every(slot => slot !== null) ? slots as TraitSlotState[] : null
}

/** One slot as the scene shows it. */
function slotView(slot: TraitSlotState | null) {
    if (!slot) return null
    return {
        stat: slot.stat,
        statName: getTraitStat(slot.stat).name,
        grade: slot.grade,
        set: slot.set,
        setName: getTraitSet(slot.set).name,
        /** The stat's value at its grade, a fraction. */
        value: traitValue(slot.stat, slot.grade),
        locked: slot.locked
    }
}

/**
 * The Traits scene's payload: the board, the price of a Roll, every Set's count and tier, and the
 * save slots. Derived values only, so the client holds no table.
 */
export function serializeTraits(
    state: HqStateRow,
    board: TraitBoard,
    saves: readonly TraitSaveRow[],
    shopLevels: Record<string, number>
) {
    const rolls = traitRollsOf(board)
    const counts = traitSetCounts(rolls)
    const active = new Map(activeTraitSets(rolls).map(bonus => [bonus.set, bonus]))
    const unlocked = traitSaveSlotsAt(shopLevels.traitSaveSlots ?? 0)
    const saved = new Map(saves.map(row => [row.saveSlotIndex, row]))
    return {
        traitGems: state.traitGems,
        slots: board.map(slotView),
        locked: lockedCount(board),
        rollCost: traitRollCost(lockedCount(board)),
        canRoll: canRollTraits(board),
        sets: TRAIT_SETS.map(set => ({
            id: set.id,
            name: set.name,
            effect: set.effect,
            pieces: counts[set.id],
            /** The tier reached, 0-based; null below the first count. */
            tier: active.get(set.id)?.tier ?? null,
            tiers: TRAIT_SET_TIERS[set.id].map(t => ({ pieces: t.pieces, magnitude: t.magnitude }))
        })),
        saves: {
            unlocked,
            max: MAX_TRAIT_SAVE_SLOTS,
            /** Gems for the next save slot; null once all four are owned. */
            nextSlotCostGems: shopTrackCost('traitSaveSlots', shopLevels.traitSaveSlots ?? 0),
            /** Trait Gems a store or a load costs. */
            cost: TRAIT_SAVE_LOAD_COST,
            slots: Array.from({ length: MAX_TRAIT_SAVE_SLOTS }, (_, index) => {
                const row = index < unlocked ? saved.get(index) : undefined
                const stored = row ? savedBoardOf(row) : null
                return { index, unlocked: index < unlocked, slots: stored ? stored.map(slotView) : null }
            })
        }
    }
}

export type TraitsPayload = ReturnType<typeof serializeTraits>

/** The `hq_state` row, locked for the rest of the transaction. */
async function lockState(tx: DbExecutor, userId: string): Promise<HqStateRow> {
    const [state] = await tx.select().from(hqState).where(eq(hqState.userId, userId)).for('update')
    if (!state) throw createError({ statusCode: 400, statusMessage: 'No Hero Quest run' })
    return state
}

/** Spend Trait Gems under the guard, returning the balance left; throws when short. */
async function spendTraitGems(tx: DbExecutor, userId: string, cost: number): Promise<number> {
    const [paid] = await tx.update(hqState)
        .set({ traitGems: sql`${hqState.traitGems} - ${cost}` })
        .where(and(eq(hqState.userId, userId), gte(hqState.traitGems, cost)))
        .returning({ traitGems: hqState.traitGems })
    if (!paid) throw createError({ statusCode: 400, statusMessage: 'Not enough Trait Gems' })
    return paid.traitGems
}

/** Write slots to the live board, by index. */
async function writeSlots(tx: DbExecutor, userId: string, slots: readonly { index: number, slot: TraitSlotState }[]) {
    for (const { index, slot } of slots) {
        const values = { stat: slot.stat, grade: slot.grade, setId: slot.set, locked: slot.locked }
        await tx.insert(hqTraitSlots)
            .values({ userId, slotIndex: index, ...values })
            .onConflictDoUpdate({ target: [hqTraitSlots.userId, hqTraitSlots.slotIndex], set: values })
    }
}

/**
 * Roll: every unlocked slot rerolls at once, for `5 + locked × 5` Trait Gems (§2). With all five
 * locked it is a no-op, refused rather than charged. Call it inside a transaction.
 */
export async function rollTraits(tx: DbExecutor, userId: string, rng: () => number = randomFloat) {
    await lockState(tx, userId)
    const board = await getTraitBoard(userId, tx)
    if (!canRollTraits(board)) throw createError({ statusCode: 400, statusMessage: 'Every slot is locked' })

    const cost = traitRollCost(lockedCount(board))
    const traitGems = await spendTraitGems(tx, userId, cost)
    const next = rerollTraitBoard(board, rng)
    // locked slots come back as they were, so only the rest are written
    await writeSlots(tx, userId, next.flatMap((slot, index) => board[index]?.locked ? [] : [{ index, slot }]))
    return { spent: cost, traitGems, slots: next.map(slotView) }
}

/**
 * One Auto Roll batch: Roll until a rerolled slot lands at `minGrade` or better, the Trait Gems run
 * short, or `TRAIT_AUTO_ROLL_BATCH` have gone, when the client asks for the next. Every Roll is priced as a single one. The whole run is
 * worked out under the `hq_state` lock against the balance read inside it, then paid in one guarded
 * decrement and written once, so a burst queues and each pays for its own run. Call it inside a
 * transaction.
 */
export async function autoRollTraits(tx: DbExecutor, userId: string, minGrade: TraitGrade, rng: () => number = randomFloat) {
    const state = await lockState(tx, userId)
    const board = await getTraitBoard(userId, tx)
    if (!canRollTraits(board)) throw createError({ statusCode: 400, statusMessage: 'Every slot is locked' })

    const run = autoRollTraitBoard(board, state.traitGems, minGrade, undefined, rng)
    if (run.rolls === 0) throw createError({ statusCode: 400, statusMessage: 'Not enough Trait Gems' })
    const traitGems = await spendTraitGems(tx, userId, run.spent)
    await writeSlots(tx, userId, run.board.flatMap((slot, index) => !slot || board[index]?.locked ? [] : [{ index, slot }]))
    return { rolls: run.rolls, spent: run.spent, stoppedBy: run.stoppedBy, traitGems, slots: run.board.map(slotView) }
}

/** Lock or unlock a rolled slot: free and unlimited (§3). An empty slot has nothing to protect. */
export async function setTraitLock(tx: DbExecutor, userId: string, slotIndex: number, locked: boolean) {
    // under the same lock a roll takes, so a lock landing mid-roll waits for it rather than racing it
    await lockState(tx, userId)
    const [row] = await tx.update(hqTraitSlots)
        .set({ locked })
        .where(and(eq(hqTraitSlots.userId, userId), eq(hqTraitSlots.slotIndex, slotIndex)))
        .returning()
    if (!row) throw createError({ statusCode: 400, statusMessage: 'Roll your Traits first' })
    return { slotIndex, locked: row.locked }
}

/** Whether a save slot index is one this account owns. */
async function assertSaveSlot(tx: DbExecutor, userId: string, saveSlotIndex: number) {
    const unlocked = traitSaveSlotsAt((await getShopLevels(userId, tx)).traitSaveSlots ?? 0)
    if (saveSlotIndex >= unlocked) {
        throw createError({ statusCode: 400, statusMessage: `Only ${unlocked} Trait save slot${unlocked === 1 ? '' : 's'} unlocked` })
    }
}

/**
 * Store the live board, all five slots and their locks, in a save slot, for 100 Trait Gems (§6).
 * Overwrites what the slot held. Call it inside a transaction.
 */
export async function storeTraitBoard(tx: DbExecutor, userId: string, saveSlotIndex: number) {
    await lockState(tx, userId)
    await assertSaveSlot(tx, userId, saveSlotIndex)
    const board = await getTraitBoard(userId, tx)
    if (board.some(slot => slot === null)) throw createError({ statusCode: 400, statusMessage: 'Roll your Traits first' })

    const traitGems = await spendTraitGems(tx, userId, TRAIT_SAVE_LOAD_COST)
    const snapshot = (board as TraitSlotState[]).map(slot => ({ stat: slot.stat, grade: slot.grade, set: slot.set, locked: slot.locked }))
    await tx.insert(hqTraitSaveSlots)
        .values({ userId, saveSlotIndex, snapshot })
        .onConflictDoUpdate({
            target: [hqTraitSaveSlots.userId, hqTraitSaveSlots.saveSlotIndex],
            set: { snapshot, updatedAt: new Date() }
        })
    return { saveSlotIndex, spent: TRAIT_SAVE_LOAD_COST, traitGems }
}

/**
 * Load a save slot onto the live board, all five slots and their locks, for 100 Trait Gems (§6).
 * The save slot keeps what it holds. Call it inside a transaction.
 */
export async function loadTraitBoard(tx: DbExecutor, userId: string, saveSlotIndex: number) {
    await lockState(tx, userId)
    await assertSaveSlot(tx, userId, saveSlotIndex)
    const [row] = await tx.select().from(hqTraitSaveSlots)
        .where(and(eq(hqTraitSaveSlots.userId, userId), eq(hqTraitSaveSlots.saveSlotIndex, saveSlotIndex)))
    if (!row) throw createError({ statusCode: 400, statusMessage: 'Nothing is stored in that slot' })
    const stored = savedBoardOf(row)
    if (!stored) throw createError({ statusCode: 400, statusMessage: 'That board can no longer be loaded' })

    const traitGems = await spendTraitGems(tx, userId, TRAIT_SAVE_LOAD_COST)
    await writeSlots(tx, userId, stored.map((slot, index) => ({ index, slot })))
    return { saveSlotIndex, spent: TRAIT_SAVE_LOAD_COST, traitGems, slots: stored.map(slotView) }
}
