import { BASE_NODE_CAPACITY } from './config'
import { bonusesFor, type Bonuses } from './progression'
import { isSpecialist } from './workers'
import type { CaravanState, NodeId, World, WorldNode, Worker } from './types'

/**
 * Postings.
 *
 * A worker works the seam the player put it on, and no other. Everything here is
 * about answering two questions the same way on the client, the server and
 * inside the simulation: is this posting legal, and how much room is left.
 */

/** How many workers this seam can hold, including whatever research has added. */
export function nodeCapacity(state: CaravanState, nodeId: NodeId, bonuses?: Bonuses): number {
    const extra = (bonuses ?? bonusesFor(state)).nodeCapacity
    return (state.nodeCapacity?.[nodeId] ?? BASE_NODE_CAPACITY) + extra
}

/** Everyone currently posted to a seam, in roster order. */
export function crewOf(state: CaravanState, nodeId: NodeId): Worker[] {
    return state.workers.filter(w => w.assignment === nodeId)
}

/** Places left at a seam. Never negative, even if a save arrives oversubscribed. */
export function roomAt(state: CaravanState, nodeId: NodeId, bonuses?: Bonuses): number {
    return Math.max(0, nodeCapacity(state, nodeId, bonuses) - crewOf(state, nodeId).length)
}

/**
 * Whether a seam can be worked at all: it has to be a resource node the player
 * holds. Reachability is deliberately not checked here -- a seam cut off by a
 * camp is still a legal posting, the worker simply cannot get there until the
 * road opens, and revoking the posting behind the player's back would be worse.
 */
export function isWorkable(state: CaravanState, node: WorldNode | undefined): node is WorldNode {
    return node !== undefined && node.kind === 'resource' && state.ownedNodes.includes(node.id)
}

/**
 * Drop postings that have stopped being legal, and trim any seam holding more
 * hands than it has room for. Called at the top of every catch-up so a save that
 * predates a rule change -- or one written by the old priority allocator --
 * settles into something the assignment endpoints would also accept.
 *
 * Trimming keeps the first `capacity` workers in roster order, which is stable:
 * the same save trims to the same crew on the client and on the server.
 */
export function pruneAssignments(state: CaravanState, world: World, bonuses?: Bonuses): boolean {
    const b = bonuses ?? bonusesFor(state)
    const counted = new Map<NodeId, number>()
    let changed = false

    for (const worker of state.workers) {
        if (worker.assignment === null) continue
        const node = world.nodes[worker.assignment]
        const seen = counted.get(worker.assignment) ?? 0
        const legal = isWorkable(state, node) && seen < nodeCapacity(state, worker.assignment, b)
        if (legal) {
            counted.set(worker.assignment, seen + 1)
            continue
        }
        worker.assignment = null
        worker.route = []
        worker.routeIndex = 0
        // Mid-harvest at a seam that is no longer theirs: stop cutting. Travel
        // and unload are left to finish so nothing already in a pack is lost.
        if (worker.activity.type === 'harvest') worker.activity = { type: 'idle' }
        changed = true
    }

    return changed
}

/**
 * The order the "fill this seam" button hands out places: specialists first,
 * then the strongest of the rest. It is a bulk version of clicking assign a few
 * times, not an allocator -- it only ever touches workers with no posting, and
 * only when the player asks for it.
 */
export function fillOrder(state: CaravanState, node: WorldNode): Worker[] {
    return state.workers
        .filter(w => w.assignment === null)
        .sort((a, c) => {
            const specialty = Number(isSpecialist(c, node.resource)) - Number(isSpecialist(a, node.resource))
            if (specialty !== 0) return specialty
            return c.level - a.level || c.tier - a.tier
        })
}
