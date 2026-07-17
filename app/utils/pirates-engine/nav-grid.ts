import { CELL, GRID_H, GRID_W, ISLAND_COUNT_MAX, ISLAND_COUNT_MIN, SHIP_RADIUS, WORLD_H, WORLD_W } from './constants'
import { dist, randRange, segPointDist } from './math'
import type { Island } from './types'

/** Randomly place non-overlapping islands, keeping the player spawn clear. */
export function generateIslandLayout(): Island[] {
    const islands: Island[] = []
    const count = Math.round(randRange(ISLAND_COUNT_MIN, ISLAND_COUNT_MAX))
    let attempts = 0
    while (islands.length < count && attempts < 200) {
        attempts++
        const r = randRange(42, 78)
        const x = randRange(r + 90, WORLD_W - r - 90)
        const y = randRange(r + 90, WORLD_H - r - 90)
        // Keep the player spawn and neighbouring islands clear so no ship
        // can start boxed in.
        if (dist(x, y, WORLD_W / 2, WORLD_H / 2) < r + 170) continue
        if (islands.some(i => dist(x, y, i.x, i.y) < i.r + r + 150)) continue
        islands.push({ x, y, r })
    }
    return islands
}

/**
 * Pathfinding over a coarse grid of circular island obstacles. Ships are
 * treated as circles of SHIP_RADIUS for clearance checks. Owns the island
 * list and the derived blocked-cell grid; callers never touch grid indices
 * directly.
 */
export class PirateNavGrid {
    private islandList: Island[] = []
    private blocked: Uint8Array = new Uint8Array(GRID_W * GRID_H)

    get islands(): readonly Island[] {
        return this.islandList
    }

    setIslands(islands: Island[]) {
        this.islandList = islands
        this.rebuildGrid()
    }

    private rebuildGrid() {
        this.blocked.fill(0)
        for (let gy = 0; gy < GRID_H; gy++) {
            for (let gx = 0; gx < GRID_W; gx++) {
                const cx = gx * CELL + CELL / 2
                const cy = gy * CELL + CELL / 2
                for (const island of this.islandList) {
                    if (dist(cx, cy, island.x, island.y) < island.r + SHIP_RADIUS) {
                        this.blocked[gy * GRID_W + gx] = 1
                        break
                    }
                }
            }
        }
    }

    private isBlockedCell(gx: number, gy: number) {
        if (gx < 0 || gy < 0 || gx >= GRID_W || gy >= GRID_H) return true
        return this.blocked[gy * GRID_W + gx] === 1
    }

    pointInIsland(x: number, y: number, extra = SHIP_RADIUS) {
        return this.islandList.some(i => dist(x, y, i.x, i.y) < i.r + extra)
    }

    /** True when a ship-width corridor from a to b avoids every island. */
    segmentClear(ax: number, ay: number, bx: number, by: number) {
        for (const island of this.islandList) {
            if (segPointDist(ax, ay, bx, by, island.x, island.y) < island.r + SHIP_RADIUS) return false
        }
        return true
    }

    /** Snap a (possibly blocked) point to the nearest reachable water cell center. */
    nearestFreePoint(x: number, y: number): { x: number, y: number } {
        const gx = Math.floor(x / CELL)
        const gy = Math.floor(y / CELL)
        if (!this.isBlockedCell(gx, gy) && !this.pointInIsland(x, y)) return { x, y }
        for (let radius = 1; radius < Math.max(GRID_W, GRID_H); radius++) {
            let best: { x: number, y: number } | null = null
            let bestD = Infinity
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
                    if (this.isBlockedCell(gx + dx, gy + dy)) continue
                    const px = (gx + dx) * CELL + CELL / 2
                    const py = (gy + dy) * CELL + CELL / 2
                    const d = dist(px, py, x, y)
                    if (d < bestD) { best = { x: px, y: py }; bestD = d }
                }
            }
            if (best) return best
        }
        return { x, y }
    }

    /**
     * A* over the coarse grid with string-pulling smoothing. Returns waypoints
     * (excluding the start) or a straight line when nothing is in the way.
     */
    computePath(fromX: number, fromY: number, toX: number, toY: number): { x: number, y: number }[] {
        const goal = this.nearestFreePoint(toX, toY)
        if (this.segmentClear(fromX, fromY, goal.x, goal.y)) return [goal]

        const startGx = Math.floor(fromX / CELL)
        const startGy = Math.floor(fromY / CELL)
        const goalGx = Math.floor(goal.x / CELL)
        const goalGy = Math.floor(goal.y / CELL)
        const startIdx = startGy * GRID_W + startGx
        const goalIdx = goalGy * GRID_W + goalGx

        const gScore = new Float32Array(GRID_W * GRID_H).fill(Infinity)
        const cameFrom = new Int32Array(GRID_W * GRID_H).fill(-1)
        const closed = new Uint8Array(GRID_W * GRID_H)
        gScore[startIdx] = 0
        // Small open list — the grid is under a thousand cells, a linear-scan
        // priority queue is plenty.
        const open: number[] = [startIdx]
        const h = (idx: number) => {
            const gx = idx % GRID_W
            const gy = Math.floor(idx / GRID_W)
            return Math.hypot(gx - goalGx, gy - goalGy)
        }

        let found = false
        while (open.length) {
            let bestI = 0
            let bestF = Infinity
            for (let i = 0; i < open.length; i++) {
                const f = gScore[open[i]!]! + h(open[i]!)
                if (f < bestF) { bestF = f; bestI = i }
            }
            const current = open.splice(bestI, 1)[0]!
            if (current === goalIdx) { found = true; break }
            if (closed[current]) continue
            closed[current] = 1

            const cgx = current % GRID_W
            const cgy = Math.floor(current / GRID_W)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue
                    const ngx = cgx + dx
                    const ngy = cgy + dy
                    if (this.isBlockedCell(ngx, ngy)) continue
                    // No diagonal corner cutting between two blocked cells
                    if (dx !== 0 && dy !== 0 && (this.isBlockedCell(cgx + dx, cgy) || this.isBlockedCell(cgx, cgy + dy))) continue
                    const nIdx = ngy * GRID_W + ngx
                    if (closed[nIdx]) continue
                    const tentative = gScore[current]! + Math.hypot(dx, dy)
                    if (tentative < gScore[nIdx]!) {
                        gScore[nIdx] = tentative
                        cameFrom[nIdx] = current
                        open.push(nIdx)
                    }
                }
            }
        }

        if (!found) return []

        const cells: { x: number, y: number }[] = []
        let cur = goalIdx
        while (cur !== -1 && cur !== startIdx) {
            cells.push({ x: (cur % GRID_W) * CELL + CELL / 2, y: Math.floor(cur / GRID_W) * CELL + CELL / 2 })
            cur = cameFrom[cur]!
        }
        cells.reverse()
        cells.push(goal)

        // String-pulling: drop intermediate waypoints whenever the direct hop
        // to a later one already clears every island.
        const smoothed: { x: number, y: number }[] = []
        let anchor = { x: fromX, y: fromY }
        let i = 0
        while (i < cells.length) {
            let furthest = i
            for (let j = cells.length - 1; j > i; j--) {
                if (this.segmentClear(anchor.x, anchor.y, cells[j]!.x, cells[j]!.y)) { furthest = j; break }
            }
            smoothed.push(cells[furthest]!)
            anchor = cells[furthest]!
            i = furthest + 1
        }
        return smoothed
    }
}
