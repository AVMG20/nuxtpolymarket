/**
 * Sorting shared by all four collection grids.
 *
 * Session-1 playtest, finding 5: every grid rendered its roster in content-array order, which is
 * authoring order and means nothing to a player. The chosen order is **rarity low→high, then the
 * system's own second axis** — archetype for Champions, slot for Gear, active/passive for Skills,
 * category for Artifacts.
 *
 * Low→high rather than high→low on purpose: the grid then reads as a ladder you climb, and the
 * Mythics you are hunting sit at the end rather than burying the Commons you actually own early.
 *
 * Auto-imported as a Nuxt utility, like `hqRarityClass` — hence the `HQ_` prefix on the constant,
 * which is the same collision `hero-quest-rarity.ts` documents. The one import below is explicit
 * rather than auto: the sort is pure and worth a spec, and vitest has no auto-import layer.
 */
import { HQ_RARITY_ORDER } from './hero-quest-rarity'

export interface HqSortableEntry {
    id: string
    name: string
    rarity: string
    owned: boolean
}

export type HqOwnership = 'all' | 'owned' | 'missing'

export const HQ_OWNERSHIP_OPTIONS: readonly { value: HqOwnership; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'owned', label: 'Owned' },
    { value: 'missing', label: 'Missing' }
]

/** Position in the six-tier ladder. Unknown rarities sort last rather than throwing at render. */
export function hqRarityRank(rarity: string): number {
    const index = HQ_RARITY_ORDER.indexOf(rarity)
    return index < 0 ? HQ_RARITY_ORDER.length : index
}

/**
 * Rarity ascending, then the system's own axis in the order it declares, then name.
 *
 * The name tiebreak is not cosmetic — without it the order within a rarity/axis cell falls back
 * to array order, so a content edit that reorders a roster would silently reshuffle a grid the
 * player has learned the shape of.
 */
export function hqSortCollection<T extends HqSortableEntry>(
    entries: readonly T[],
    axisOf: (entry: T) => string,
    axisOrder: readonly string[]
): T[] {
    const axisRank = (entry: T) => {
        const index = axisOrder.indexOf(axisOf(entry))
        return index < 0 ? axisOrder.length : index
    }

    return [...entries].sort((a, b) =>
        hqRarityRank(a.rarity) - hqRarityRank(b.rarity)
        || axisRank(a) - axisRank(b)
        || a.name.localeCompare(b.name))
}
