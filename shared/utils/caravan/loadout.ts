import { ITEM_SLOTS, RARITIES } from './config'
import { itemScore } from './items'
import type { CaravanState, ItemSlot, Worker } from './types'

/**
 * Automatic gear assignment.
 *
 * Hand-fitting five slots across twenty workers is the kind of chore that turns
 * a good vault roll into a nuisance, so this works out the whole loadout in one
 * pass. It is deliberately a plan rather than an action: the client can show what
 * would change before anything moves, and the server runs the same function so
 * the two can never disagree.
 */

export interface LoadoutChange {
    workerId: string
    workerName: string
    slot: ItemSlot
    /** Null means the slot is being emptied, which only happens if an item vanished. */
    itemId: string | null
    previousItemId: string | null
}

/**
 * Workers are ranked before gear is handed out. Level multiplies every stat, so
 * the best item on the highest-level worker is worth strictly more than the same
 * item on a fresh hire.
 */
function rankWorkers(workers: Worker[]): Worker[] {
    return [...workers].sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level
        const rarity = RARITIES.findIndex(r => r.id === b.rarity) - RARITIES.findIndex(r => r.id === a.rarity)
        if (rarity !== 0) return rarity
        // Ties broken by id so the plan is stable between runs.
        return a.id.localeCompare(b.id)
    })
}

export function planLoadout(state: CaravanState): LoadoutChange[] {
    const changes: LoadoutChange[] = []
    const ranked = rankWorkers(state.workers)

    for (const slot of ITEM_SLOTS) {
        const pool = state.items
            .filter(item => item.slot === slot)
            .sort((a, b) => itemScore(b) - itemScore(a) || a.id.localeCompare(b.id))

        ranked.forEach((worker, index) => {
            const item = pool[index] ?? null
            const previous = worker.equipment[slot] ?? null
            const next = item?.id ?? null
            if (next === previous) return
            changes.push({ workerId: worker.id, workerName: worker.name, slot, itemId: next, previousItemId: previous })
        })
    }

    return changes
}

/** Apply a plan in place. Every item still ends up on exactly one worker. */
export function applyLoadout(state: CaravanState, changes: LoadoutChange[]): void {
    for (const change of changes) {
        const worker = state.workers.find(w => w.id === change.workerId)
        if (!worker) continue
        if (change.itemId === null) {
            delete worker.equipment[change.slot]
        } else {
            worker.equipment[change.slot] = change.itemId
        }
    }
}
