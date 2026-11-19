import { blockWalls, edgePoint, fieldAxes, fieldEdgeWalls, FIELD_TILE, GATE_POST_RADIUS, gatePosts, isGate, PILLAR_RADIUS, sharedEdges, type FieldDef, type FieldDir, type FieldLineKind, type FieldMouth, type WallSegment } from './field'

/** A course's fields in the world, for the physics, the lap timer and the bot; the roads across one place a car on it along the course. */

/** A road's mouth on a field, with where it crosses the edge in the world. */
export interface MouthSpot extends FieldMouth {
    x: number
    z: number
}

/** A stretch of line `branch`, from `from` to `to` along it, that lies on the field. */
export interface FieldCrossing {
    branch: number
    from: number
    to: number
}

/** A point in a field's frame: `u` across from its left edge, `v` along from its entry edge. */
export interface FieldLocal {
    u: number
    v: number
}

/** A wall face in the world, its unit normal pointing to the open field, and its unit direction and length. */
export interface FieldWall extends WallSegment {
    tx: number
    tz: number
    length: number
}

/** A round collider: a pillar, or the end of a wall face, which catches a car the face itself misses. */
export interface FieldPost {
    x: number
    z: number
    radius: number
}

/** A pad or gate on a tile: its centre, and the unit direction it pushes or is crossed. */
export interface FieldMark {
    col: number
    row: number
    x: number
    z: number
    dx: number
    dz: number
    /** A checkpoint gate every lap has to drive. */
    required?: true
}

/** A wall's end is a post this big, so a car can't slip between it and the face beyond. */
const WALL_END_RADIUS = 0.05
/** Metres round a grid cell its walls and posts are listed for: more than the car's half diagonal. */
const CELL_REACH = 4

export class CourseField {
    readonly x: number
    readonly z: number
    readonly heading: number
    readonly y: number
    readonly width: number
    readonly length: number
    readonly cols: number
    readonly rows: number
    /** Its forward (along v) and right (along u) unit vectors. */
    readonly fx: number
    readonly fz: number
    readonly rx: number
    readonly rz: number
    readonly mouths: readonly MouthSpot[]
    readonly walls: readonly FieldWall[]
    readonly posts: readonly FieldPost[]
    readonly pads: readonly FieldMark[]
    /** Its checkpoint gates, which count either way through. */
    readonly gates: readonly FieldMark[]
    /** Its start and finish gates, which count either way through too; a start's way is the way its grid faces. */
    readonly start: FieldMark | null
    readonly finish: FieldMark | null
    /** Set by the course once its lines are built. */
    crossings: readonly FieldCrossing[] = []
    /** Per grid cell, a ring of cells wider than the field, the walls and posts near it. */
    private readonly cellWalls: number[][]
    private readonly cellPosts: number[][]
    /** Per tile, its pad's index into `pads`, or -1. */
    private readonly padAt: Int16Array

    /** `all` is every field of the course, for the edges this one shares with its neighbours. */
    constructor(readonly def: FieldDef, readonly index: number, all: readonly FieldDef[] = [def]) {
        const { plan } = def
        this.x = def.x
        this.z = def.z
        this.heading = def.heading
        this.y = def.y
        this.width = plan.width
        this.length = plan.length
        this.cols = plan.width / FIELD_TILE
        this.rows = plan.length / FIELD_TILE
        const { fx, fz, rx, rz } = fieldAxes(def.heading)
        this.fx = fx
        this.fz = fz
        this.rx = rx
        this.rz = rz
        this.mouths = def.mouths.map((m) => {
            const { u, v } = edgePoint(plan, m.edge, m.at)
            const [x, z] = this.world(u, v)
            return { ...m, x, z }
        })
        const local = [...fieldEdgeWalls(def, all), ...blockWalls(plan)]
        this.walls = local.map(w => this.worldWall(w))
        const ends = new Map<string, [number, number]>()
        for (const w of local) for (const [u, v] of [[w.x0, w.z0], [w.x1, w.z1]] as const) ends.set(`${u},${v}`, [u, v])
        const centre = (col: number, row: number) => this.world((col + 0.5) * FIELD_TILE, (row + 0.5) * FIELD_TILE)
        const pillars = plan.tiles.filter(t => t.kind === 'pillar').map(t => centre(t.col, t.row))
        const gatePostsAt = plan.tiles.flatMap(t => isGate(t.kind) && 'dir' in t ? gatePosts(t).map(([u, v]) => this.world(u, v)) : [])
        this.posts = [
            ...pillars.map(([x, z]) => ({ x, z, radius: PILLAR_RADIUS })),
            ...gatePostsAt.map(([x, z]) => ({ x, z, radius: GATE_POST_RADIUS })),
            ...[...ends.values()].map(([u, v]) => {
                const [x, z] = this.world(u, v)
                return { x, z, radius: WALL_END_RADIUS }
            })
        ]
        const mark = (col: number, row: number, dir: FieldDir): FieldMark => {
            const [x, z] = centre(col, row)
            const [dx, dz] = this.direction(dir)
            return { col, row, x, z, dx, dz }
        }
        this.pads = plan.tiles.flatMap(t => t.kind === 'boost' ? [mark(t.col, t.row, t.dir)] : [])
        this.gates = plan.tiles.flatMap(t => t.kind === 'checkpoint' ? [t.required ? { ...mark(t.col, t.row, t.dir), required: true as const } : mark(t.col, t.row, t.dir)] : [])
        const lineOf = (kind: FieldLineKind) => {
            const t = plan.tiles.find(t => t.kind === kind)
            return t && 'dir' in t ? mark(t.col, t.row, t.dir) : null
        }
        this.start = lineOf('start')
        this.finish = lineOf('finish')
        this.padAt = new Int16Array(this.cols * this.rows).fill(-1)
        this.pads.forEach((p, i) => this.padAt[p.col + p.row * this.cols] = i)
        // Local boxes, so a cell's neighbours are found by overlap alone.
        const boxes = [
            ...local.map(w => [Math.min(w.x0, w.x1), Math.min(w.z0, w.z1), Math.max(w.x0, w.x1), Math.max(w.z0, w.z1)] as const),
            ...this.posts.map((p) => {
                const { u, v } = this.local(p.x, p.z)
                return [u - p.radius, v - p.radius, u + p.radius, v + p.radius] as const
            })
        ]
        const cells = (this.cols + 2) * (this.rows + 2)
        this.cellWalls = Array.from({ length: cells }, () => [])
        this.cellPosts = Array.from({ length: cells }, () => [])
        for (let c = -1; c <= this.cols; c++) {
            for (let r = -1; r <= this.rows; r++) {
                const u0 = c * FIELD_TILE - CELL_REACH
                const v0 = r * FIELD_TILE - CELL_REACH
                const u1 = (c + 1) * FIELD_TILE + CELL_REACH
                const v1 = (r + 1) * FIELD_TILE + CELL_REACH
                const cell = this.cellIndex(c, r)
                boxes.forEach(([a, b, p, q], i) => {
                    if (p < u0 || a > u1 || q < v0 || b > v1) return
                    if (i < local.length) this.cellWalls[cell]!.push(i)
                    else this.cellPosts[cell]!.push(i - local.length)
                })
            }
        }
    }

    /** (x, z) in the field's frame, into `out`. */
    local(x: number, z: number, out: FieldLocal = { u: 0, v: 0 }): FieldLocal {
        const dx = x - this.x
        const dz = z - this.z
        out.u = dx * this.rx + dz * this.rz
        out.v = dx * this.fx + dz * this.fz
        return out
    }

    /** (u, v) in the world. */
    world(u: number, v: number): [number, number] {
        return [this.x + this.rx * u + this.fx * v, this.z + this.rz * u + this.fz * v]
    }

    /** The world direction `dir` quarter turns clockwise from the field's forward, seen from above. */
    direction(dir: number): [number, number] {
        const q = ((dir % 4) + 4) % 4
        return q === 0 ? [this.fx, this.fz] : q === 1 ? [this.rx, this.rz] : q === 2 ? [-this.fx, -this.fz] : [-this.rx, -this.rz]
    }

    /** Whether (u, v) lies on the field. */
    contains(u: number, v: number) {
        return u >= 0 && v >= 0 && u <= this.width && v <= this.length
    }

    /** The mouth a point off the field went out through, or null when it's off past a wall or still on the field. */
    mouthOut(u: number, v: number): MouthSpot | null {
        const out = Math.max(-v, v - this.length, -u, u - this.width)
        if (out <= 0) return null
        const edge = out === -v ? 'entry' : out === v - this.length ? 'exit' : out === -u ? 'left' : 'right'
        const along = edge === 'entry' || edge === 'exit' ? u : v
        return this.mouths.find(m => m.edge === edge && Math.abs(along - m.at) <= m.half) ?? null
    }

    /** Whether line `branch` crosses the field at `s`, give or take `slack` metres. */
    crossedAt(branch: number, s: number, slack = 0) {
        return this.crossings.some(c => c.branch === branch && s >= c.from - slack && s <= c.to + slack)
    }

    /** Indices into `walls` and `posts` of those near local (u, v). */
    near(u: number, v: number): { walls: readonly number[], posts: readonly number[] } {
        const cell = this.cellIndex(Math.floor(u / FIELD_TILE), Math.floor(v / FIELD_TILE))
        return { walls: this.cellWalls[cell]!, posts: this.cellPosts[cell]! }
    }

    /** The pad on the tile under local (u, v), if any. */
    padUnder(u: number, v: number): FieldMark | null {
        if (!this.contains(u, v)) return null
        const col = Math.min(this.cols - 1, Math.floor(u / FIELD_TILE))
        const row = Math.min(this.rows - 1, Math.floor(v / FIELD_TILE))
        return this.pads[this.padAt[col + row * this.cols]!] ?? null
    }

    /** A grid cell's index, clamped onto the ring round the field. */
    private cellIndex(c: number, r: number) {
        const cc = Math.min(this.cols, Math.max(-1, c)) + 1
        const rr = Math.min(this.rows, Math.max(-1, r)) + 1
        return cc + rr * (this.cols + 2)
    }

    private worldWall(w: WallSegment): FieldWall {
        const [x0, z0] = this.world(w.x0, w.z0)
        const [x1, z1] = this.world(w.x1, w.z1)
        const length = Math.hypot(x1 - x0, z1 - z0)
        return { x0, z0, x1, z1, nx: this.rx * w.nx + this.fx * w.nz, nz: this.rz * w.nx + this.fz * w.nz, tx: (x1 - x0) / length, tz: (z1 - z0) / length, length }
    }
}

/** Field `index` and every field joined to it edge to edge, which a car crosses as one open floor. */
export function joinedFields(fields: readonly CourseField[], index: number): CourseField[] {
    const seen = new Set([index])
    for (const i of seen) {
        for (const f of fields) if (!seen.has(f.index) && sharedEdges(fields[i]!.def, [fields[i]!.def, f.def]).length) seen.add(f.index)
    }
    return [...seen].map(i => fields[i]!)
}
