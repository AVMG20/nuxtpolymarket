/**
 * Traits (`traits.md`): five party-wide slots, each rolling a stat, a grade and a Set.
 *
 * - **Roll** (§2): one action rerolls every unlocked slot at once, three independent rolls a slot.
 *   Stat and Set are uniform; the grade is the one weighted axis.
 * - **Lock** (§3): free; a locked slot keeps what it holds through a Roll. A Roll costs more the
 *   more is locked, so broad gambles are cheap and surgical ones dear.
 * - **Sets** (§5): counted across the five slots whatever they rolled. A tier is the total at its
 *   count, not a step added to the last, and several Sets can be live at once.
 *
 * Pure, like everything in `shared/`. The server rolls with `#shared/utils/random` and applies;
 * the stat pipeline reads `traitModifiers` the way it reads Artifacts.
 */

import {
    TRAIT_GRADE_RATES,
    TRAIT_ROLL_BASE_COST,
    TRAIT_ROLL_COST_PER_LOCK,
    TRAIT_SET_TIERS,
    TRAIT_SLOT_COUNT,
    TRAIT_STAT_VALUES,
    BASE_TRAIT_SAVE_SLOTS,
    MAX_TRAIT_SAVE_SLOTS
} from './constants'
import {
    TRAIT_GRADES,
    TRAIT_SETS,
    TRAIT_STATS,
    getTraitSet,
    getTraitStat,
    isTraitGrade,
    isTraitSetId,
    isTraitStatId
} from './content/traits'
import type { HqModifier } from './modifiers'
import { randomFloat, randomWeighted } from '../random'
import type { TraitGrade, TraitRoll, TraitSetId, TraitStatId } from './types'

/** One live slot: what it rolled and whether it is locked. */
export interface TraitSlotState extends TraitRoll {
    locked: boolean
}

/** The five live slots by index; null where nothing has been rolled yet (§1: all start empty). */
export type TraitBoard = readonly (TraitSlotState | null)[]

/** A board with nothing rolled. */
export function emptyTraitBoard(): (TraitSlotState | null)[] {
    return Array.from({ length: TRAIT_SLOT_COUNT }, () => null)
}

/** A stored slot as the math reads it; null for anything that is not a known stat, grade and Set. */
export function traitSlotOf(raw: { stat: string, grade: string, set: string, locked: boolean } | null | undefined): TraitSlotState | null {
    if (!raw || !isTraitStatId(raw.stat) || !isTraitGrade(raw.grade) || !isTraitSetId(raw.set)) return null
    return { stat: raw.stat, grade: raw.grade, set: raw.set, locked: raw.locked === true }
}

/** The live board from its stored slots, by slot index; an index with nothing (or a stale ID) is empty. */
export function traitBoardOf(rows: readonly { slotIndex: number, stat: string, grade: string, setId: string, locked: boolean }[]): (TraitSlotState | null)[] {
    const board = emptyTraitBoard()
    for (const row of rows) {
        if (!Number.isInteger(row.slotIndex) || row.slotIndex < 0 || row.slotIndex >= TRAIT_SLOT_COUNT) continue
        board[row.slotIndex] = traitSlotOf({ stat: row.stat, grade: row.grade, set: row.setId, locked: row.locked })
    }
    return board
}

/** The rolled slots of a board, which is all the stat pipeline reads. */
export function traitRollsOf(board: TraitBoard): TraitRoll[] {
    return board.flatMap(slot => slot ? [{ stat: slot.stat, grade: slot.grade, set: slot.set }] : [])
}

/** How many slots are locked. An empty slot never is. */
export function lockedCount(board: TraitBoard): number {
    return board.filter(slot => slot?.locked).length
}

/** `5 + locked × 5` Trait Gems (§2). */
export function traitRollCost(locked: number): number {
    const n = Math.max(0, Math.min(TRAIT_SLOT_COUNT, Math.floor(locked)))
    return TRAIT_ROLL_BASE_COST + n * TRAIT_ROLL_COST_PER_LOCK
}

/** Whether a Roll would change anything: with every slot locked it is a no-op, never sold (§2). */
export function canRollTraits(board: TraitBoard): boolean {
    return lockedCount(board) < TRAIT_SLOT_COUNT
}

/** The grade a uniform `[0, 1)` draw lands on, per the Acquisition table. */
export function traitGradeFromRoll(roll: number): TraitGrade {
    return randomWeighted(TRAIT_GRADES, grade => TRAIT_GRADE_RATES[grade], () => roll)
}

/**
 * One slot's roll: stat, grade and Set, each its own draw (§2). `rng` is uniform in `[0, 1)`; the
 * server leaves it at `randomFloat`, and only a spec hands in a fixed sequence.
 */
export function rollTrait(rng: () => number = randomFloat): TraitRoll {
    return {
        stat: randomWeighted(TRAIT_STATS, () => 1, rng).id,
        grade: traitGradeFromRoll(rng()),
        set: randomWeighted(TRAIT_SETS, () => 1, rng).id
    }
}

/**
 * A Roll: every slot not locked — an empty one included — gets a fresh roll, unlocked; a locked
 * slot comes back exactly as it was. The first Roll fills all five at once (§1).
 */
export function rerollTraitBoard(board: TraitBoard, rng: () => number = randomFloat): TraitSlotState[] {
    return Array.from({ length: TRAIT_SLOT_COUNT }, (_, index) => {
        const slot = board[index] ?? null
        if (slot?.locked) return { ...slot }
        return { ...rollTrait(rng), locked: false }
    })
}

/** A stat's value at a grade, as a fraction (§4). */
export function traitValue(stat: TraitStatId, grade: TraitGrade): number {
    return TRAIT_STAT_VALUES[stat][grade]
}

/** How many of the rolled slots carry each Set. */
export function traitSetCounts(rolls: readonly TraitRoll[]): Record<TraitSetId, number> {
    const counts = Object.fromEntries(TRAIT_SETS.map(set => [set.id, 0])) as Record<TraitSetId, number>
    for (const roll of rolls) counts[roll.set]++
    return counts
}

export interface TraitSetBonus {
    set: TraitSetId
    pieces: number
    /** The tier reached, 0-based into `TRAIT_SET_TIERS[set]`. */
    tier: number
    magnitude: number
}

/**
 * The tier a Set reaches at `pieces`: the highest whose count is met, which is the **total** bonus
 * (§5). Below the first count, null; past the last, the last holds.
 */
export function traitSetTier(set: TraitSetId, pieces: number): { tier: number, magnitude: number } | null {
    const tiers = TRAIT_SET_TIERS[set]
    let reached: { tier: number, magnitude: number } | null = null
    tiers.forEach((t, tier) => {
        if (pieces >= t.pieces) reached = { tier, magnitude: t.magnitude }
    })
    return reached
}

/** Every Set live on these rolls, each at its tier. Several can be live at once. */
export function activeTraitSets(rolls: readonly TraitRoll[]): TraitSetBonus[] {
    const counts = traitSetCounts(rolls)
    return TRAIT_SETS.flatMap((set) => {
        const reached = traitSetTier(set.id, counts[set.id])
        return reached ? [{ set: set.id, pieces: counts[set.id], ...reached }] : []
    })
}

/** Trait lines by who they reach (`traits.md` §0). */
export interface TraitModifiers {
    /** Hero and every fielded Champion. */
    party: HqModifier[]
    /** The Hero only: Hero Skill DMG. */
    hero: HqModifier[]
    /** Champions only: Champion ATK. */
    champion: HqModifier[]
}

/**
 * Every rolled stat and every live Set bonus, as modifier lines sorted by scope. The pipeline sums
 * them with the other sources of the same line (`stats.ts`), so a Trait's +35% ATK and an
 * Artifact's +20% PWR are +55% together, not ×1.62.
 */
export function traitModifiers(rolls: readonly TraitRoll[]): TraitModifiers {
    const out: TraitModifiers = { party: [], hero: [], champion: [] }
    for (const roll of rolls) {
        const def = getTraitStat(roll.stat)
        out[def.scope].push({ ...def.line, magnitude: traitValue(roll.stat, roll.grade) })
    }
    for (const bonus of activeTraitSets(rolls)) {
        for (const line of getTraitSet(bonus.set).lines) out.party.push({ ...line, magnitude: bonus.magnitude })
    }
    return out
}

/** Save slots owned at a shop level, 1 → 4 (§6). Priced by the `traitSaveSlots` shop track. */
export function traitSaveSlotsAt(level: number): number {
    return Math.min(MAX_TRAIT_SAVE_SLOTS, BASE_TRAIT_SAVE_SLOTS + Math.max(0, Math.floor(level)))
}
