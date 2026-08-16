import type { PathwardenGridPoint } from '#shared/types/pathwarden-save'

export const PATHWARDEN_MIN_HEIGHT = 1
export const PATHWARDEN_MAX_HEIGHT = 3

export interface PathwardenHeightMap {
    readonly cols: number
    readonly rows: number
    at: (col: number, row: number) => number
    readonly cells: readonly (readonly number[])[]
}

function hashCoordinate(seed: number, col: number, row: number) {
    let value = Math.imul(col + 0x9E3779B9, 0x85EBCA6B)
    value = Math.imul(value ^ row + 0xC2B2AE35, 0x27D4EB2F)
    value = Math.imul(value ^ seed, 0x165667B1)
    return ((value ^ value >>> 15) >>> 0) / 4_294_967_296
}

function smooth(t: number) {
    return t * t * (3 - 2 * t)
}

// Value noise: lattice samples hashed from the seed, cosine-smoothed between
// corners. Deterministic for a (seed, frequency) pair on both client and
// server, which is what lets the road and river layers read the same terrain
// the renderer draws.
function valueNoise(seed: number, col: number, row: number, frequency: number) {
    const x = col * frequency
    const y = row * frequency
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)
    const topLeft = hashCoordinate(seed, x0, y0)
    const topRight = hashCoordinate(seed, x0 + 1, y0)
    const bottomLeft = hashCoordinate(seed, x0, y0 + 1)
    const bottomRight = hashCoordinate(seed, x0 + 1, y0 + 1)
    const top = topLeft + (topRight - topLeft) * fx
    const bottom = bottomLeft + (bottomRight - bottomLeft) * fx
    return top + (bottom - top) * fy
}

// The castle artwork and its approach road need level ground, and the opening
// board is the one place the player cannot re-roll around.
function flattenKeepPlateau(cells: number[][], keep: PathwardenGridPoint, cols: number, rows: number) {
    const radius = 6
    for (let row = Math.max(0, keep.row - radius); row <= Math.min(rows - 1, keep.row + radius); row++) {
        for (let col = Math.max(0, keep.col - radius); col <= Math.min(cols - 1, keep.col + radius); col++) {
            if (Math.hypot(col - keep.col, row - keep.row) > radius) continue
            cells[row]![col] = PATHWARDEN_MIN_HEIGHT
        }
    }
}

// A cell two levels above its neighbour renders as a sheer wall the road has to
// climb in one step. Pull every peak down until no step exceeds one level.
function limitSlope(cells: number[][], cols: number, rows: number) {
    for (let pass = 0; pass < PATHWARDEN_MAX_HEIGHT; pass++) {
        let changed = false
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                let lowest = PATHWARDEN_MAX_HEIGHT
                if (col > 0) lowest = Math.min(lowest, cells[row]![col - 1]!)
                if (col < cols - 1) lowest = Math.min(lowest, cells[row]![col + 1]!)
                if (row > 0) lowest = Math.min(lowest, cells[row - 1]![col]!)
                if (row < rows - 1) lowest = Math.min(lowest, cells[row + 1]![col]!)
                if (cells[row]![col]! > lowest + 1) {
                    cells[row]![col] = lowest + 1
                    changed = true
                }
            }
        }
        if (!changed) return
    }
}

/**
 * Continuous fractal noise in [0, 1). The height field quantises this down to
 * three levels; scatter needs the raw value, because quantised input produces
 * a handful of huge blobs instead of believable stands of trees.
 */
export function sampleFractalNoise(seed: number, col: number, row: number) {
    return valueNoise(seed, col, row, 0.06) * 0.55
        + valueNoise(seed ^ 0x5F356495, col, row, 0.14) * 0.30
        + valueNoise(seed ^ 0x1B873593, col, row, 0.31) * 0.15
}

/**
 * Fractal height field quantised to the three levels the renderer draws. The
 * keep sits in a deliberate bowl so the opening board is always flat enough to
 * build on, and the field is pulled down towards the map edge so the mist
 * boundary never ends on a cliff.
 */
export function createPathwardenHeightMap(
    seed: number,
    cols: number,
    rows: number,
    keep: PathwardenGridPoint
): PathwardenHeightMap {
    const cells: number[][] = []
    const centreCol = (cols - 1) / 2
    const centreRow = (rows - 1) / 2
    const maxRadius = Math.hypot(centreCol, centreRow)
    for (let row = 0; row < rows; row++) {
        const line: number[] = []
        for (let col = 0; col < cols; col++) {
            const broad = valueNoise(seed, col, row, 0.035)
            const medium = valueNoise(seed ^ 0x5F356495, col, row, 0.085)
            const fine = valueNoise(seed ^ 0x1B873593, col, row, 0.19)
            const fractal = broad * 0.6 + medium * 0.28 + fine * 0.12
            const edge = Math.min(1, Math.hypot(col - centreCol, row - centreRow) / maxRadius)
            const raw = 2 + (fractal - 0.5) * 4.4 - edge ** 2 * 1.1
            line.push(Math.max(PATHWARDEN_MIN_HEIGHT, Math.min(PATHWARDEN_MAX_HEIGHT, Math.round(raw))))
        }
        cells.push(line)
    }
    flattenKeepPlateau(cells, keep, cols, rows)
    limitSlope(cells, cols, rows)
    return {
        cols,
        rows,
        cells,
        at(col, row) {
            if (col < 0 || col >= cols || row < 0 || row >= rows) return PATHWARDEN_MIN_HEIGHT
            return cells[row]![col]!
        }
    }
}
