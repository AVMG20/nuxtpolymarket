// Gridworks: a plot's saved state, the date-based settle and the player's
// actions. The server runs these under a row lock; the client runs the same
// code to predict the result instantly.
import {
    BUILDINGS, CHUNK, HAND_MINE, ITEM_IDS, MAP_CHUNKS, MAP_TILES, RECIPES, RESEARCH_BY_ID, SILO_MULT, START_CHUNKS, START_STOCK, STORAGE_CAP,
    chunkCost, hasKey, isUnlocked, maxMk, researchAvailable, storageLevel, upgradeCost,
    type ItemId, type Kind, type Stock
} from './defs'
import { key3, occupancy, placeError, rot, type Dir, type Entity, type PlaceError } from './layout'
import { solve, type Solution, type SolveFlags } from './flow'
import { chunkNeighbours, oreAt, oreMap } from './world'
import { GOAL_BY_ID, currentGoal, goalMet } from './goals'

export interface GridState {
    seed: number
    entities: Entity[]
    chunks: string[]
    stock: Stock
    done: string[]
    /** Research queue; the first entry is the one the labs work on. */
    queue: string[]
    /** Items delivered per research id. */
    progress: Record<string, Stock>
    /** Hand-mining token bucket. */
    mine: { tokens: number, at: number }
    /** ms since epoch. */
    settledAt: number
    /** Bumped on every layout change (solver cache key). */
    layout: number
    /** Goals claimed, in order. */
    goals: string[]
    /** Ore dug by hand, ever. */
    mined: number
}

export const QUEUE_MAX = 1
export const QUEUE_MAX_AUTO = 5
export const MINE_BUCKET = 24
export const MINE_REFILL = 8

export function newState(seed: number, now: number): GridState {
    // A storage block in the middle so there is somewhere to route the first ore.
    const mid = MAP_TILES / 2
    return {
        seed,
        entities: [{ k: 'storage', x: mid - 1, y: mid - 1, r: 0 }],
        chunks: [...START_CHUNKS],
        stock: { ...START_STOCK },
        done: [],
        queue: [],
        progress: {},
        mine: { tokens: MINE_BUCKET, at: now },
        settledAt: now,
        layout: 1,
        goals: [],
        mined: 0
    }
}

export function storageCap(s: Pick<GridState, 'entities' | 'done'>): number {
    let blocks = 1
    for (const e of s.entities) {
        if (e.k === 'storage') blocks += 1
        else if (e.k === 'silo') blocks += SILO_MULT
    }
    return blocks * STORAGE_CAP[storageLevel(s.done)]!
}

export function remaining(s: GridState, id: string): Stock {
    const node = RESEARCH_BY_ID[id]
    if (!node) return {}
    const got = s.progress[id] ?? {}
    const out: Stock = {}
    for (const [k, v] of Object.entries(node.cost) as [ItemId, number][]) {
        const left = v - (got[k] ?? 0)
        if (left > 1e-6) out[k] = left
    }
    return out
}

export function flagsOf(s: GridState): SolveFlags {
    const cap = storageCap(s)
    const blocked = ITEM_IDS.filter(id => (s.stock[id] ?? 0) >= cap - 1e-6)
    const active = s.queue[0]
    const labWants = active ? Object.keys(remaining(s, active)) as ItemId[] : []
    return { blocked, labWants }
}

// ---- solver cache -----------------------------------------------------------------

const cache = new Map<string, Solution>()

/** `scope` keeps different plots apart (the user id on the server). */
export function solveCached(scope: string, s: GridState, flags = flagsOf(s)): Solution {
    const key = `${scope}|${s.seed}|${s.layout}|${flags.blocked.join(',')}|${flags.labWants.join(',')}`
    const hit = cache.get(key)
    if (hit) {
        cache.delete(key)
        cache.set(key, hit)
        return hit
    }
    const sol = solve(s.entities, oreMap(s.seed), flags)
    cache.set(key, sol)
    if (cache.size > 256) cache.delete(cache.keys().next().value!)
    return sol
}

// ---- settle -------------------------------------------------------------------------

export interface SettleEvent { t: number, kind: 'research', id: string }

/** Advances the plot from settledAt to `now` using the steady-state rates. */
export function settle(scope: string, s: GridState, now: number): SettleEvent[] {
    const events: SettleEvent[] = []
    // A clock that ran backwards never rewinds the plot.
    if (now <= s.settledAt) return events
    let t = s.settledAt
    for (let guard = 0; guard < 200 && now - t > 0; guard++) {
        const flags = flagsOf(s)
        const sol = solveCached(scope, s, flags)
        const cap = storageCap(s)
        const left = (now - t) / 1000
        // Time until the next thing changes the flow: an item filling up, or a
        // research need being met.
        let step = left
        for (const [k, rate] of Object.entries(sol.store) as [ItemId, number][]) {
            const room = cap - (s.stock[k] ?? 0)
            if (rate > 0 && room > 0) step = Math.min(step, room / rate)
        }
        const active = s.queue[0]
        const need = active ? remaining(s, active) : {}
        for (const [k, rate] of Object.entries(sol.lab) as [ItemId, number][]) {
            const n = need[k] ?? 0
            if (rate > 0 && n > 0) step = Math.min(step, n / rate)
        }
        step = Math.max(step, Math.min(left, 0.001))
        for (const [k, rate] of Object.entries(sol.store) as [ItemId, number][]) {
            const cur = s.stock[k] ?? 0
            if (cur >= cap) continue
            s.stock[k] = Math.min(cap, cur + rate * step)
        }
        if (active) {
            const prog = s.progress[active] ??= {}
            for (const [k, rate] of Object.entries(sol.lab) as [ItemId, number][]) {
                const total = RESEARCH_BY_ID[active]!.cost[k] ?? 0
                prog[k] = Math.min(total, (prog[k] ?? 0) + rate * step)
            }
        }
        t += step * 1000
        if (active && !Object.keys(remaining(s, active)).length) {
            s.done.push(active)
            s.queue.shift()
            delete s.progress[active]
            events.push({ t, kind: 'research', id: active })
        }
    }
    // If the guard ever cuts the loop short, the time left is settled by the next call.
    s.settledAt = now - t > 0 ? Math.floor(t) : now
    return events
}

// ---- ops --------------------------------------------------------------------------

export type Op =
    | { op: 'place', e: Entity }
    | { op: 'remove', x: number, y: number, l: number }
    | { op: 'rotate', x: number, y: number, l: number, r: Dir }
    | { op: 'move', x: number, y: number, l: number, to: { x: number, y: number, r: Dir } }
    | { op: 'recipe', x: number, y: number, recipe: string }
    | { op: 'filter', x: number, y: number, item: ItemId | null }
    | { op: 'upgrade', x: number, y: number, l: number }
    | { op: 'chunk', key: string }
    | { op: 'research', id: string }
    | { op: 'unqueue', id: string }
    | { op: 'mine', x: number, y: number, n: number }
    | { op: 'goal', id: string }

export type OpError = PlaceError | 'afford' | 'missing' | 'mk' | 'research' | 'queue' | 'adjacent' | 'busy' | 'full' | 'goal' | 'invalid'

export function canAfford(stock: Stock, cost: Stock): boolean {
    return (Object.entries(cost) as [ItemId, number][]).every(([k, v]) => (stock[k] ?? 0) >= v - 1e-9)
}
function pay(stock: Stock, cost: Stock) {
    for (const [k, v] of Object.entries(cost) as [ItemId, number][]) stock[k] = Math.max(0, (stock[k] ?? 0) - v)
}
/**
 * Adds items without looking at the storage cap. The cap only stops what flows
 * in (belts in settle, hand mining): refunds and goal rewards always arrive in
 * full, so removing a building never destroys what it cost.
 */
function give(stock: Stock, items: Stock) {
    for (const [k, v] of Object.entries(items) as [ItemId, number][]) stock[k] = (stock[k] ?? 0) + v
}

/** Everything spent on an entity: its build cost and each upgrade. */
export function spentOn(e: Entity): Stock {
    const out: Stock = { ...BUILDINGS[e.k].cost }
    for (let mk = 2; mk <= (e.mk ?? 1); mk++) give(out, upgradeCost(e.k, mk))
    return out
}

export function entityAt(s: GridState, x: number, y: number, l: number): number {
    return occupancy(s.entities).get(key3(x, y, l)) ?? -1
}

function clean(e: Entity): Entity {
    const out: Entity = { k: e.k, x: e.x | 0, y: e.y | 0, r: (rot(e.r | 0, 0)) }
    const role = BUILDINGS[e.k]?.role
    if ((role === 'belt' || role === 'ramp') && e.l) out.l = e.l | 0
    if (e.mk && e.mk > 1) out.mk = e.mk | 0
    if (role === 'machine' && e.recipe) out.recipe = e.recipe
    if (role === 'smart' && e.filter && (ITEM_IDS as readonly string[]).includes(e.filter)) out.filter = e.filter
    return out
}

/**
 * Applies one action. Returns an error (and leaves the state untouched) when it
 * can't. `sol` saves the client a main-thread solve when it claims a goal;
 * without one the goal is checked against a fresh solve cached under `scope`
 * (the user id on the server).
 */
export function applyOp(s: GridState, op: Op, now: number, sol?: Solution | null, scope = 'local'): OpError | null {
    switch (op.op) {
        case 'place': {
            if (!hasKey(BUILDINGS, op.e?.k)) return 'invalid'
            const e = clean(op.e)
            if (!isUnlocked(e.k, s.done)) return 'locked'
            const err = placeError(s, oreMap(s.seed), e, s.done)
            if (err) return err
            const cost = BUILDINGS[e.k].cost
            if (!canAfford(s.stock, cost)) return 'afford'
            pay(s.stock, cost)
            s.entities.push(e)
            s.layout++
            return null
        }
        case 'remove': {
            const i = entityAt(s, op.x, op.y, op.l)
            if (i < 0) return 'missing'
            const [e] = s.entities.splice(i, 1)
            give(s.stock, spentOn(e!))
            s.layout++
            return null
        }
        case 'rotate': case 'move': {
            const i = entityAt(s, op.x, op.y, op.l)
            if (i < 0) return 'missing'
            const old = s.entities[i]!
            const to = op.op === 'move' ? op.to : { x: old.x, y: old.y, r: op.r }
            const next = clean({ ...old, x: to.x, y: to.y, r: to.r })
            const err = placeError(s, oreMap(s.seed), next, s.done, undefined, i)
            if (err) return err
            s.entities[i] = next
            s.layout++
            return null
        }
        case 'recipe': {
            const i = entityAt(s, op.x, op.y, 0)
            const e = s.entities[i]
            if (!e) return 'missing'
            if (!hasKey(RECIPES, op.recipe)) return 'recipe'
            const next = { ...e, recipe: op.recipe }
            const err = placeError(s, oreMap(s.seed), next, s.done, undefined, i)
            if (err) return err
            s.entities[i] = next
            s.layout++
            return null
        }
        case 'filter': {
            const i = entityAt(s, op.x, op.y, 0)
            const e = s.entities[i]
            if (!e || e.k !== 'smart-splitter') return 'missing'
            if (op.item !== null && !(ITEM_IDS as readonly string[]).includes(op.item)) return 'invalid'
            const next: Entity = { ...e }
            if (op.item) next.filter = op.item
            else delete next.filter
            s.entities[i] = next
            s.layout++
            return null
        }
        case 'upgrade': {
            const i = entityAt(s, op.x, op.y, op.l)
            const e = s.entities[i]
            if (!e) return 'missing'
            const to = (e.mk ?? 1) + 1
            if (to > maxMk(e.k, s.done)) return 'mk'
            const cost = upgradeCost(e.k, to)
            if (!canAfford(s.stock, cost)) return 'afford'
            pay(s.stock, cost)
            s.entities[i] = { ...e, mk: to }
            s.layout++
            return null
        }
        case 'chunk': {
            if (!s.done.includes('land-1')) return 'locked'
            if (s.chunks.includes(op.key)) return 'blocked'
            if (!validChunkKey(op.key)) return 'invalid'
            if (!s.chunks.some(c => chunkNeighbours(c).includes(op.key))) return 'adjacent'
            const cost = chunkCost(s.chunks.length - START_CHUNKS.length)
            if (!canAfford(s.stock, cost)) return 'afford'
            pay(s.stock, cost)
            s.chunks.push(op.key)
            return null
        }
        case 'research': {
            if (!researchAvailable(op.id, s.done)) return 'research'
            if (s.queue.includes(op.id)) return 'queue'
            const max = s.done.includes('auto-queue') ? QUEUE_MAX_AUTO : QUEUE_MAX
            if (s.queue.length >= max) {
                // Without a queue, picking another research swaps the active one.
                if (max > 1) return 'queue'
                s.queue = []
            }
            s.queue.push(op.id)
            return null
        }
        case 'unqueue': {
            if (!s.queue.includes(op.id)) return 'missing'
            s.queue = s.queue.filter(q => q !== op.id)
            return null
        }
        case 'mine': {
            const ore = oreAt(oreMap(s.seed), op.x, op.y)
            if (!ore || ore === 'oil' || ore === 'crystal') return 'ore'
            if (!s.chunks.includes(`${Math.floor(op.x / CHUNK)},${Math.floor(op.y / CHUNK)}`)) return 'land'
            const tokens = Math.min(MINE_BUCKET, s.mine.tokens + (now - s.mine.at) / 1000 * MINE_REFILL)
            // Hand mining stops at the storage cap, like the belts do.
            const room = Math.floor((storageCap(s) - (s.stock[ore] ?? 0)) / HAND_MINE)
            if (room < 1) return 'full'
            const n = Math.max(0, Math.min(Math.floor(op.n), Math.floor(tokens), room))
            s.mine = { tokens: tokens - n, at: now }
            if (!n) return 'busy'
            give(s.stock, { [ore]: n * HAND_MINE })
            s.mined += n
            return null
        }
        case 'goal': {
            // Goals are claimed in order, once each, and only when met.
            const g = currentGoal(s)
            if (!g || g.id !== op.id) return 'missing'
            if (!goalMet(g, s, sol ?? solveCached(scope, s))) return 'goal'
            give(s.stock, g.reward)
            s.goals.push(g.id)
            return null
        }
    }
    return 'invalid'
}

/** Kinds the build bar shows, in order, per category. */
export function buildable(done: readonly string[]): Kind[] {
    return (Object.keys(BUILDINGS) as Kind[]).filter(k => isUnlocked(k, done))
}

// ---- input -------------------------------------------------------------------------

const isItem = (v: unknown): v is ItemId => typeof v === 'string' && (ITEM_IDS as readonly string[]).includes(v)

const int = (v: unknown, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null

/** A chunk key in canonical form ('5,6') that lies on the map. */
function validChunkKey(key: unknown): key is string {
    if (typeof key !== 'string' || !/^\d{1,2},\d{1,2}$/.test(key)) return false
    const [cx, cy] = key.split(',').map(Number) as [number, number]
    return cx < MAP_CHUNKS && cy < MAP_CHUNKS && key === `${cx},${cy}`
}

/**
 * Turns untrusted JSON into an Op, or null. Every id is checked against its
 * table here, so nothing downstream looks up a string the client made up.
 */
export function parseOp(raw: unknown): Op | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const x = int(o.x, 0, MAP_TILES - 1)
    const y = int(o.y, 0, MAP_TILES - 1)
    const l = int(o.l ?? 0, 0, 2)
    const r = int(o.r, 0, 3) as Dir | null
    switch (o.op) {
        case 'place': {
            const e = o.e as Record<string, unknown> | undefined
            if (!e || typeof e !== 'object' || !hasKey(BUILDINGS, e.k)) return null
            const ex = int(e.x, 0, MAP_TILES - 1)
            const ey = int(e.y, 0, MAP_TILES - 1)
            const er = int(e.r, 0, 3) as Dir | null
            const el = int(e.l ?? 0, 0, 2)
            if (ex === null || ey === null || er === null || el === null) return null
            const ent: Entity = { k: e.k, x: ex, y: ey, r: er }
            if (el) ent.l = el
            if (e.recipe !== undefined && e.recipe !== null) {
                if (!hasKey(RECIPES, e.recipe)) return null
                ent.recipe = e.recipe
            }
            if (e.filter !== undefined && e.filter !== null) {
                if (!isItem(e.filter)) return null
                ent.filter = e.filter
            }
            return { op: 'place', e: ent }
        }
        case 'remove': case 'upgrade':
            return x === null || y === null || l === null ? null : { op: o.op, x, y, l }
        case 'rotate':
            return x === null || y === null || l === null || r === null ? null : { op: 'rotate', x, y, l, r }
        case 'move': {
            const to = o.to as Record<string, unknown> | undefined
            const tx = int(to?.x, 0, MAP_TILES - 1)
            const ty = int(to?.y, 0, MAP_TILES - 1)
            const tr = int(to?.r, 0, 3) as Dir | null
            if (x === null || y === null || l === null || tx === null || ty === null || tr === null) return null
            return { op: 'move', x, y, l, to: { x: tx, y: ty, r: tr } }
        }
        case 'recipe':
            return x === null || y === null || !hasKey(RECIPES, o.recipe) ? null : { op: 'recipe', x, y, recipe: o.recipe }
        case 'filter':
            return x === null || y === null || (o.item !== null && !isItem(o.item)) ? null : { op: 'filter', x, y, item: o.item }
        case 'chunk':
            return validChunkKey(o.key) ? { op: 'chunk', key: o.key } : null
        case 'research': case 'unqueue':
            return hasKey(RESEARCH_BY_ID, o.id) ? { op: o.op, id: o.id } : null
        case 'goal':
            return hasKey(GOAL_BY_ID, o.id) ? { op: 'goal', id: o.id } : null
        case 'mine': {
            const n = int(o.n, 1, 100)
            return x === null || y === null || n === null ? null : { op: 'mine', x, y, n }
        }
    }
    return null
}
