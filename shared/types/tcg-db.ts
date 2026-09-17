/** jsonb column shapes for the TCG Collector tables (server/database/schema.ts). */

/**
 * A sheet's authored layout: printingIds in circular slot order, length M.
 * Validated against the window constraint before commit; read atomically.
 */
export type TcgSheetLayout = string[]

/** One ordered slot group of a pack template — count must equal the sheet's packSlots. */
export interface TcgPackTemplateSlot {
    sheetId: string
    count: number
}

/**
 * One cut reserved for a pack at purchase time: the sheet it came from, the
 * sequential cursor value drawn (seq) and the permuted cut index.
 */
export interface TcgPackCut {
    sheetId: string
    seq: number
    cut: number
}

/**
 * One returned reservation waiting in a set's restock pool: the frozen
 * contents of a pack that was bought and then put back. Counters and cursors
 * are never rewound — a future purchase re-issues this exact reservation.
 */
export interface TcgRestockEntry {
    packIndex: number
    isGod: boolean
    cuts: TcgPackCut[]
}

/** Raw checklist record as imported from the pokemonplaatjes API. */
export type TcgCardRaw = Record<string, unknown>

/**
 * Re-export of the locked condition model's roll shape so the schema (and
 * anything else that only needs the type) can import it without reaching into
 * the vendored .js/.d.ts pair directly.
 */
export type { TcgCondition } from '../utils/tcg/grading-model-types'
