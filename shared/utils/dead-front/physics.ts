import type { DfAabb, DfMapDef, DfSolid } from './map'
import type { Vec3 } from './types'

// Collision and ray queries against the map, used by the client (player
// prediction, bullet impacts, hit-claim occlusion) and the server (validation,
// zombie movement, projectiles, line of sight).
//
// Everything is an axis-aligned box. Bodies are upright cylinders (feet at
// `pos`). A uniform grid over xz is the broadphase: each solid is listed in
// every cell it touches, queries dedupe with a per-solid stamp.

export interface DfCollisionWorld {
    /** The active solids (bought doors removed). */
    solids: DfSolid[]
    /** Broadphase, built by dfBuildCollision (or lazily on first query). */
    grid?: DfCollisionGrid
}

export interface DfCollisionGrid {
    minX: number
    minZ: number
    cell: number
    nx: number
    nz: number
    /** cellStart[c]..cellStart[c + 1] index into `items`. */
    cellStart: Int32Array
    items: Int32Array
    /** Packed boxes: minX, minY, minZ, maxX, maxY, maxZ per solid. */
    box: Float64Array
    /** Bit flags per solid: 1 playerOnly, 2 hidden. */
    flags: Uint8Array
    stamp: Uint32Array
    query: number
    /** Scratch candidate list. */
    cand: Int32Array
}

export interface DfBodyOpts {
    radius: number
    height: number
    stepHeight: number
    /** Zombies ignore `playerOnly` solids. */
    zombie?: boolean
}

export interface DfMoveResult {
    pos: Vec3
    vel: Vec3
    grounded: boolean
}

export interface DfRayHit {
    dist: number
    point: Vec3
    normal: Vec3
    mat: string
}

const F_PLAYER_ONLY = 1
const F_HIDDEN = 2
const CELL = 2
const EPS = 1e-4
/** How far below the feet still counts as standing on something. */
const GROUND_SNAP = 0.06

/** Builds the collision world with the bought doors removed. Cheap enough to rebuild when a door opens. */
export function dfBuildCollision(map: DfMapDef, openDoors: ReadonlySet<string>): DfCollisionWorld {
    const solids = map.solids.filter(s => !s.door || !openDoors.has(s.door))
    return { solids, grid: buildGrid(solids) }
}

/** A collision world over an arbitrary list of solids (tests, previews). */
export function dfCollisionFromSolids(solids: DfSolid[]): DfCollisionWorld {
    return { solids, grid: buildGrid(solids) }
}

function buildGrid(solids: DfSolid[]): DfCollisionGrid {
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    const n = solids.length
    const box = new Float64Array(n * 6)
    const flags = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
        const s = solids[i]!
        box[i * 6] = s.min.x
        box[i * 6 + 1] = s.min.y
        box[i * 6 + 2] = s.min.z
        box[i * 6 + 3] = s.max.x
        box[i * 6 + 4] = s.max.y
        box[i * 6 + 5] = s.max.z
        flags[i] = (s.playerOnly ? F_PLAYER_ONLY : 0) | (s.hidden ? F_HIDDEN : 0)
        if (s.min.x < minX) minX = s.min.x
        if (s.min.z < minZ) minZ = s.min.z
        if (s.max.x > maxX) maxX = s.max.x
        if (s.max.z > maxZ) maxZ = s.max.z
    }
    if (n === 0) {
        minX = 0
        minZ = 0
        maxX = CELL
        maxZ = CELL
    }
    const nx = Math.max(1, Math.ceil((maxX - minX) / CELL))
    const nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL))
    const counts = new Int32Array(nx * nz + 1)
    const range = (i: number): [number, number, number, number] => {
        const x0 = clampInt(Math.floor((box[i * 6]! - minX) / CELL), 0, nx - 1)
        const x1 = clampInt(Math.floor((box[i * 6 + 3]! - minX) / CELL), 0, nx - 1)
        const z0 = clampInt(Math.floor((box[i * 6 + 2]! - minZ) / CELL), 0, nz - 1)
        const z1 = clampInt(Math.floor((box[i * 6 + 5]! - minZ) / CELL), 0, nz - 1)
        return [x0, x1, z0, z1]
    }
    for (let i = 0; i < n; i++) {
        const [x0, x1, z0, z1] = range(i)
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) counts[cz * nx + cx]!++
    }
    const cellStart = new Int32Array(nx * nz + 1)
    for (let c = 0; c < nx * nz; c++) cellStart[c + 1] = cellStart[c]! + counts[c]!
    const fill = cellStart.slice(0, nx * nz)
    const items = new Int32Array(cellStart[nx * nz]!)
    for (let i = 0; i < n; i++) {
        const [x0, x1, z0, z1] = range(i)
        for (let cz = z0; cz <= z1; cz++) {
            for (let cx = x0; cx <= x1; cx++) {
                const c = cz * nx + cx
                items[fill[c]!++] = i
            }
        }
    }
    return {
        minX, minZ, cell: CELL, nx, nz, cellStart, items, box, flags,
        stamp: new Uint32Array(n), query: 0, cand: new Int32Array(Math.max(64, n))
    }
}

function clampInt(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

function gridOf(world: DfCollisionWorld): DfCollisionGrid {
    if (!world.grid) world.grid = buildGrid(world.solids)
    return world.grid
}

function nextQuery(g: DfCollisionGrid): number {
    g.query++
    if (g.query >= 0xFFFFFFFF) {
        g.stamp.fill(0)
        g.query = 1
    }
    return g.query
}

/** Collects the solids whose cells overlap the xz rectangle into g.cand; returns the count. */
function gather(g: DfCollisionGrid, x0: number, z0: number, x1: number, z1: number): number {
    const q = nextQuery(g)
    const cx0 = clampInt(Math.floor((x0 - g.minX) / g.cell), 0, g.nx - 1)
    const cx1 = clampInt(Math.floor((x1 - g.minX) / g.cell), 0, g.nx - 1)
    const cz0 = clampInt(Math.floor((z0 - g.minZ) / g.cell), 0, g.nz - 1)
    const cz1 = clampInt(Math.floor((z1 - g.minZ) / g.cell), 0, g.nz - 1)
    let count = 0
    for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
            const c = cz * g.nx + cx
            for (let k = g.cellStart[c]!; k < g.cellStart[c + 1]!; k++) {
                const i = g.items[k]!
                if (g.stamp[i] === q) continue
                g.stamp[i] = q
                g.cand[count++] = i
            }
        }
    }
    return count
}

/** Squared xz distance from (x, z) to solid i's footprint (0 inside). */
function distSqXZ(g: DfCollisionGrid, i: number, x: number, z: number): number {
    const b = g.box
    const o = i * 6
    const cx = x < b[o]! ? b[o]! : x > b[o + 3]! ? b[o + 3]! : x
    const cz = z < b[o + 2]! ? b[o + 2]! : z > b[o + 5]! ? b[o + 5]! : z
    const dx = x - cx
    const dz = z - cz
    return dx * dx + dz * dz
}

function skips(g: DfCollisionGrid, i: number, zombie: boolean): boolean {
    const f = g.flags[i]!
    return zombie && (f & F_PLAYER_ONLY) !== 0
}

/** True if a body cylinder at feet `y` overlaps any solid (horizontal circle overlap + vertical overlap). */
function bodyBlocked(g: DfCollisionGrid, x: number, y: number, z: number, r: number, h: number, zombie: boolean): boolean {
    const n = gather(g, x - r, z - r, x + r, z + r)
    const r2 = r * r - EPS
    for (let k = 0; k < n; k++) {
        const i = g.cand[k]!
        if (skips(g, i, zombie)) continue
        const o = i * 6
        if (g.box[o + 4]! <= y + EPS || g.box[o + 1]! >= y + h - EPS) continue
        if (distSqXZ(g, i, x, z) < r2) return true
    }
    return false
}

/** Highest top of a solid under the circle with its top at or below `maxY`. -Infinity if none. */
function supportHeight(g: DfCollisionGrid, x: number, z: number, r: number, maxY: number, zombie: boolean): number {
    const n = gather(g, x - r, z - r, x + r, z + r)
    const r2 = r * r - EPS
    let best = -Infinity
    for (let k = 0; k < n; k++) {
        const i = g.cand[k]!
        if (skips(g, i, zombie)) continue
        const top = g.box[i * 6 + 4]!
        if (top > maxY || top <= best) continue
        if (distSqXZ(g, i, x, z) < r2) best = top
    }
    return best
}

/** Lowest bottom of a solid over the circle with its bottom at or above `minY`. Infinity if none. */
function ceilingHeight(g: DfCollisionGrid, x: number, z: number, r: number, minY: number, zombie: boolean): number {
    const n = gather(g, x - r, z - r, x + r, z + r)
    const r2 = r * r - EPS
    let best = Infinity
    for (let k = 0; k < n; k++) {
        const i = g.cand[k]!
        if (skips(g, i, zombie)) continue
        const bottom = g.box[i * 6 + 1]!
        if (bottom < minY || bottom >= best) continue
        if (distSqXZ(g, i, x, z) < r2) best = bottom
    }
    return best
}

/** True if the body fits at `pos` (no overlap with any solid). */
export function dfBodyFits(world: DfCollisionWorld, pos: Vec3, opts: Pick<DfBodyOpts, 'radius' | 'height' | 'zombie'>): boolean {
    return !bodyBlocked(gridOf(world), pos.x, pos.y, pos.z, opts.radius, opts.height, !!opts.zombie)
}

/**
 * Moves an upright cylinder body (feet at `pos`) by `vel * dt` with gravity
 * already applied by the caller, sliding along walls and stepping up ledges
 * up to `stepHeight` (stairs). A grounded body sticks to the ground when
 * walking down steps; hitting a ceiling stops upward motion. Step-ups only
 * happen while grounded (no mantling mid-jump).
 */
export function dfMoveBody(world: DfCollisionWorld, pos: Vec3, vel: Vec3, dt: number, opts: DfBodyOpts): DfMoveResult {
    const g = gridOf(world)
    const r = opts.radius
    const h = opts.height
    const zombie = !!opts.zombie
    let x = pos.x
    let y = pos.y
    let z = pos.z
    let vx = vel.x
    let vy = vel.y
    let vz = vel.z

    const startSupport = supportHeight(g, x, z, r, y + 0.01, zombie)
    const wasGrounded = vy <= 0 && startSupport >= y - GROUND_SNAP

    // ---- horizontal, in substeps no longer than half the radius
    const dx = vx * dt
    const dz = vz * dt
    const dist = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.min(32, Math.ceil(dist / (r * 0.5))))
    for (let s = 0; s < steps; s++) {
        x += (vx * dt) / steps
        z += (vz * dt) / steps
        for (let iter = 0; iter < 4; iter++) {
            let pushed = false
            const n = gather(g, x - r, z - r, x + r, z + r)
            const r2 = r * r
            for (let k = 0; k < n; k++) {
                const i = g.cand[k]!
                if (skips(g, i, zombie)) continue
                const o = i * 6
                const top = g.box[o + 4]!
                if (top <= y + EPS || g.box[o + 1]! >= y + h - EPS) continue
                const d2 = distSqXZ(g, i, x, z)
                if (d2 >= r2 - EPS) continue
                // Low ledge: step up onto it if the body fits up there.
                if (wasGrounded && top - y <= opts.stepHeight && !bodyBlocked(g, x, top, z, r, h, zombie)) {
                    y = top
                    pushed = true
                    break
                }
                let nx: number
                let nz: number
                let pen: number
                if (d2 > 1e-10) {
                    const d = Math.sqrt(d2)
                    const cx = x < g.box[o]! ? g.box[o]! : x > g.box[o + 3]! ? g.box[o + 3]! : x
                    const cz = z < g.box[o + 2]! ? g.box[o + 2]! : z > g.box[o + 5]! ? g.box[o + 5]! : z
                    nx = (x - cx) / d
                    nz = (z - cz) / d
                    pen = r - d
                } else {
                    // Centre inside the footprint: leave through the nearest side.
                    const toMinX = x - g.box[o]!
                    const toMaxX = g.box[o + 3]! - x
                    const toMinZ = z - g.box[o + 2]!
                    const toMaxZ = g.box[o + 5]! - z
                    const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
                    if (m === toMinX) {
                        nx = -1
                        nz = 0
                        pen = toMinX + r
                    } else if (m === toMaxX) {
                        nx = 1
                        nz = 0
                        pen = toMaxX + r
                    } else if (m === toMinZ) {
                        nx = 0
                        nz = -1
                        pen = toMinZ + r
                    } else {
                        nx = 0
                        nz = 1
                        pen = toMaxZ + r
                    }
                }
                x += nx * (pen + EPS)
                z += nz * (pen + EPS)
                const vn = vx * nx + vz * nz
                if (vn < 0) {
                    vx -= vn * nx
                    vz -= vn * nz
                }
                pushed = true
            }
            if (!pushed) break
        }
    }

    // ---- vertical
    let grounded = false
    if (vy <= 0) {
        const ground = supportHeight(g, x, z, r, y + 0.01, zombie)
        const ny = y + vy * dt
        if (ny <= ground) {
            y = ground
            vy = 0
            grounded = true
        } else if (wasGrounded && y - ground <= opts.stepHeight + GROUND_SNAP) {
            // Walking down steps: stay glued to the ground instead of hopping off each edge.
            y = ground
            vy = 0
            grounded = true
        } else {
            y = ny
        }
    } else {
        const ceiling = ceilingHeight(g, x, z, r, y + h - 0.01, zombie)
        let ny = y + vy * dt
        if (ny + h > ceiling) {
            ny = Math.max(y, ceiling - h)
            vy = 0
        }
        y = ny
    }

    return { pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, grounded }
}

/**
 * First solid hit along a ray (`dir` normalised), or null within `maxDist`.
 * Ignores `playerOnly` solids (window frames) and `hidden` ones (invisible
 * walls), so bullets fly through windows and over low walls. A ray that starts
 * inside a solid passes out of it.
 */
export function dfRaycast(world: DfCollisionWorld, origin: Vec3, dir: Vec3, maxDist: number): DfRayHit | null {
    const g = gridOf(world)
    const gx0 = g.minX
    const gz0 = g.minZ
    const gx1 = g.minX + g.nx * g.cell
    const gz1 = g.minZ + g.nz * g.cell
    // Clip the ray to the grid's xz extent.
    let t0 = 0
    let t1 = maxDist
    if (Math.abs(dir.x) < 1e-12) {
        if (origin.x < gx0 || origin.x > gx1) return null
    } else {
        let a = (gx0 - origin.x) / dir.x
        let b = (gx1 - origin.x) / dir.x
        if (a > b) [a, b] = [b, a]
        t0 = Math.max(t0, a)
        t1 = Math.min(t1, b)
    }
    if (Math.abs(dir.z) < 1e-12) {
        if (origin.z < gz0 || origin.z > gz1) return null
    } else {
        let a = (gz0 - origin.z) / dir.z
        let b = (gz1 - origin.z) / dir.z
        if (a > b) [a, b] = [b, a]
        t0 = Math.max(t0, a)
        t1 = Math.min(t1, b)
    }
    if (t0 > t1) return null

    const q = nextQuery(g)
    const px = origin.x + dir.x * t0
    const pz = origin.z + dir.z * t0
    let cx = clampInt(Math.floor((px - gx0) / g.cell), 0, g.nx - 1)
    let cz = clampInt(Math.floor((pz - gz0) / g.cell), 0, g.nz - 1)
    const stepX = dir.x > 0 ? 1 : -1
    const stepZ = dir.z > 0 ? 1 : -1
    const tDeltaX = Math.abs(dir.x) < 1e-12 ? Infinity : g.cell / Math.abs(dir.x)
    const tDeltaZ = Math.abs(dir.z) < 1e-12 ? Infinity : g.cell / Math.abs(dir.z)
    let tMaxX = Math.abs(dir.x) < 1e-12 ? Infinity : (gx0 + (cx + (stepX > 0 ? 1 : 0)) * g.cell - origin.x) / dir.x
    let tMaxZ = Math.abs(dir.z) < 1e-12 ? Infinity : (gz0 + (cz + (stepZ > 0 ? 1 : 0)) * g.cell - origin.z) / dir.z

    let best = t1
    let bestI = -1
    let bestAxis = 0
    const inv = [1 / dir.x, 1 / dir.y, 1 / dir.z]
    const o3 = [origin.x, origin.y, origin.z]
    for (let guard = 0; guard < 4096; guard++) {
        const c = cz * g.nx + cx
        for (let k = g.cellStart[c]!; k < g.cellStart[c + 1]!; k++) {
            const i = g.items[k]!
            if (g.stamp[i] === q) continue
            g.stamp[i] = q
            if (g.flags[i]! !== 0) continue
            // Slab test.
            let tmin = -Infinity
            let tmax = Infinity
            let axis = 0
            let miss = false
            for (let a = 0; a < 3; a++) {
                const lo = g.box[i * 6 + a]!
                const hi = g.box[i * 6 + 3 + a]!
                const d = a === 0 ? dir.x : a === 1 ? dir.y : dir.z
                if (Math.abs(d) < 1e-12) {
                    if (o3[a]! < lo || o3[a]! > hi) {
                        miss = true
                        break
                    }
                    continue
                }
                let ta = (lo - o3[a]!) * inv[a]!
                let tb = (hi - o3[a]!) * inv[a]!
                if (ta > tb) [ta, tb] = [tb, ta]
                if (ta > tmin) {
                    tmin = ta
                    axis = a
                }
                if (tb < tmax) tmax = tb
                if (tmin > tmax) {
                    miss = true
                    break
                }
            }
            if (miss || tmin < 0 || tmin > best) continue
            best = tmin
            bestI = i
            bestAxis = axis
        }
        const exit = Math.min(tMaxX, tMaxZ)
        if (best <= exit || exit > t1) break
        if (tMaxX < tMaxZ) {
            cx += stepX
            tMaxX += tDeltaX
            if (cx < 0 || cx >= g.nx) break
        } else {
            cz += stepZ
            tMaxZ += tDeltaZ
            if (cz < 0 || cz >= g.nz) break
        }
    }
    if (bestI < 0) return null
    const d = bestAxis === 0 ? dir.x : bestAxis === 1 ? dir.y : dir.z
    const sgn = d > 0 ? -1 : 1
    return {
        dist: best,
        point: { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best },
        normal: { x: bestAxis === 0 ? sgn : 0, y: bestAxis === 1 ? sgn : 0, z: bestAxis === 2 ? sgn : 0 },
        mat: world.solids[bestI]!.mat
    }
}

/**
 * Height of the walkable surface under the point (x, z) at or below `fromY`
 * (0 when nothing is below). Hidden solids never count as ground; zombies also
 * ignore `playerOnly` ones.
 */
export function dfGroundHeight(world: DfCollisionWorld, x: number, z: number, fromY: number, zombie = false): number {
    const g = gridOf(world)
    const n = gather(g, x, z, x, z)
    let best = -Infinity
    for (let k = 0; k < n; k++) {
        const i = g.cand[k]!
        const f = g.flags[i]!
        if ((f & F_HIDDEN) !== 0 || (zombie && (f & F_PLAYER_ONLY) !== 0)) continue
        const o = i * 6
        const top = g.box[o + 4]!
        if (top > fromY + 1e-3 || top <= best) continue
        if (x < g.box[o]! || x > g.box[o + 3]! || z < g.box[o + 2]! || z > g.box[o + 5]!) continue
        best = top
    }
    return best === -Infinity ? 0 : best
}

export function dfLineOfSight(world: DfCollisionWorld, a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return true
    return dfRaycast(world, a, { x: dx / len, y: dy / len, z: dz / len }, len) === null
}

export function dfAabbContains(box: DfAabb, p: Vec3): boolean {
    return p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y && p.z >= box.min.z && p.z <= box.max.z
}
