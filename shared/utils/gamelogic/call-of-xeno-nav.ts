// Call of Xeno — zombie navigation.
//
// The old waypoint graph sent zombies through the centre of every room and
// gave them nothing but a wall-slide hack for local avoidance, so packs
// ground themselves against cover and detoured before attacking. This module
// replaces it: the same solids the physics uses are rasterised into a
// two-storey walkability grid with per-cell clearance, A* over that grid
// produces the route, and line-of-sight string pulling turns it into a short
// list of corners the zombie can walk between in straight lines.
//
// Level 0 is the ground floor (the ramps are plain floor to walk on), level 1
// the deck and catwalk. Ramp cells exist on both levels and they are the only
// neighbours that cross storeys — exactly how the building works. Doors and
// live barrels are baked in, so a route never goes anywhere the collision
// would not let the body go, and cells carry a clearance so a Brute is not
// routed through a gap only a Crawler fits through.

import {
    CALL_OF_XENO_SHELL,
    CALL_OF_XENO_PLATFORMS,
    CALL_OF_XENO_RAMPS,
    CALL_OF_XENO_UPPER_Y,
    collisionSolids,
    solidsInBand,
    type CallOfXenoSolid
} from './call-of-xeno-map'

export const CALL_OF_XENO_NAV_CELL = 0.5
/** Body height baked into the grid — the same band the walkers collide in. */
const NAV_BODY = 1.8
const LEVELS = 2
const DIAG = Math.SQRT2
/** Clearance padding on top of the body radius, so routes do not shave walls. */
const CLEARANCE_PAD = 0.25

export interface CallOfXenoNavPoint {
    x: number
    z: number
    level: number
}

export interface CallOfXenoNavGrid {
    cell: number
    cols: number
    rows: number
    /** Cells inside a ramp — the only place a route may change storey. */
    ramp: Uint8Array
    /** Per level: 1 when the cell holds geometry. Index is row * cols + col. */
    blocked: Uint8Array[]
    /** Per level: metres from the cell centre to the nearest blocked cell. */
    clearance: Float32Array[]
}

/** Which storey a body at height `y` belongs to. Ramp middles round up. */
export function navLevelOf(y: number): number {
    return y >= CALL_OF_XENO_UPPER_Y / 2 ? 1 : 0
}

function overlaps(aMin: number, aMax: number, bMin: number, bMax: number) {
    return aMin < bMax && aMax > bMin
}

/**
 * Distance transform over the blocked mask, in metres from each free cell's
 * centre to the nearest blocked cell centre. Cells beyond the grid edge count
 * as blocked, so a route never hugs the outer shell either.
 */
function chamfer(blocked: Uint8Array, cols: number, rows: number): Float32Array {
    const d = new Float32Array(blocked.length)
    for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : Infinity

    const at = (col: number, row: number): number => {
        if (col < 0 || col >= cols || row < 0 || row >= rows) return 0
        return d[row * cols + col]!
    }

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const i = row * cols + col
            if (blocked[i]) continue
            d[i] = Math.min(
                d[i]!,
                at(col - 1, row) + 1,
                at(col, row - 1) + 1,
                at(col - 1, row - 1) + DIAG,
                at(col + 1, row - 1) + DIAG
            )
        }
    }
    for (let row = rows - 1; row >= 0; row--) {
        for (let col = cols - 1; col >= 0; col--) {
            const i = row * cols + col
            if (blocked[i]) continue
            d[i] = Math.min(
                d[i]!,
                at(col + 1, row) + 1,
                at(col, row + 1) + 1,
                at(col + 1, row + 1) + DIAG,
                at(col - 1, row + 1) + DIAG
            )
        }
    }

    for (let i = 0; i < d.length; i++) d[i] = d[i]! * CALL_OF_XENO_NAV_CELL
    return d
}

/** Rasterises the current world into a navigation grid. */
export function buildNavGrid(openDoors: ReadonlySet<string>, extra: readonly CallOfXenoSolid[] = []): CallOfXenoNavGrid {
    const solids = collisionSolids(openDoors, extra)
    const cols = Math.ceil(CALL_OF_XENO_SHELL.maxX / CALL_OF_XENO_NAV_CELL)
    const rows = Math.ceil(CALL_OF_XENO_SHELL.maxZ / CALL_OF_XENO_NAV_CELL)
    const count = cols * rows

    // Ramp cells first: they extend the upper storey beyond the platform.
    const ramp = new Uint8Array(count)
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const i = row * cols + col
            const cx = (col + 0.5) * CALL_OF_XENO_NAV_CELL
            const cz = (row + 0.5) * CALL_OF_XENO_NAV_CELL
            for (const r of CALL_OF_XENO_RAMPS) {
                if (cx > r.box.minX && cx < r.box.maxX && cz > r.box.minZ && cz < r.box.maxZ) {
                    ramp[i] = 1
                    break
                }
            }
        }
    }

    const feet = [0, CALL_OF_XENO_UPPER_Y]
    const blocked: Uint8Array[] = []
    const clearance: Float32Array[] = []

    for (let level = 0; level < LEVELS; level++) {
        const boxes = solidsInBand(solids, feet[level]!, NAV_BODY)
        const mask = new Uint8Array(count)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col
                if (level === 1 && !ramp[i]) {
                    // Upstairs only exists where the deck is.
                    let deck = false
                    for (const platform of CALL_OF_XENO_PLATFORMS) {
                        if (cxIn(col, platform.box.minX - 0.2, platform.box.maxX + 0.2)
                            && czIn(row, platform.box.minZ - 0.2, platform.box.maxZ + 0.2)) {
                            deck = true
                            break
                        }
                    }
                    if (!deck) {
                        mask[i] = 1
                        continue
                    }
                }

                const minX = col * CALL_OF_XENO_NAV_CELL
                const minZ = row * CALL_OF_XENO_NAV_CELL
                let solid = false
                for (const box of boxes) {
                    if (overlaps(minX, minX + CALL_OF_XENO_NAV_CELL, box.minX, box.maxX)
                        && overlaps(minZ, minZ + CALL_OF_XENO_NAV_CELL, box.minZ, box.maxZ)) {
                        solid = true
                        break
                    }
                }
                mask[i] = solid ? 1 : 0
            }
        }
        blocked.push(mask)
        clearance.push(chamfer(mask, cols, rows))
    }

    return { cell: CALL_OF_XENO_NAV_CELL, cols, rows, ramp, blocked, clearance }
}

function cxIn(col: number, min: number, max: number) {
    const cx = (col + 0.5) * CALL_OF_XENO_NAV_CELL
    return cx > min && cx < max
}

function czIn(row: number, min: number, max: number) {
    const cz = (row + 0.5) * CALL_OF_XENO_NAV_CELL
    return cz > min && cz < max
}

function cellIndex(grid: CallOfXenoNavGrid, x: number, z: number): number {
    const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / grid.cell)))
    const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(z / grid.cell)))
    return row * grid.cols + col
}

/** True when nothing solid occupies the cell at this level. */
export function navCellOpen(grid: CallOfXenoNavGrid, level: number, col: number, row: number): boolean {
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return false
    return grid.blocked[level]![row * grid.cols + col] === 0
}

/** True when a body of this radius fits in the cell at this level. */
export function navCellPassable(grid: CallOfXenoNavGrid, level: number, col: number, row: number, radius: number): boolean {
    if (!navCellOpen(grid, level, col, row)) return false
    return grid.clearance[level]![row * grid.cols + col]! >= radius + CLEARANCE_PAD
}

/**
 * Whether a straight segment stays in cells wide enough for `radius`. Walks
 * every cell the line touches — including both cells flanking a corner it
 * clips — so nothing slips between two touching obstacles.
 */
export function navLineClear(
    grid: CallOfXenoNavGrid,
    level: number,
    ax: number, az: number,
    bx: number, bz: number,
    radius: number
): boolean {
    let col = Math.min(grid.cols - 1, Math.max(0, Math.floor(ax / grid.cell)))
    let row = Math.min(grid.rows - 1, Math.max(0, Math.floor(az / grid.cell)))
    const endCol = Math.min(grid.cols - 1, Math.max(0, Math.floor(bx / grid.cell)))
    const endRow = Math.min(grid.rows - 1, Math.max(0, Math.floor(bz / grid.cell)))
    if (!navCellPassable(grid, level, col, row, radius)) return false

    const dx = bx - ax
    const dz = bz - az
    const stepCol = dx > 0 ? 1 : dx < 0 ? -1 : 0
    const stepRow = dz > 0 ? 1 : dz < 0 ? -1 : 0
    const tDeltaCol = stepCol !== 0 ? Math.abs(grid.cell / dx) : Infinity
    const tDeltaRow = stepRow !== 0 ? Math.abs(grid.cell / dz) : Infinity
    let tMaxCol = stepCol !== 0
        ? (stepCol > 0 ? ((col + 1) * grid.cell - ax) : (ax - col * grid.cell)) / Math.abs(dx)
        : Infinity
    let tMaxRow = stepRow !== 0
        ? (stepRow > 0 ? ((row + 1) * grid.cell - az) : (az - row * grid.cell)) / Math.abs(dz)
        : Infinity

    let guard = (grid.cols + grid.rows) * 4 + 8
    while ((col !== endCol || row !== endRow) && guard-- > 0) {
        if (Math.abs(tMaxCol - tMaxRow) < 1e-9) {
            // Crossing exactly through a corner: both flanking cells must fit.
            if (!navCellPassable(grid, level, col + stepCol, row, radius)) return false
            if (!navCellPassable(grid, level, col, row + stepRow, radius)) return false
            col += stepCol
            row += stepRow
            tMaxCol += tDeltaCol
            tMaxRow += tDeltaRow
        } else if (tMaxCol < tMaxRow) {
            col += stepCol
            tMaxCol += tDeltaCol
        } else {
            row += stepRow
            tMaxRow += tDeltaRow
        }
        if (!navCellPassable(grid, level, col, row, radius)) return false
    }
    return guard > 0
}

/** Binary heap of node ids keyed by f-score. */
class NavHeap {
    private ids: number[] = []
    private fs: number[] = []

    get size(): number {
        return this.ids.length
    }

    push(id: number, f: number) {
        this.ids.push(id)
        this.fs.push(f)
        let i = this.ids.length - 1
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (this.fs[parent]! <= this.fs[i]!) break
            this.swap(i, parent)
            i = parent
        }
    }

    pop(): number {
        const top = this.ids[0]!
        const lastId = this.ids.pop()!
        const lastF = this.fs.pop()!
        if (this.ids.length > 0) {
            this.ids[0] = lastId
            this.fs[0] = lastF
            let i = 0
            for (;;) {
                const left = i * 2 + 1
                const right = left + 1
                let smallest = i
                if (left < this.ids.length && this.fs[left]! < this.fs[smallest]!) smallest = left
                if (right < this.ids.length && this.fs[right]! < this.fs[smallest]!) smallest = right
                if (smallest === i) break
                this.swap(i, smallest)
                i = smallest
            }
        }
        return top
    }

    private swap(a: number, b: number) {
        const id = this.ids[a]!
        this.ids[a] = this.ids[b]!
        this.ids[b] = id
        const f = this.fs[a]!
        this.fs[a] = this.fs[b]!
        this.fs[b] = f
    }
}

/** Closest cell within `maxRings` that fits the radius, nearest ring first. */
function nearestFree(
    grid: CallOfXenoNavGrid,
    level: number,
    col: number, row: number,
    radius: number,
    maxRings: number,
    requireClearance: boolean
): { col: number, row: number } | null {
    const fits = (c: number, r: number) => requireClearance
        ? navCellPassable(grid, level, c, r, radius)
        : navCellOpen(grid, level, c, r)
    for (let ring = 0; ring <= maxRings; ring++) {
        if (fits(col, row)) return { col, row }
        for (let dr = -ring; dr <= ring; dr++) {
            for (const c of ring === 0 ? [col] : [col - ring, col + ring]) {
                const r = row + dr
                if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue
                if (fits(c, r)) return { col: c, row: r }
            }
        }
        if (ring === 0) continue
        for (let dc = -ring + 1; dc < ring; dc++) {
            for (const r of [row - ring, row + ring]) {
                const c = col + dc
                if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) continue
                if (fits(c, r)) return { col: c, row: r }
            }
        }
    }
    return null
}

const NEIGHBOURS: readonly [dc: number, dr: number, cost: number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG]
]

/**
 * Route from a body to the player. Returns string-pulled waypoints (the
 * corners worth walking to) or null when the grid sees no way — sealed wing,
 * or the goal is somewhere no body fits.
 */
export function findNavPath(
    grid: CallOfXenoNavGrid,
    sx: number, sz: number, sy: number,
    gx: number, gz: number, gy: number,
    radius: number
): CallOfXenoNavPoint[] | null {
    const n = grid.cols * grid.rows
    const nodes = n * LEVELS

    // Fast path: most calls are a zombie and a player in the same open room,
    // where the whole route is one straight hop.
    if (navLevelOf(sy) === navLevelOf(gy)
        && navLineClear(grid, navLevelOf(sy), sx, sz, gx, gz, radius)) {
        return [{ x: gx, z: gz, level: navLevelOf(sy) }]
    }

    // Snap the ends onto the grid. A body caught inside geometry (pushed by
    // the pack, or stood on cover) starts from the nearest usable cell.
    let startIdx = cellIndex(grid, sx, sz)
    let startLevel = navLevelOf(sy)
    if (grid.blocked[startLevel]![startIdx] && grid.ramp[startIdx]) startLevel = 1 - startLevel
    let snapped = nearestFree(grid, startLevel, startIdx % grid.cols, Math.floor(startIdx / grid.cols), radius, 6, true)
        ?? nearestFree(grid, startLevel, startIdx % grid.cols, Math.floor(startIdx / grid.cols), 0, 4, false)
    if (!snapped) return null
    startIdx = snapped.row * grid.cols + snapped.col

    let goalIdx = cellIndex(grid, gx, gz)
    let goalLevel = navLevelOf(gy)
    if (grid.blocked[goalLevel]![goalIdx] && grid.ramp[goalIdx]) goalLevel = 1 - goalLevel
    snapped = nearestFree(grid, goalLevel, goalIdx % grid.cols, Math.floor(goalIdx / grid.cols), radius, 10, true)
        ?? nearestFree(grid, goalLevel, goalIdx % grid.cols, Math.floor(goalIdx / grid.cols), 0, 10, false)
    if (!snapped) return null
    goalIdx = snapped.row * grid.cols + snapped.col

    const goalCol = goalIdx % grid.cols
    const goalRow = Math.floor(goalIdx / grid.cols)
    const startNode = startLevel * n + startIdx
    const goalNode = goalLevel * n + goalIdx

    const heuristic = (col: number, row: number, level: number) => {
        const dx = Math.abs(col - goalCol)
        const dz = Math.abs(row - goalRow)
        const octile = (Math.max(dx, dz) + (DIAG - 1) * Math.min(dx, dz)) * grid.cell
        return octile + (level === goalLevel ? 0 : 2)
    }

    const g = new Float32Array(nodes).fill(Infinity)
    const came = new Int32Array(nodes).fill(-1)
    const closed = new Uint8Array(nodes)
    const open = new NavHeap()
    g[startNode] = 0
    open.push(startNode, heuristic(startIdx % grid.cols, Math.floor(startIdx / grid.cols), startLevel))

    let found = false
    let guard = 40000
    while (open.size > 0 && guard-- > 0) {
        const current = open.pop()
        if (current === goalNode) {
            found = true
            break
        }
        if (closed[current]) continue
        closed[current] = 1

        const level = Math.floor(current / n)
        const idx = current - level * n
        const col = idx % grid.cols
        const row = (idx - col) / grid.cols

        const relax = (neighbour: number, cost: number) => {
            const tentative = g[current]! + cost
            if (tentative < g[neighbour]!) {
                g[neighbour] = tentative
                came[neighbour] = current
                open.push(neighbour, tentative + heuristic(neighbour % grid.cols, Math.floor(neighbour / grid.cols) % grid.rows, Math.floor(neighbour / n)))
            }
        }

        for (const [dc, dr, cost] of NEIGHBOURS) {
            const ncol = col + dc
            const nrow = row + dr
            if (ncol < 0 || ncol >= grid.cols || nrow < 0 || nrow >= grid.rows) continue
            const nidx = nrow * grid.cols + ncol
            const nnode = level * n + nidx
            // The goal itself is allowed to be merely unblocked — the player
            // can stand where a route cannot quite end.
            const enterGoal = nnode === goalNode && navCellOpen(grid, level, ncol, nrow)
            if (!enterGoal && !navCellPassable(grid, level, ncol, nrow, radius)) continue
            // No corner cutting: both cells beside the diagonal must fit too.
            if (dc !== 0 && dr !== 0
                && (!navCellPassable(grid, level, col + dc, row, radius)
                    || !navCellPassable(grid, level, col, row + dr, radius))) {
                continue
            }
            relax(nnode, cost * grid.cell)
        }

        // Storey change: only on a ramp, and only into a cell that fits.
        if (grid.ramp[idx]) {
            const other = 1 - level
            const nnode = other * n + idx
            if (navCellPassable(grid, other, col, row, radius)) relax(nnode, 0.3)
        }
    }

    if (!found) return null

    // Cell chain → world points.
    const cells: CallOfXenoNavPoint[] = []
    for (let node = goalNode; node !== -1; node = came[node]!) {
        const level = Math.floor(node / n)
        const idx = node - level * n
        cells.push({
            x: ((idx % grid.cols) + 0.5) * grid.cell,
            z: (Math.floor(idx / grid.cols) + 0.5) * grid.cell,
            level
        })
    }
    cells.reverse()
    if (cells.length === 1) return cells

    // String pulling: keep only the corners the zombie cannot cut.
    const out: CallOfXenoNavPoint[] = [cells[0]!]
    let i = 0
    while (i < cells.length - 1) {
        let j = cells.length - 1
        for (; j > i + 1; j--) {
            if (cells[j]!.level === cells[i]!.level
                && navLineClear(grid, cells[i]!.level, cells[i]!.x, cells[i]!.z, cells[j]!.x, cells[j]!.z, radius)) {
                break
            }
        }
        out.push(cells[j]!)
        i = j
    }

    // Land the last waypoint on the player when it is safe to.
    const last = out[out.length - 1]!
    if (last.level === goalLevel
        && (out.length === 1
            || navLineClear(grid, goalLevel, out[out.length - 2]!.x, out[out.length - 2]!.z, gx, gz, radius))) {
        out[out.length - 1] = { x: gx, z: gz, level: goalLevel }
    }
    return out
}
