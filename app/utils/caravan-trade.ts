import {
    ALL_RESOURCE_IDS, CATEGORY_NAMES, RESOURCES, SPECIALTY_HARVEST_BONUS
} from '#shared/utils/caravan/config'
import type { Category, ResourceId } from '#shared/utils/caravan/types'

/**
 * What a trade actually buys you.
 *
 * A worker's specialties are the whole reason it matters who gets posted where,
 * but the roster only ever showed the name of the trade -- which tells a player
 * nothing about why they would move a Timber worker onto a timber seam. These
 * turn the number in the simulation into the sentence the UI shows.
 */

export const TRADE_BONUS_PERCENT = Math.round(SPECIALTY_HARVEST_BONUS * 100)

/** Every raw resource this trade covers, in tier order. */
export function tradeResources(category: Category): ResourceId[] {
    return (ALL_RESOURCE_IDS as ResourceId[])
        .filter(id => RESOURCES[id]?.category === category)
        .sort((a, b) => (RESOURCES[a]!.tier - RESOURCES[b]!.tier))
}

/** One line explaining the perk, for a tooltip on a trade badge. */
export function tradePerk(category: Category): string {
    return `${CATEGORY_NAMES[category]} specialist: +${TRADE_BONUS_PERCENT}% on every load hauled off a ${CATEGORY_NAMES[category].toLowerCase()} seam. Same trips, bigger packs.`
}

/** The seams the perk applies to, as a readable list. */
export function tradeSeams(category: Category): string {
    return tradeResources(category).map(id => RESOURCES[id]!.name).join(', ')
}
