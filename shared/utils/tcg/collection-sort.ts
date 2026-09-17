/**
 * How the collection gallery orders a set's tiles (§10).
 *
 * Pure and shared so the order can be unit-tested without a browser: the page
 * only supplies the price lookup, which it fetches lazily.
 */

import { rarityOrder } from '#shared/utils/tcg/rarity'

export type CollectionSortMode = 'number' | 'value' | 'serial' | 'rarity'
export type CollectionSortDirection = 'asc' | 'desc'

/** The fields an order can read. A subset of GalleryPrinting, so tests need no fixtures. */
export interface SortablePrinting {
    sortOrder: number
    finish: string
    pattern: string | null
    rarity: string | null
    /** Earliest copy serial the viewer owns; null on copies minted before serials. */
    serialNo: number | null
}

export const COLLECTION_SORT_MODES: { value: CollectionSortMode, label: string }[] = [
    { value: 'number', label: 'Card number' },
    { value: 'value', label: 'Real-world value' },
    { value: 'serial', label: 'Serial' },
    { value: 'rarity', label: 'Rarity' }
]

/** Variants of one card keep a stable order within it: plain, holo, reverse. */
const FINISH_RANK: Record<string, number> = { nonholo: 0, holo: 1, reverse: 2 }

/** The set's own order — what the server already sorts by, and the default. */
function byNumber(a: SortablePrinting, b: SortablePrinting): number {
    return a.sortOrder - b.sortOrder
        || (FINISH_RANK[a.finish] ?? 9) - (FINISH_RANK[b.finish] ?? 9)
        || (a.pattern ?? '').localeCompare(b.pattern ?? '')
}

/**
 * Order a set's printings.
 *
 * `priceOf` returns the real-world price of a tile, or null when the card is
 * unpriced or the sidecar could not be reached. UNKNOWN IS NOT ZERO: a card
 * with no price sorts last in BOTH directions rather than pretending to be
 * the cheapest thing you own — the same for a copy with no serial. Ties fall
 * back to the set's own order, so every mode is deterministic.
 */
export function sortPrintings<T extends SortablePrinting>(
    printings: T[],
    mode: CollectionSortMode,
    direction: CollectionSortDirection,
    priceOf: (printing: T) => number | null = () => null
): T[] {
    const flip = direction === 'desc' ? -1 : 1
    const ranked = (a: T, b: T): number => {
        switch (mode) {
            case 'value': {
                const pa = priceOf(a)
                const pb = priceOf(b)
                if (pa == null || pb == null) return pa == null ? (pb == null ? 0 : 1) : -1
                return flip * (pa - pb)
            }
            case 'serial': {
                if (a.serialNo == null || b.serialNo == null) {
                    return a.serialNo == null ? (b.serialNo == null ? 0 : 1) : -1
                }
                return flip * (a.serialNo - b.serialNo)
            }
            case 'rarity':
                return flip * (rarityOrder(a.rarity) - rarityOrder(b.rarity))
            default:
                return flip * byNumber(a, b)
        }
    }
    // Copy first: the caller's array is reactive state, and sort mutates.
    return [...printings].sort((a, b) => ranked(a, b) || byNumber(a, b))
}
