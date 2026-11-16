/** Free roam fields on the 20 m grid: `u` runs across from the left edge and `v` along from the entry edge, in metres. */

export const FIELD_TILE = 20
export const FIELD_MAX = 200
/** Items a field may hold, so a large one stays quick to check and plan across. */
export const FIELD_MAX_ITEMS = 32
/** Metres a field's crossing runs square to an edge at each mouth, so the road's frame there points straight through it. */
export const MOUTH_STUB = 2
/** A pillar's radius: a bollard in the middle of its tile. */
export const PILLAR_RADIUS = 1.5

export type FieldEdge = 'entry' | 'exit' | 'left' | 'right'
export const FIELD_EDGES: readonly FieldEdge[] = ['entry', 'exit', 'left', 'right']

/** A road's mouth on a field's edge: which edge, and which tile along it. */
export interface FieldPort {
    edge: FieldEdge
    tile: number
}

/** Quarter turns from the field's heading, clockwise seen from above: the way a gate is crossed and a pad pushes. */
export type FieldDir = 0 | 1 | 2 | 3

export type FieldTile =
    | { col: number, row: number, kind: 'boost' | 'checkpoint', dir: FieldDir }
    | { col: number, row: number, kind: 'block' | 'pillar' }

export type FieldTileKind = FieldTile['kind']

/** What a field section lays: its size, where the road it's laid on comes in and carries on, and its tiles. */
export interface FieldPlan {
    width: number
    length: number
    /** The entry-edge tile the road comes in through. */
    entry: number
    exit: FieldPort
    tiles: FieldTile[]
}

/** Opens onto the middle of the entry edge and leaves through the middle of the far one. */
export function defaultFieldPlan(width = 100, length = 100): FieldPlan {
    const across = Math.floor(width / FIELD_TILE / 2)
    return { width, length, entry: across, exit: { edge: 'exit', tile: across }, tiles: [] }
}

export const isBlocking = (kind: FieldTileKind | undefined) => kind === 'block' || kind === 'pillar'

/** Whether `tile`, where a road meets the field on `edge`, is a gate turned across that road, a post in its way. */
export const gateAcross = (tile: FieldTile | undefined, edge: FieldEdge) => tile?.kind === 'checkpoint' && tile.dir % 2 !== (edge === 'entry' || edge === 'exit' ? 0 : 1)

/** How many tiles run along `edge`. */
export const edgeTiles = (plan: Pick<FieldPlan, 'width' | 'length'>, edge: FieldEdge) => (edge === 'entry' || edge === 'exit' ? plan.width : plan.length) / FIELD_TILE

/** The tile just inside `edge` at `tile`. */
export function edgeTile(plan: Pick<FieldPlan, 'width' | 'length'>, { edge, tile }: FieldPort): { col: number, row: number } {
    if (edge === 'entry') return { col: tile, row: 0 }
    if (edge === 'exit') return { col: tile, row: plan.length / FIELD_TILE - 1 }
    return { col: edge === 'left' ? 0 : plan.width / FIELD_TILE - 1, row: tile }
}

/** The spot `at` metres along `edge`, in (u, v), and the way out of the field there in quarter turns from its heading. */
export function edgePoint(plan: Pick<FieldPlan, 'width' | 'length'>, edge: FieldEdge, at: number): { u: number, v: number, dir: FieldDir } {
    if (edge === 'entry') return { u: at, v: 0, dir: 2 }
    if (edge === 'exit') return { u: at, v: plan.length, dir: 0 }
    return edge === 'left' ? { u: 0, v: at, dir: 3 } : { u: plan.width, v: at, dir: 1 }
}

/** A port's spot on the field, in (u, v), and its outward direction in quarter turns from the field's heading. */
export const portLocal = (plan: Pick<FieldPlan, 'width' | 'length'>, { edge, tile }: FieldPort) => edgePoint(plan, edge, (tile + 0.5) * FIELD_TILE)

/** The tile map of a plan: what's on each tile, by `col + row * cols`. */
export function tileMap(plan: Pick<FieldPlan, 'width' | 'tiles'>): Map<number, FieldTile> {
    const cols = plan.width / FIELD_TILE
    return new Map(plan.tiles.map(t => [t.col + t.row * cols, t]))
}

/** A field set down in the world: its corner, its axes and its plan. */
export interface FieldPlacement {
    /** The entry edge's left corner. */
    x: number
    z: number
    /** The heading of the road arriving at its entry: the field's own. */
    heading: number
    plan: FieldPlan
}

/** The field placed so the road at `pose`, arriving at its entry tile, crosses its entry edge square. */
export function placeField(plan: FieldPlan, pose: { x: number, z: number, heading: number }): FieldPlacement {
    const left = (plan.entry + 0.5) * FIELD_TILE
    return { x: pose.x - Math.cos(pose.heading) * left, z: pose.z - Math.sin(pose.heading) * left, heading: pose.heading, plan }
}

/** The field's forward (along v) and right (along u) unit vectors in the world. */
export const fieldAxes = (heading: number) => ({ fx: Math.sin(heading), fz: -Math.cos(heading), rx: Math.cos(heading), rz: Math.sin(heading) })

/** (u, v) on a placed field, in the world. */
export function fieldPoint(f: Pick<FieldPlacement, 'x' | 'z' | 'heading'>, u: number, v: number): [number, number] {
    const { fx, fz, rx, rz } = fieldAxes(f.heading)
    return [f.x + rx * u + fx * v, f.z + rz * u + fz * v]
}

/** A world point in the field's (u, v). */
export function fieldLocal(f: Pick<FieldPlacement, 'x' | 'z' | 'heading'>, x: number, z: number): { u: number, v: number } {
    const { fx, fz, rx, rz } = fieldAxes(f.heading)
    const dx = x - f.x
    const dz = z - f.z
    return { u: dx * rx + dz * rz, v: dx * fx + dz * fz }
}

/** Metres from a gate's centre out to each of its posts: inside its tile, so a gate never meets its neighbour's. */
export const GATE_SPAN = 8
/** A gate post's collision radius: the arch's tube and its lean inward up to a car's roof. */
export const GATE_POST_RADIUS = 0.6

/** A gate's two posts in (u, v), either side of its tile's centre across the way it's crossed. */
export function gatePosts({ col, row, dir }: { col: number, row: number, dir: FieldDir }): [number, number][] {
    const cu = (col + 0.5) * FIELD_TILE
    const cv = (row + 0.5) * FIELD_TILE
    return dir % 2 ? [[cu, cv - GATE_SPAN], [cu, cv + GATE_SPAN]] : [[cu - GATE_SPAN, cv], [cu + GATE_SPAN, cv]]
}

/** The world heading of a direction `dir` quarter turns from the field's. */
export const dirHeading = (heading: number, dir: number) => heading + dir * Math.PI / 2

/** Where a road leaving through `port` sets off, heading straight out. */
export function portPose(f: FieldPlacement, port: FieldPort) {
    const { u, v, dir } = portLocal(f.plan, port)
    const [x, z] = fieldPoint(f, u, v)
    return { x, z, heading: dirHeading(f.heading, dir) }
}

/** The field's middle, where every road through it meets. */
export const fieldHub = (f: FieldPlacement) => fieldPoint(f, f.plan.width / 2, f.plan.length / 2)

/** A wall face from (x0, z0) to (x1, z1); (nx, nz) is its unit normal, pointing to the side the car is kept on. */
export interface WallSegment {
    x0: number
    z0: number
    x1: number
    z1: number
    nx: number
    nz: number
}

/** A road's opening in an edge: metres along the edge of its centre, and half its width out to the road's walls. */
export interface EdgeOpening {
    edge: FieldEdge
    at: number
    half: number
}

/** Which edge a local point sits on, and how far along it, or null when it's on none. */
export function edgeAt(plan: Pick<FieldPlan, 'width' | 'length'>, u: number, v: number, tolerance = 0.01): { edge: FieldEdge, at: number } | null {
    if (Math.abs(v) < tolerance) return { edge: 'entry', at: u }
    if (Math.abs(v - plan.length) < tolerance) return { edge: 'exit', at: u }
    if (Math.abs(u) < tolerance) return { edge: 'left', at: v }
    if (Math.abs(u - plan.width) < tolerance) return { edge: 'right', at: v }
    return null
}

/** How far along its edge a local point is: edges along u measure u, the others v. */
export const alongEdge = (edge: FieldEdge, u: number, v: number) => edge === 'entry' || edge === 'exit' ? u : v

/** An edge's length. */
export const edgeLength = (plan: Pick<FieldPlan, 'width' | 'length'>, edge: FieldEdge) => edge === 'entry' || edge === 'exit' ? plan.width : plan.length

/** A stretch `a` to `b` along `edge`, as a wall facing into the field. */
function edgeFace(plan: Pick<FieldPlan, 'width' | 'length'>, edge: FieldEdge, a: number, b: number): WallSegment {
    if (edge === 'entry') return { x0: a, z0: 0, x1: b, z1: 0, nx: 0, nz: 1 }
    if (edge === 'exit') return { x0: a, z0: plan.length, x1: b, z1: plan.length, nx: 0, nz: -1 }
    return edge === 'left' ? { x0: 0, z0: a, x1: 0, z1: b, nx: 1, nz: 0 } : { x0: plan.width, z0: a, x1: plan.width, z1: b, nx: -1, nz: 0 }
}

/** Removes `[a, b]` from a list of intervals. */
function cut(spans: [number, number][], a: number, b: number): [number, number][] {
    return spans.flatMap(([p, q]): [number, number][] => b <= p || a >= q ? [[p, q]] : [...a > p ? [[p, a] as [number, number]] : [], ...b < q ? [[b, q] as [number, number]] : []])
}

/** The field's edge walls in (u, v), as (x, z) = (u, v): each edge, broken by its road openings and by stretches it shares with a field next to it. */
export function edgeWalls(plan: Pick<FieldPlan, 'width' | 'length'>, openings: readonly EdgeOpening[], shared: readonly EdgeOpening[] = []): WallSegment[] {
    const out: WallSegment[] = []
    for (const edge of FIELD_EDGES) {
        let spans: [number, number][] = [[0, edgeLength(plan, edge)]]
        for (const o of [...openings, ...shared]) if (o.edge === edge) spans = cut(spans, o.at - o.half, o.at + o.half)
        for (const [a, b] of spans) if (b - a > 0.01) out.push(edgeFace(plan, edge, a, b))
    }
    return out
}

/** Block outlines in (u, v), one face per run of side along open field, so neighbouring blocks have no seam to catch on. */
export function blockWalls(plan: Pick<FieldPlan, 'width' | 'length' | 'tiles'>): WallSegment[] {
    const cols = plan.width / FIELD_TILE
    const rows = plan.length / FIELD_TILE
    const map = tileMap(plan)
    const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows
    const blocked = (c: number, r: number) => inside(c, r) && map.get(c + r * cols)?.kind === 'block'
    // Block on one side of a grid line, open field on the other.
    const face = (c: number, r: number, oc: number, or: number) => blocked(c, r) && inside(oc, or) && !blocked(oc, or)
    const T = FIELD_TILE
    const out: WallSegment[] = []
    const runs = (count: number, open: (i: number) => boolean, push: (from: number, to: number) => void) => {
        let from = -1
        for (let i = 0; i <= count; i++) {
            if (i < count && open(i)) from = from < 0 ? i : from
            else if (from >= 0) {
                push(from * T, i * T)
                from = -1
            }
        }
    }
    for (let r = 0; r <= rows; r++) {
        // The line v = r * T: block above it facing down onto open field, or below it facing up.
        runs(cols, c => face(c, r, c, r - 1), (a, b) => out.push({ x0: a, z0: r * T, x1: b, z1: r * T, nx: 0, nz: -1 }))
        runs(cols, c => face(c, r - 1, c, r), (a, b) => out.push({ x0: a, z0: r * T, x1: b, z1: r * T, nx: 0, nz: 1 }))
    }
    for (let c = 0; c <= cols; c++) {
        runs(rows, r => face(c, r, c - 1, r), (a, b) => out.push({ x0: c * T, z0: a, x1: c * T, z1: b, nx: -1, nz: 0 }))
        runs(rows, r => face(c - 1, r, c, r), (a, b) => out.push({ x0: c * T, z0: a, x1: c * T, z1: b, nx: 1, nz: 0 }))
    }
    return out
}

/** Tiles reachable from `from` round blocks; pillars leave room either side, so they don't wall anything off. */
export function reachableTiles(plan: Pick<FieldPlan, 'width' | 'length' | 'tiles'>, from: readonly { col: number, row: number }[]): Uint8Array {
    const cols = plan.width / FIELD_TILE
    const rows = plan.length / FIELD_TILE
    const map = tileMap(plan)
    const seen = new Uint8Array(cols * rows)
    const queue: number[] = []
    for (const t of from) {
        const k = t.col + t.row * cols
        if (map.get(k)?.kind !== 'block' && !seen[k]) {
            seen[k] = 1
            queue.push(k)
        }
    }
    while (queue.length) {
        const k = queue.pop()!
        const c = k % cols
        const r = (k - c) / cols
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nc = c + dc
            const nr = r + dr
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
            const n = nc + nr * cols
            if (seen[n] || map.get(n)?.kind === 'block') continue
            seen[n] = 1
            queue.push(n)
        }
    }
    return seen
}

/** Why a field's openings don't fit, in the builder's words; null when they do. */
export function openingsFault(plan: FieldPlan, openings: readonly EdgeOpening[], roadHalf: readonly number[]): string | null {
    const map = tileMap(plan)
    const cols = plan.width / FIELD_TILE
    for (const [i, o] of openings.entries()) {
        const length = edgeLength(plan, o.edge)
        if (o.at < 0 || o.at > length) return 'a road meets the field off its edge'
        for (const p of openings.slice(i + 1)) if (p.edge === o.edge && Math.abs(p.at - o.at) < p.half + o.half) return 'leave a tile between roads on one edge'
        // The road's own deck, not its walls, has to come onto open field.
        const half = roadHalf[i]!
        for (let t = Math.max(0, Math.floor((o.at - half) / FIELD_TILE)); t * FIELD_TILE < Math.min(length, o.at + half); t++) {
            const { col, row } = edgeTile(plan, { edge: o.edge, tile: t })
            const tile = map.get(col + row * cols)
            if (isBlocking(tile?.kind)) return 'a road runs into a block'
            if (gateAcross(tile, o.edge)) return 'a road runs into a gate post'
        }
    }
    return null
}

/** Why the field's items aren't all in reach of the road in, or null. */
export function walledOffFault(plan: FieldPlan, mouths: readonly { col: number, row: number }[]): string | null {
    if (!mouths.length) return null
    const cols = plan.width / FIELD_TILE
    const seen = reachableTiles(plan, mouths.slice(0, 1))
    const stranded = [...mouths, ...plan.tiles.filter(t => t.kind === 'boost' || t.kind === 'checkpoint')].some(t => !seen[t.col + t.row * cols])
    return stranded ? 'part of the field is walled off' : null
}

/** A road's mouth on a built field: the line and distance along it where the road crosses the edge, and its opening. */
export interface FieldMouth extends EdgeOpening {
    branch: number
    s: number
}

/** A field as a built course carries it. */
export interface FieldDef {
    x: number
    z: number
    heading: number
    /** Its surface's height. */
    y: number
    plan: FieldPlan
    /** The hub on the road it's laid on: where every road through it meets. */
    home: { branch: number, at: number }
    mouths: FieldMouth[]
}

/** The tile a local point on or just inside an edge opens onto. */
export function tileInside(plan: Pick<FieldPlan, 'width' | 'length'>, u: number, v: number): { col: number, row: number } {
    const clamp = (x: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(x / FIELD_TILE)))
    return { col: clamp(u, plan.width / FIELD_TILE), row: clamp(v, plan.length / FIELD_TILE) }
}

/** A placed field's box in the world: every field turns in quarter turns, so it lines up with the axes. */
export function fieldBox(f: Pick<FieldPlacement, 'x' | 'z' | 'heading' | 'plan'>) {
    const [ax, az] = fieldPoint(f, 0, 0)
    const [bx, bz] = fieldPoint(f, f.plan.width, f.plan.length)
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) }
}

/** Metres two fields' heights may differ by and still meet edge to edge. */
export const LEVEL_TOLERANCE = 0.05

/** Where `a` touches another field edge to edge at its height: each stretch of its edges they share, which no wall closes. */
export function sharedEdges(a: FieldDef, all: readonly FieldDef[]): EdgeOpening[] {
    const out: EdgeOpening[] = []
    const box = fieldBox(a)
    for (const b of all) {
        if (b === a || Math.abs(b.y - a.y) > LEVEL_TOLERANCE) continue
        const o = fieldBox(b)
        const x0 = Math.max(box.x0, o.x0)
        const x1 = Math.min(box.x1, o.x1)
        const z0 = Math.max(box.z0, o.z0)
        const z1 = Math.min(box.z1, o.z1)
        const flatX = Math.abs(x1 - x0) < 0.01 && z1 - z0 > 0.01
        const flatZ = Math.abs(z1 - z0) < 0.01 && x1 - x0 > 0.01
        if (!flatX && !flatZ) continue
        const p = fieldLocal(a, x0, z0)
        const q = flatX ? fieldLocal(a, x0, z1) : fieldLocal(a, x1, z0)
        const edge = edgeAt(a.plan, (p.u + q.u) / 2, (p.v + q.v) / 2, 0.05)
        if (!edge) continue
        const from = alongEdge(edge.edge, p.u, p.v)
        const to = alongEdge(edge.edge, q.u, q.v)
        out.push({ edge: edge.edge, at: (from + to) / 2, half: Math.abs(to - from) / 2 })
    }
    return out
}
