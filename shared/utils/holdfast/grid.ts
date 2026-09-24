// Holdfast — the tile grid: terrain, building occupancy, the enemy flow field
// (one Dijkstra pass from the keep, recomputed only when a structure changes)
// and A* for friendly move orders.

import { MAP_SIZE, type DifficultyDef } from './config'
import { rngInt, rngRange, type Rng } from './rng'

export const Terrain = {
    Grass: 0,
    Tree: 1,
    Rock: 2,
    Road: 3
} as const

const SQRT2 = Math.SQRT2
/**
 * A diagonal step may only cut a corner when both orthogonal cells are open
 * ground (roads and grass cost about 1). Walls have a finite cost for
 * pathing, but nobody can squeeze diagonally between two of them.
 */
const CORNER_OPEN = 1.5
const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DZ = [0, 0, 1, -1, 1, -1, 1, -1]

export class Grid {
    readonly size: number
    readonly terrain: Uint8Array
    /** Building id per cell, -1 when empty. */
    readonly occupant: Int32Array
    /** Enemy cost-to-keep per cell (Infinity where unreachable). Float64: a float32
     *  store rounds relaxed distances and makes Dijkstra re-expand forever. */
    readonly flow: Float64Array

    constructor(size = MAP_SIZE) {
        this.size = size
        this.terrain = new Uint8Array(size * size)
        this.occupant = new Int32Array(size * size).fill(-1)
        this.flow = new Float64Array(size * size).fill(Infinity)
    }

    idx(cx: number, cz: number): number {
        return cz * this.size + cx
    }

    inBounds(cx: number, cz: number): boolean {
        return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size
    }

    /** Trees and rocks: nobody walks or builds there. */
    solid(i: number): boolean {
        const t = this.terrain[i]!
        return t === Terrain.Tree || t === Terrain.Rock
    }

    cellAt(x: number, z: number): number {
        const cx = Math.floor(x)
        const cz = Math.floor(z)
        if (!this.inBounds(cx, cz)) return -1
        return this.idx(cx, cz)
    }
}

// ─── Terrain ─────────────────────────────────────────────────────────────

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
    const vx = bx - ax
    const vz = bz - az
    const len = vx * vx + vz * vz
    const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len)) : 0
    const dx = px - (ax + vx * t)
    const dz = pz - (az + vz * t)
    return Math.sqrt(dx * dx + dz * dz)
}

/** Roads from every lane to the keep, then clumps of trees and rocks around them. */
export function generateTerrain(grid: Grid, rng: Rng, difficulty: DifficultyDef): void {
    const n = grid.size
    const kx = difficulty.keep.x + 2
    const kz = difficulty.keep.z + 2
    const road = new Float32Array(n * n).fill(Infinity)

    for (const lane of difficulty.lanes) {
        // A gently wandering road: two jittered midpoints between spawn and keep.
        const pts: [number, number][] = [[lane.x + 0.5, lane.z + 0.5]]
        for (const t of [0.33, 0.66]) {
            const mx = lane.x + (kx - lane.x) * t
            const mz = lane.z + (kz - lane.z) * t
            pts.push([mx + rngRange(rng, -4, 4), mz + rngRange(rng, -4, 4)])
        }
        pts.push([kx, kz])
        for (let s = 0; s < pts.length - 1; s++) {
            const [ax, az] = pts[s]!
            const [bx, bz] = pts[s + 1]!
            for (let cz = 0; cz < n; cz++) {
                for (let cx = 0; cx < n; cx++) {
                    const d = distToSegment(cx + 0.5, cz + 0.5, ax, az, bx, bz)
                    const i = grid.idx(cx, cz)
                    if (d < road[i]!) road[i] = d
                }
            }
        }
    }
    for (let i = 0; i < n * n; i++) {
        if (road[i]! < 1.3) grid.terrain[i] = Terrain.Road
    }

    const clear = (cx: number, cz: number): boolean => {
        const i = grid.idx(cx, cz)
        if (road[i]! < 3) return false
        const dk = Math.hypot(cx + 0.5 - kx, cz + 0.5 - kz)
        if (dk < 16) return false
        for (const lane of difficulty.lanes) {
            if (Math.hypot(cx - lane.x, cz - lane.z) < 5) return false
        }
        return grid.terrain[i] === Terrain.Grass
    }

    const clumps = Math.round(n * n / 150)
    for (let c = 0; c < clumps; c++) {
        const ox = rngInt(rng, 0, n - 1)
        const oz = rngInt(rng, 0, n - 1)
        const rock = rng() < 0.22
        const count = rock ? rngInt(rng, 1, 4) : rngInt(rng, 3, 11)
        const spread = rock ? 1.2 : 2.6
        for (let k = 0; k < count; k++) {
            const cx = Math.round(ox + rngRange(rng, -spread, spread))
            const cz = Math.round(oz + rngRange(rng, -spread, spread))
            if (!grid.inBounds(cx, cz) || !clear(cx, cz)) continue
            grid.terrain[grid.idx(cx, cz)] = rock ? Terrain.Rock : Terrain.Tree
        }
    }
    // A thin treeline hugging the map edge frames the play area; lanes keep their gaps.
    for (let cz = 0; cz < n; cz++) {
        for (let cx = 0; cx < n; cx++) {
            const edge = Math.min(cx, cz, n - 1 - cx, n - 1 - cz)
            if (edge === 0 && rng() < 0.55 && clear(cx, cz)) grid.terrain[grid.idx(cx, cz)] = Terrain.Tree
        }
    }
}

// ─── Min-heap on (cell, priority) ────────────────────────────────────────

class Heap {
    private cells: number[] = []
    private prio: number[] = []

    /** Priority of the cell returned by the last pop(). */
    lastPriority = 0

    get length(): number {
        return this.cells.length
    }

    push(cell: number, p: number): void {
        const c = this.cells
        const q = this.prio
        let i = c.length
        c.push(cell)
        q.push(p)
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (q[parent]! <= p) break
            c[i] = c[parent]!
            q[i] = q[parent]!
            i = parent
        }
        c[i] = cell
        q[i] = p
    }

    /** Returns the cell with the lowest priority; call only when length > 0. */
    pop(): number {
        const c = this.cells
        const q = this.prio
        const top = c[0]!
        this.lastPriority = q[0]!
        const lastC = c.pop()!
        const lastQ = q.pop()!
        const n = c.length
        if (n > 0) {
            let i = 0
            while (true) {
                const l = i * 2 + 1
                if (l >= n) break
                const r = l + 1
                const m = r < n && q[r]! < q[l]! ? r : l
                if (q[m]! >= lastQ) break
                c[i] = c[m]!
                q[i] = q[m]!
                i = m
            }
            c[i] = lastC
            q[i] = lastQ
        }
        return top
    }
}

/**
 * Dijkstra outward from the goal cells. `enterCost(i)` is the price of stepping
 * into cell i (Infinity = never). Diagonals may not cut a blocked corner.
 */
export function computeFlow(grid: Grid, goals: readonly number[], enterCost: (i: number) => number): void {
    const cost = new Float64Array(grid.size * grid.size)
    for (let i = 0; i < cost.length; i++) cost[i] = enterCost(i)
    computeFlowFromCosts(grid, goals, cost)
}

/** computeFlow with the enter cost of every cell precomputed (the fast path). */
export function computeFlowFromCosts(grid: Grid, goals: readonly number[], cost: Float64Array): void {
    const n = grid.size
    const flow = grid.flow
    flow.fill(Infinity)
    const heap = new Heap()
    for (const g of goals) {
        flow[g] = 0
        heap.push(g, 0)
    }
    while (heap.length > 0) {
        const cur = heap.pop()
        const base = flow[cur]!
        if (heap.lastPriority > base) continue
        const cx = cur % n
        const cz = (cur - cx) / n
        for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d]!
            const nz = cz + DZ[d]!
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
            const ni = nz * n + nx
            const step = cost[ni]!
            if (step === Infinity) continue
            if (d >= 4) {
                if (cost[cz * n + nx]! > CORNER_OPEN || cost[nz * n + cx]! > CORNER_OPEN) continue
            }
            const nd = base + step * (d >= 4 ? SQRT2 : 1)
            if (nd < flow[ni]!) {
                flow[ni] = nd
                heap.push(ni, nd)
            }
        }
    }
}

/**
 * Lowest-flow neighbour of a cell (the next step toward the keep), or -1.
 * With `open`, a diagonal is only taken when both cells beside it are open.
 */
export function flowNext(grid: Grid, cell: number, open?: (i: number) => boolean): number {
    const n = grid.size
    const cx = cell % n
    const cz = (cell - cx) / n
    let best = -1
    let bestV = grid.flow[cell]!
    for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d]!
        const nz = cz + DZ[d]!
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
        const ni = nz * n + nx
        const v = grid.flow[ni]!
        if (d >= 4 && open && (!open(cz * n + nx) || !open(nz * n + cx))) continue
        if (v < bestV) {
            bestV = v
            best = ni
        }
    }
    return best
}

/**
 * A* between two cells. `enterCost(i)` as in computeFlow. Returns the cell
 * list from start (exclusive) to goal (inclusive), or null when unreachable.
 */
export function findPath(grid: Grid, from: number, to: number, enterCost: (i: number) => number): number[] | null {
    if (from === to) return []
    const n = grid.size
    const g = new Float64Array(n * n).fill(Infinity)
    const came = new Int32Array(n * n).fill(-1)
    const tx = to % n
    const tz = (to - tx) / n
    const h = (i: number): number => {
        const x = i % n
        const dx = Math.abs(x - tx)
        const dz = Math.abs((i - x) / n - tz)
        return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)
    }
    const heap = new Heap()
    g[from] = 0
    heap.push(from, h(from))
    let expanded = 0
    while (heap.length > 0) {
        const cur = heap.pop()
        if (cur === to) break
        if (++expanded > n * n) break
        const cx = cur % n
        const cz = (cur - cx) / n
        for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d]!
            const nz = cz + DZ[d]!
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue
            const ni = nz * n + nx
            const step = enterCost(ni)
            if (step === Infinity) continue
            if (d >= 4 && (enterCost(cz * n + nx) > CORNER_OPEN || enterCost(nz * n + cx) > CORNER_OPEN)) continue
            const nd = g[cur]! + step * (d >= 4 ? SQRT2 : 1)
            if (nd < g[ni]!) {
                g[ni] = nd
                came[ni] = cur
                heap.push(ni, nd + h(ni))
            }
        }
    }
    if (g[to] === Infinity) return null
    const path: number[] = []
    for (let c = to; c !== from; c = came[c]!) path.push(c)
    return path.reverse()
}
