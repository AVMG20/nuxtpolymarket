import {
    BASE_HARVEST_SECONDS,
    RECIPES,
    BASE_TRAVEL_SPEED,
    FOOD_PER_PROVISION,
    HUNGER_PER_UNIT,
    MAX_CATCHUP_SECONDS,
    REGEN_PER_HOUR,
    RESOURCES,
    salePrice,
    TIERS,
    UNLOAD_SECONDS,
    roadSpeedMultiplier
} from './config'
import { pruneAssignments } from './assignment'
import { createRng } from './rng'
import { LOG_LIMIT } from './state'
import { bonusesFor, type Bonuses } from './progression'
import { MAX_WORKER_LEVEL, combatPower, derivedStats, xpForLevel, yieldMultiplier } from './workers'
import { otherEnd } from './world'
import type {
    CaravanState,
    NodeId,
    SimEvent,
    Worker,
    World,
    WorldEdge,
    WorldNode
} from './types'

/**
 * The caravan simulation.
 *
 * There is no tick loop and no cron. State carries `lastTick`, and any request
 * -- a page load, a purchase, a posting change -- first advances the world from
 * `lastTick` to `now` and only then applies the mutation. The client runs
 * this same function against the same state for smooth animation and calls back
 * to the server whenever it predicts an activity has finished, which keeps the
 * two in sync without polling.
 *
 * The advance is event-driven rather than fixed-step: it jumps straight to the
 * next moment a worker finishes travelling, harvesting or unloading. A day of
 * offline progress is a few thousand jumps, not a few million ticks.
 */

const MAX_STEPS = 400_000
const MAX_EVENTS = 80

export interface AdvanceResult {
    events: SimEvent[]
    /** True when the catch-up hit the offline cap and time was discarded. */
    truncated: boolean
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

interface Graph {
    edgeById: Map<string, WorldEdge>
    nodeById: Map<NodeId, WorldNode>
    passable: Set<NodeId>
    capitals: NodeId[]
    /** Travel cost in seconds per unit of base speed, per edge. */
    cost: (edge: WorldEdge) => number
    /** Multi-source shortest path back to the nearest capital. */
    homePred: Map<NodeId, NodeId>
    homeDist: Map<NodeId, number>
}

function buildGraph(state: CaravanState, world: World): Graph {
    const edgeById = new Map(world.edges.map(e => [e.id, e]))
    const nodeById = new Map(world.nodes.map(n => [n.id, n]))

    // A node can be walked through if the player owns it, or if it is a camp
    // they have already cleared. Uncleared camps are hard walls.
    const passable = new Set<NodeId>(state.ownedNodes)
    passable.add(0)
    for (const id of state.clearedCamps) passable.add(id)

    const cost = (edge: WorldEdge) => edge.length / (BASE_TRAVEL_SPEED * roadSpeedMultiplier(state.roads[edge.id] ?? 0))

    const capitals = state.capitals.length ? state.capitals : [0]
    const { dist, pred } = dijkstra(world, passable, cost, capitals)
    return { edgeById, nodeById, passable, capitals, cost, homePred: pred, homeDist: dist }
}

function dijkstra(
    world: World,
    passable: Set<NodeId>,
    cost: (e: WorldEdge) => number,
    sources: NodeId[]
): { dist: Map<NodeId, number>, pred: Map<NodeId, NodeId> } {
    const dist = new Map<NodeId, number>()
    const pred = new Map<NodeId, NodeId>()
    // The graph is ~120 nodes, so a linear scan for the minimum beats the
    // bookkeeping of a real heap and keeps this allocation-free.
    const queue = new Set<NodeId>()
    for (const s of sources) {
        if (!passable.has(s)) continue
        dist.set(s, 0)
        queue.add(s)
    }
    const visited = new Set<NodeId>()
    while (queue.size) {
        let best: NodeId | null = null
        let bestD = Infinity
        for (const id of queue) {
            const d = dist.get(id) ?? Infinity
            if (d < bestD) { bestD = d; best = id }
        }
        if (best === null) break
        queue.delete(best)
        visited.add(best)
        for (const eid of world.adjacency[best] ?? []) {
            const edge = world.edges.find(e => e.id === eid)
            if (!edge) continue
            const next = otherEnd(edge, best)
            if (!passable.has(next) || visited.has(next)) continue
            const nd = bestD + cost(edge)
            if (nd < (dist.get(next) ?? Infinity)) {
                dist.set(next, nd)
                pred.set(next, best)
                queue.add(next)
            }
        }
    }
    return { dist, pred }
}

/** Path from `node` back to the nearest capital, excluding `node` itself. */
function routeHome(graph: Graph, node: NodeId): NodeId[] {
    const path: NodeId[] = []
    let cur = node
    let guard = 0
    while (!graph.capitals.includes(cur) && guard++ < 500) {
        const next = graph.homePred.get(cur)
        if (next === undefined) return []
        path.push(next)
        cur = next
    }
    return path
}

/** Path from a capital out to `node`, excluding the capital itself. */
function routeOut(graph: Graph, node: NodeId): NodeId[] {
    const home = routeHome(graph, node)
    if (!home.length) return graph.capitals.includes(node) ? [] : []
    return [...home.slice(0, -1).reverse(), node]
}

/** General path between two arbitrary passable nodes. */
export function routeBetween(state: CaravanState, world: World, from: NodeId, to: NodeId): NodeId[] {
    const graph = buildGraph(state, world)
    const { pred } = dijkstra(world, graph.passable, graph.cost, [from])
    const path: NodeId[] = []
    let cur = to
    let guard = 0
    while (cur !== from && guard++ < 500) {
        path.push(cur)
        const next = pred.get(cur)
        if (next === undefined) return []
        cur = next
    }
    return path.reverse()
}

function edgeBetween(graph: Graph, world: World, a: NodeId, b: NodeId): WorldEdge | undefined {
    for (const eid of world.adjacency[a] ?? []) {
        const edge = graph.edgeById.get(eid)
        if (edge && otherEnd(edge, a) === b) return edge
    }
    return undefined
}

// ---------------------------------------------------------------------------
// Node richness
// ---------------------------------------------------------------------------

/**
 * How productive a node is right now, 0.15 to 1. Over-harvesting drives this
 * down and it climbs back on its own, so parking every worker on the single
 * best node is self-defeating.
 */
export function nodeRichness(state: CaravanState, node: WorldNode, now: number, regenBonus = 0): number {
    if (!node.capacity) return 1
    const entry = state.depletion[node.id]
    if (!entry) return 1
    const hours = Math.max(0, (now - entry.at) / 3_600_000)
    const regen = node.capacity * REGEN_PER_HOUR * (1 + regenBonus / 100) * hours
    const drawn = Math.max(0, entry.drawn - regen)
    // The floor used to be 0.15, which made a hard-worked seam take nearly seven
    // times as long per pack -- long enough that a crowded node delivered
    // nothing at all for stretches. Crowding is expressed through capacity; the
    // deposit should slow you down, not stop you.
    return Math.max(0.35, 1 - drawn / node.capacity)
}

function applyDraw(state: CaravanState, node: WorldNode, amount: number, now: number, regenBonus: number) {
    if (!node.capacity) return
    const entry = state.depletion[node.id]
    const hours = entry ? Math.max(0, (now - entry.at) / 3_600_000) : 0
    const regen = entry ? node.capacity * REGEN_PER_HOUR * (1 + regenBonus / 100) * hours : 0
    const drawn = Math.max(0, (entry?.drawn ?? 0) - regen) + amount
    state.depletion[node.id] = { drawn: Math.min(drawn, node.capacity * 1.4), at: now }
}

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

/** Provisions in stock, cheapest tier first so the good food is saved for later. */
function provisionOrder(): string[] {
    return TIERS.map(t => t.provision)
}

/**
 * Top a worker up. Returns false when the larder is empty, which parks the
 * worker until the player refines more food -- the upkeep pressure that stops
 * a caravan from running unattended forever.
 *
 * With the kitchen standing order researched and switched on, an empty larder
 * instead triggers a bake at the moment it runs dry. That is the difference
 * between a caravan that stalls three hours into the night and one that does
 * not, and it removes the single most tedious chore in the game: refining bread
 * by hand every time you open the tab.
 */
function feed(state: CaravanState, worker: Worker, bakeIfEmpty = false): boolean {
    if (worker.food >= 99) return true

    for (let attempt = 0; attempt < 2; attempt++) {
        for (const id of provisionOrder()) {
            const stock = state.resources[id] ?? 0
            if (stock <= 0) continue
            const needed = Math.ceil((100 - worker.food) / FOOD_PER_PROVISION)
            const used = Math.min(stock, needed)
            state.resources[id] = stock - used
            worker.food = Math.min(100, worker.food + used * FOOD_PER_PROVISION)
            if (worker.food >= 99) return true
        }
        if (!bakeIfEmpty || !bakeProvisions(state)) break
    }
    return worker.food > 0
}

/**
 * Bake one batch of the best provision the storehouse can currently afford,
 * highest tier first. Returns false when nothing can be made, which is the
 * honest failure -- a standing order cannot conjure raw materials.
 */
function bakeProvisions(state: CaravanState): boolean {
    for (let tier = state.tier; tier >= 1; tier--) {
        const def = TIERS[tier - 1]
        if (!def) continue
        const recipe = RECIPES.find(r => r.output === def.provision)
        if (!recipe) continue

        // Bake a run at a time rather than one batch, so a long offline stretch
        // does not thrash through thousands of single-batch refinements.
        const batches = Math.min(
            25,
            ...Object.entries(recipe.inputs).map(([id, count]) => Math.floor((state.resources[id] ?? 0) / count))
        )
        if (batches < 1) continue

        for (const id in recipe.inputs) {
            state.resources[id] = (state.resources[id] ?? 0) - (recipe.inputs[id] ?? 0) * batches
        }
        state.resources[recipe.output] = (state.resources[recipe.output] ?? 0) + recipe.outputCount * batches
        return true
    }
    return false
}

// ---------------------------------------------------------------------------
// Advance
// ---------------------------------------------------------------------------

/**
 * Clamp a computed duration into something the simulation can actually finish.
 *
 * A zero or NaN stat anywhere upstream used to produce an infinite `doneAt`,
 * which serialises to null in the save and leaves the worker mid-job forever
 * with nothing to complete it. Bounding it here means the worst a bad stat can
 * do is make one job slow.
 */
const MAX_ACTIVITY_SECONDS = 6 * 3600

function safeSeconds(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 1
    return Math.min(MAX_ACTIVITY_SECONDS, seconds)
}

function cargoTotal(worker: Worker): number {
    let sum = 0
    for (const k in worker.cargo) sum += worker.cargo[k] ?? 0
    return sum
}

function activityEnd(worker: Worker): number | null {
    const a = worker.activity
    if (a.type === 'travel') return a.arrivesAt
    if (a.type === 'harvest') return a.doneAt
    if (a.type === 'unload') return a.doneAt
    if (a.type === 'assault') return a.resolvesAt
    return null
}

export function advance(state: CaravanState, world: World, now: number): AdvanceResult {
    const events: SimEvent[] = []
    const push = (e: SimEvent) => {
        events.push(e)
        if (events.length > MAX_EVENTS) events.shift()
    }

    let t = state.lastTick || now
    let truncated = false
    if (now - t > MAX_CATCHUP_SECONDS * 1000) {
        t = now - MAX_CATCHUP_SECONDS * 1000
        truncated = true
    }
    if (now <= t) {
        state.lastTick = Math.max(state.lastTick, now)
        return { events, truncated }
    }

    const bonuses = bonusesFor(state)
    const graph = buildGraph(state, world)
    const rng = createRng(state.rngSeed, state.rngCursor)

    const statsFor = (w: Worker) => derivedStats(w, state.items, bonuses)

    // The kitchen standing order still needs both its research and its switch.
    const autoBake = bonuses.canAutoRefine && state.policies?.autoRefine === true

    // A posting the player made before a seam was widened back down, or one the
    // old priority allocator left behind, is dropped here rather than quietly
    // over-filling a node for the rest of the catch-up.
    pruneAssignments(state, world, bonuses)

    // --- transitions ------------------------------------------------------

    /** Give an idle worker its next job. Returns true if anything changed. */
    const startActivity = (worker: Worker, at: number): boolean => {
        if (worker.activity.type === 'starving') {
            if (!feed(state, worker, autoBake)) return false
            worker.activity = { type: 'idle' }
        }
        if (worker.activity.type !== 'idle') return false

        const stats = statsFor(worker)
        const full = cargoTotal(worker) >= stats.carry

        // Where the worker wants to be. A full pack always goes home first; an
        // empty one goes to whatever seam the player posted it to, and standing
        // in a capital is what "no posting" looks like.
        let destination: NodeId | null = null
        if (full || (worker.assignment === null && cargoTotal(worker) > 0)) {
            destination = null // nearest capital, resolved via routeHome
        } else if (worker.assignment !== null && graph.passable.has(worker.assignment)) {
            destination = worker.assignment
        } else {
            // No posting, or one it cannot reach yet: walk home and wait there
            // until the player gives it a seam it can actually get to.
            if (graph.capitals.includes(worker.at)) return false
            destination = null
        }

        if (destination === null) {
            if (graph.capitals.includes(worker.at)) {
                if (cargoTotal(worker) > 0) {
                    worker.activity = { type: 'unload', at: worker.at, doneAt: at + UNLOAD_SECONDS * 1000 }
                    return true
                }
                feed(state, worker, autoBake)
                return false
            }
            worker.route = routeHome(graph, worker.at)
        } else {
            if (worker.at === destination) {
                const node = graph.nodeById.get(destination)
                if (node?.kind === 'resource') {
                    const richness = nodeRichness(state, node, at, bonuses.regenRate)
                    const seconds = safeSeconds((stats.carry * BASE_HARVEST_SECONDS) / (stats.strength * richness))
                    worker.activity = { type: 'harvest', at: destination, startedAt: at, doneAt: at + seconds * 1000 }
                    return true
                }
                return false
            }
            worker.route = graph.capitals.includes(worker.at)
                ? routeOut(graph, destination)
                : routeBetween(state, world, worker.at, destination)
        }

        worker.routeIndex = 0
        if (!worker.route.length) return false
        return stepRoute(worker, at)
    }

    /** Begin travel along the next hop of the cached route. */
    const stepRoute = (worker: Worker, at: number): boolean => {
        const next = worker.route[worker.routeIndex]
        if (next === undefined) {
            worker.route = []
            worker.routeIndex = 0
            worker.activity = { type: 'idle' }
            return true
        }
        const edge = edgeBetween(graph, world, worker.at, next)
        if (!edge) {
            // The route went stale (a node was sold, a camp reset). Recompute
            // from scratch on the next pass rather than stranding the worker.
            worker.route = []
            worker.routeIndex = 0
            worker.activity = { type: 'idle' }
            return false
        }
        const stats = statsFor(worker)
        const seconds = safeSeconds(edge.length / (BASE_TRAVEL_SPEED * stats.speed * roadSpeedMultiplier(state.roads[edge.id] ?? 0)))
        worker.activity = { type: 'travel', from: worker.at, to: next, startedAt: at, arrivesAt: at + seconds * 1000 }
        return true
    }

    const grantXp = (worker: Worker, amount: number, at: number) => {
        const stats = statsFor(worker)
        worker.xp += Math.round(amount * stats.xpGain)
        while (worker.level < MAX_WORKER_LEVEL && worker.xp >= xpForLevel(worker.level)) {
            worker.xp -= xpForLevel(worker.level)
            worker.level++
            push({ at, kind: 'levelup', workerId: worker.id, text: `${worker.name} reached level ${worker.level}` })
        }
    }

    /** Finish whatever the worker was doing. */
    const complete = (worker: Worker, at: number) => {
        const a = worker.activity
        switch (a.type) {
            case 'travel': {
                const edge = edgeBetween(graph, world, a.from, a.to)
                worker.at = a.to
                worker.routeIndex++
                // Food is spent per unit of ground covered, not per second, so
                // paving a road makes a trip faster without making it cheaper.
                const stats = statsFor(worker)
                worker.food -= (edge?.length ?? 0) * HUNGER_PER_UNIT * stats.hunger
                if (worker.food <= 0) {
                    worker.food = 0
                    const here = graph.nodeById.get(worker.at)
                    const canEatHere = graph.capitals.includes(worker.at)
                        || (bonuses.autoFeed && here !== undefined && graph.passable.has(worker.at))
                    if (!canEatHere || !feed(state, worker, autoBake)) {
                        worker.activity = { type: 'starving', at: worker.at }
                        push({ at, kind: 'starved', workerId: worker.id, nodeId: worker.at, text: `${worker.name} is out of rations` })
                        return
                    }
                }
                worker.activity = { type: 'idle' }
                break
            }
            case 'harvest': {
                const node = graph.nodeById.get(a.at)
                const stats = statsFor(worker)
                if (node?.resource) {
                    // Yield gear and specialties multiply what comes out, but the
                    // seam is drained by pack size -- so a specialist is pure
                    // profit rather than a faster way to exhaust a node.
                    const amount = stats.carry * yieldMultiplier(worker, stats, node.resource)
                    worker.cargo[node.resource] = (worker.cargo[node.resource] ?? 0) + Math.round(amount)
                    applyDraw(state, node, stats.carry, at, bonuses.regenRate)
                    // Gem seams pay a sliver of a gem per pack hauled out. They
                    // are the only source of gems on the map, and there are five.
                    if (node.gemYield) state.pendingGems += node.gemYield
                    grantXp(worker, 4 + node.tier * 3, at)
                    if (nodeRichness(state, node, at, bonuses.regenRate) <= 0.2) {
                        push({ at, kind: 'depleted', nodeId: node.id, text: `${node.name} is running dry` })
                    }
                }
                worker.activity = { type: 'idle' }
                break
            }
            case 'unload': {
                // Deliveries pay nothing. Goods go into the storehouse and coins
                // come from selling them at the market, so every hour of hauling
                // ends in a decision rather than a deposit.
                let hauled = 0
                let value = 0
                for (const id in worker.cargo) {
                    const count = worker.cargo[id] ?? 0
                    if (count <= 0) continue
                    state.resources[id] = (state.resources[id] ?? 0) + count
                    hauled += count
                    value += count * salePrice(id)
                }
                worker.cargo = {}
                state.stats.totalHauled += hauled
                state.stats.hauledValue = (state.stats.hauledValue ?? 0) + value
                state.stats.tripsCompleted += 1
                grantXp(worker, 8 + (graph.nodeById.get(worker.at)?.tier ?? 1) * 4, at)
                feed(state, worker, autoBake)
                worker.activity = { type: 'idle' }
                break
            }
            case 'assault': {
                const node = graph.nodeById.get(a.at)
                const party = state.workers.filter(w => w.activity.type === 'assault' && w.activity.at === a.at)
                const power = party.reduce((sum, w) => sum + combatPower(statsFor(w)), 0)
                // A small deterministic swing, so a party sitting exactly on the
                // requirement is a gamble and comfortably over it is not.
                const roll = 0.9 + rng.next() * 0.2
                const won = power * roll >= (node?.power ?? Infinity)
                for (const member of party) {
                    member.activity = { type: 'idle' }
                    member.food = Math.max(0, member.food - (won ? 15 : 35))
                    grantXp(member, won ? 40 + (node?.tier ?? 1) * 25 : 10, at)
                }
                if (won && node) {
                    if (!state.clearedCamps.includes(node.id)) {
                        state.clearedCamps.push(node.id)
                        state.pendingCoins += node.loot?.coins ?? 0
                        for (const id in node.loot?.resources ?? {}) {
                            state.resources[id] = (state.resources[id] ?? 0) + (node.loot!.resources[id] ?? 0)
                        }
                        state.stats.campsCleared += 1
                    }
                    push({ at, kind: 'camp-cleared', nodeId: node.id, text: `${node.name} was cleared` })
                } else if (node) {
                    push({ at, kind: 'camp-failed', nodeId: node.id, text: `The assault on ${node.name} was driven back` })
                }
                break
            }
            default:
                break
        }
    }

    // --- main loop --------------------------------------------------------

    /**
     * Finish every refinery batch and research job whose clock has run out by
     * `at`. Both are queues rather than instant buttons, so a catch-up has to
     * settle them in time order alongside the workers.
     */
    const settleJobs = (at: number) => {
        if (state.refineJobs?.length) {
            const remaining: typeof state.refineJobs = []
            for (const job of state.refineJobs) {
                if (job.doneAt > at) {
                    remaining.push(job)
                    continue
                }
                const recipe = RECIPES.find(r => r.id === job.recipeId)
                if (recipe) {
                    state.resources[recipe.output] =
                        (state.resources[recipe.output] ?? 0) + recipe.outputCount * job.batches
                    push({
                        at: job.doneAt,
                        kind: 'refined',
                        text: `${recipe.outputCount * job.batches} ${RESOURCES[recipe.output]?.name ?? recipe.output} came off the line`
                    })
                }
            }
            state.refineJobs = remaining
        }

        if (state.researchJob && state.researchJob.doneAt <= at) {
            const done = state.researchJob
            if (!state.research.includes(done.id)) state.research.push(done.id)
            state.researchJob = null
            push({ at: done.doneAt, kind: 'researched', text: `Research complete: ${done.id}` })
        }
    }

    /** The soonest queued job, so the loop stops there rather than stepping past it. */
    const nextJobAt = (): number | null => {
        let soonest: number | null = null
        for (const job of state.refineJobs ?? []) {
            if (soonest === null || job.doneAt < soonest) soonest = job.doneAt
        }
        if (state.researchJob && (soonest === null || state.researchJob.doneAt < soonest)) {
            soonest = state.researchJob.doneAt
        }
        return soonest
    }

    settleJobs(t)

    let steps = 0
    while (t < now && steps++ < MAX_STEPS) {
        // Everything idle picks up work before we look for the next deadline.
        let changed = true
        let inner = 0
        while (changed && inner++ < 64) {
            changed = false
            for (const worker of state.workers) {
                if (startActivity(worker, t)) changed = true
            }
        }

        let next = now
        for (const worker of state.workers) {
            const end = activityEnd(worker)
            if (end !== null && end < next) next = end
        }
        // A finished batch can unblock a starving caravan, so the queues get a
        // say in where the clock stops next.
        const job = nextJobAt()
        if (job !== null && job > t && job < next) next = job
        t = next

        for (const worker of state.workers) {
            const end = activityEnd(worker)
            if (end !== null && end <= t) complete(worker, t)
        }
        settleJobs(t)
    }

    state.lastTick = now
    state.rngCursor = rng.cursor()
    // Keep the feed in the save so it survives a page change rather than only
    // showing whatever this one catch-up happened to produce.
    state.log = [...(state.log ?? []), ...events].slice(-LOG_LIMIT)
    return { events, truncated }
}

/**
 * Travel seconds from every reachable node back to the nearest capital, at base
 * speed and accounting for road levels. Exposed so the UI can tell a player how
 * long a worker still has before it is home, without re-deriving the graph.
 */
export function homeDistanceMap(state: CaravanState, world: World): Map<NodeId, number> {
    return buildGraph(state, world).homeDist
}

/**
 * When the client should call back for a fresh authoritative state: the soonest
 * moment any worker finishes what it is doing. Null means nothing is pending and
 * the client can sit still until the player does something.
 */
export function nextEventAt(state: CaravanState): number | null {
    let soonest: number | null = null
    for (const worker of state.workers) {
        const end = activityEnd(worker)
        if (end !== null && (soonest === null || end < soonest)) soonest = end
    }
    return soonest
}

/** Total combat power a set of workers brings to a camp. */
export function partyPower(state: CaravanState, workerIds: string[]): number {
    const bonuses = bonusesFor(state)
    return state.workers
        .filter(w => workerIds.includes(w.id))
        .reduce((sum, w) => sum + combatPower(derivedStats(w, state.items, bonuses)), 0)
}

export type { Bonuses }

/**
 * Project the caravan's throughput by running the real simulation forward on a
 * throwaway copy of the state. The sample is two hours because a single round
 * trip on a distant, well-drawn seam can take most of an hour -- a shorter
 * window reports zero for a caravan that is working perfectly well. It is the same code that pays out, so the number
 * on screen cannot drift from the number the server actually credits -- which a
 * hand-written "coins per hour" formula always eventually does.
 */
export function projectRates(state: CaravanState, world: World, sampleSeconds = 7200) {
    // A JSON round trip rather than structuredClone: on the client this is
    // called with a Vue reactive proxy, which structuredClone refuses to copy.
    // The save blob is plain JSON by construction, so nothing is lost.
    const clone: CaravanState = JSON.parse(JSON.stringify(state))
    const before = { ...clone.resources }
    const from = clone.lastTick

    advance(clone, world, from + sampleSeconds * 1000)

    const scale = 3600 / sampleSeconds
    const resources: Record<string, number> = {}
    for (const id in clone.resources) {
        const delta = (clone.resources[id] ?? 0) - (before[id] ?? 0)
        if (delta !== 0) resources[id] = delta * scale
    }
    // Measured from deliveries specifically, not from the net change in the
    // storehouse -- otherwise a refinery batch landing would be counted as if
    // the caravan had hauled it out of the ground.
    const harvestValue = (clone.stats.hauledValue ?? 0) - (state.stats.hauledValue ?? 0)
    return {
        harvestValuePerHour: harvestValue * scale,
        gemsPerHour: (clone.pendingGems - state.pendingGems) * scale,
        resourcesPerHour: resources,
        tripsPerHour: (clone.stats.tripsCompleted - state.stats.tripsCompleted) * scale
    }
}
