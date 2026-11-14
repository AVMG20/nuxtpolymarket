// Gridworks: placed buildings, their footprints and ports, and how they connect.
import { BUILDINGS, MAP_TILES, RECIPES, type ItemId, type Kind } from './defs'
import { chunkOf, oreAt, type OreMap } from './world'

export type Dir = 0 | 1 | 2 | 3
/** r: 0 east, 1 south, 2 west, 3 north. */
export const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]]

export interface Entity {
    k: Kind
    /** Top-left tile of the footprint. */
    x: number
    y: number
    r: Dir
    /** Layer for belts (0-2); a ramp's lower layer. Ground otherwise. */
    l?: number
    mk?: number
    recipe?: string
    filter?: ItemId
}

export function rot(r: number, by: number): Dir {
    return (((r + by) % 4) + 4) % 4 as Dir
}

export function size(k: Kind, r: Dir): [number, number] {
    const d = BUILDINGS[k]
    return r % 2 === 0 ? [d.w, d.h] : [d.h, d.w]
}

/** Offset of the local tile (u along the flow, v across it) from the footprint's top-left. */
export function localToWorld(k: Kind, r: Dir, u: number, v: number): [number, number] {
    const d = BUILDINGS[k]
    const D = DIRS[r]!
    const V = DIRS[rot(r, 1)]!
    // The footprint corners in rotated space, to shift the minimum to (0, 0).
    const xs = [0, (d.w - 1) * D[0] + 0 * V[0], 0 * D[0] + (d.h - 1) * V[0], (d.w - 1) * D[0] + (d.h - 1) * V[0]]
    const ys = [0, (d.w - 1) * D[1] + 0 * V[1], 0 * D[1] + (d.h - 1) * V[1], (d.w - 1) * D[1] + (d.h - 1) * V[1]]
    return [u * D[0] + v * V[0] - Math.min(...xs), u * D[1] + v * V[1] - Math.min(...ys)]
}

export function layersOf(e: Entity): number[] {
    const role = BUILDINGS[e.k].role
    const l = e.l ?? 0
    if (role === 'ramp') return [l, l + 1]
    if (role === 'belt') return [l]
    return [0]
}

export function tilesOf(e: Entity): [number, number][] {
    const [w, h] = size(e.k, e.r)
    const out: [number, number][] = []
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([e.x + dx, e.y + dy])
    return out
}

export const key3 = (x: number, y: number, l: number) => (l * MAP_TILES + y) * MAP_TILES + x

/** Which entity (by index) covers each tile on each layer. */
export function occupancy(entities: readonly Entity[]): Map<number, number> {
    const occ = new Map<number, number>()
    entities.forEach((e, i) => {
        for (const l of layersOf(e)) for (const [x, y] of tilesOf(e)) occ.set(key3(x, y, l), i)
    })
    return occ
}

export interface Port {
    /** The tile this port pushes into and the direction it pushes. */
    x: number
    y: number
    l: number
    dir: Dir
    /** splitters: 'front' | 'left' | 'right'. */
    side: 'front' | 'left' | 'right'
}

/** Where an entity pushes its items. */
export function outputPorts(e: Entity): Port[] {
    const def = BUILDINGS[e.k]
    const l = e.l ?? 0
    const D = DIRS[e.r]!
    const front = (u: number, v: number, layer: number): Port => {
        const [ox, oy] = localToWorld(e.k, e.r, u, v)
        return { x: e.x + ox + D[0], y: e.y + oy + D[1], l: layer, dir: e.r, side: 'front' }
    }
    const sideways = (which: 'left' | 'right'): Port => {
        const dir = rot(e.r, which === 'left' ? 3 : 1)
        const S = DIRS[dir]!
        return { x: e.x + S[0], y: e.y + S[1], l, dir, side: which }
    }
    switch (def.role) {
        case 'belt': case 'merger': return [front(0, 0, l)]
        case 'ramp': return [front(0, 0, e.k === 'ramp-up' ? l + 1 : l)]
        case 'splitter': return [front(0, 0, l), sideways('left'), sideways('right')]
        case 'smart': case 'overflow': return [front(0, 0, l), sideways('right')]
        case 'source': return [front(0, 0, 0)]
        case 'machine': return [front(def.w - 1, def.outRow ?? 0, 0)]
        default: return []
    }
}

export type Accept = 'behind' | 'side' | null

/** Whether `e` takes items pushed in direction `dir` into its tile (x, y) on layer l. */
export function accepts(e: Entity, x: number, y: number, l: number, dir: Dir): Accept {
    const role = BUILDINGS[e.k].role
    const el = e.l ?? 0
    if (dir === rot(e.r, 2)) return null
    switch (role) {
        case 'belt':
            if (l !== el) return null
            return dir === e.r ? 'behind' : 'side'
        case 'merger':
            return dir === e.r ? 'behind' : 'side'
        case 'splitter': case 'smart': case 'overflow':
            return dir === e.r ? 'behind' : null
        case 'ramp': {
            const inLayer = e.k === 'ramp-up' ? el : el + 1
            return dir === e.r && l === inLayer ? 'behind' : null
        }
        case 'machine': {
            if (l !== 0 || dir !== e.r) return null
            // Only the tiles on the input edge (local u = 0).
            const [w, h] = size(e.k, e.r)
            const D = DIRS[e.r]!
            const bx = x - D[0]
            const by = y - D[1]
            const inside = (px: number, py: number) => px >= e.x && py >= e.y && px < e.x + w && py < e.y + h
            return inside(x, y) && !inside(bx, by) ? 'behind' : null
        }
        case 'sink':
            return l === 0 ? 'behind' : null
        default:
            return null
    }
}

export interface Link { from: number, port: number, to: number, side: Accept }
export interface Graph {
    entities: readonly Entity[]
    occ: Map<number, number>
    /** Outgoing links per entity, indexed by its port order (null = nothing there). */
    out: (Link | null)[][]
    /** Incoming links per entity. */
    inc: Link[][]
}

export function buildGraph(entities: readonly Entity[]): Graph {
    const occ = occupancy(entities)
    const out: (Link | null)[][] = entities.map(() => [])
    const inc: Link[][] = entities.map(() => [])
    entities.forEach((e, i) => {
        outputPorts(e).forEach((p, pi) => {
            const j = occ.get(key3(p.x, p.y, p.l))
            out[i]![pi] = null
            if (j === undefined || j === i) return
            const side = accepts(entities[j]!, p.x, p.y, p.l, p.dir)
            if (!side) return
            const link: Link = { from: i, port: pi, to: j, side }
            out[i]![pi] = link
            inc[j]!.push(link)
        })
    })
    // A belt joins one line: its own line from behind, or else a single side feeder.
    entities.forEach((e, j) => {
        if (BUILDINGS[e.k].role !== 'belt' || inc[j]!.length < 2) return
        const behind = inc[j]!.find(l => l.side === 'behind')
        const keep = behind ?? [...inc[j]!].sort((a, b) => a.from - b.from)[0]!
        for (const link of inc[j]!) if (link !== keep) out[link.from]![link.port] = null
        inc[j] = [keep]
    })
    return { entities, occ, out, inc }
}

export interface PlotLike {
    entities: readonly Entity[]
    chunks: readonly string[]
}

export type PlaceError = 'bounds' | 'land' | 'blocked' | 'ore' | 'layer' | 'locked' | 'recipe'

/** Checks a placement against the plot (not the cost). `ignore` skips one entity, for moves. */
export function placeError(plot: PlotLike, ore: OreMap, e: Entity, done: readonly string[], occ?: Map<number, number>, ignore = -1): PlaceError | null {
    const def = BUILDINGS[e.k]
    if (!def) return 'locked'
    if (def.unlock && !done.includes(def.unlock)) return 'locked'
    const l = e.l ?? 0
    if (def.role === 'belt' && l > 0 && !done.includes(l === 1 ? 'bridges' : 'skyway')) return 'layer'
    if (def.role === 'ramp' && l > 0 && !done.includes('skyway')) return 'layer'
    if (def.role !== 'belt' && def.role !== 'ramp' && l !== 0) return 'layer'
    if (l < 0 || l > 2 || (def.role === 'ramp' && l > 1)) return 'layer'
    if (e.recipe !== undefined && !(def.recipes ?? []).includes(e.recipe)) return 'recipe'
    if (e.recipe && RECIPES[e.recipe]?.out === 'chip' && !done.includes('electronics')) return 'locked'
    const owned = new Set(plot.chunks)
    const map = occ ?? occupancy(plot.entities)
    for (const [x, y] of tilesOf(e)) {
        if (x < 0 || y < 0 || x >= MAP_TILES || y >= MAP_TILES) return 'bounds'
        if (!owned.has(chunkOf(x, y))) return 'land'
        for (const layer of layersOf(e)) {
            const hit = map.get(key3(x, y, layer))
            if (hit !== undefined && hit !== ignore) return 'blocked'
        }
        if (def.ore) {
            const o = oreAt(ore, x, y)
            if (!o || !def.ore.includes(o)) return 'ore'
        }
    }
    return null
}

export function recipeOf(e: Entity): string | undefined {
    const def = BUILDINGS[e.k]
    if (def.role !== 'machine') return undefined
    return e.recipe ?? def.recipes?.[0]
}
