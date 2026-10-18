import type { DfNavLink, DfNavNode } from '#shared/utils/dead-front/map'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Zombie navigation over the map's nav graph. Links gated by a door only open
// once that door is bought. Two queries: A* between two nodes, and a cached
// distance field toward one node (what every zombie chasing the same player
// shares, so the cost is one Dijkstra per player node instead of one search
// per zombie). Hunting zombies never leave the play area, so window links and
// the outside approach nodes are dropped.

/** Distance fields kept at once (one per player node recently chased). */
const MAX_FIELDS = 64

interface Edge {
    to: number
    cost: number
    door?: string
}

export class DfNav {
    readonly nodes: DfNavNode[]
    private readonly edges: Edge[][]
    private readonly openDoors = new Set<string>()
    private readonly fields = new Map<number, Float64Array>()
    private readonly usable: Uint8Array

    constructor(graph: { nodes: DfNavNode[], links: DfNavLink[] }, openDoors: Iterable<string> = []) {
        this.nodes = graph.nodes
        const index = new Map<number, number>()
        graph.nodes.forEach((n, i) => index.set(n.id, i))
        this.edges = graph.nodes.map(() => [])
        this.usable = new Uint8Array(graph.nodes.map(n => (n.outside ? 0 : 1)))
        for (const l of graph.links) {
            const a = index.get(l.a)
            const b = index.get(l.b)
            if (a === undefined || b === undefined || a === b) continue
            if (l.barricade || !this.usable[a] || !this.usable[b]) continue
            const cost = dist3(graph.nodes[a]!.pos, graph.nodes[b]!.pos)
            this.edges[a]!.push({ to: b, cost, door: l.door })
            this.edges[b]!.push({ to: a, cost, door: l.door })
        }
        for (const d of openDoors) this.openDoors.add(d)
    }

    get size(): number {
        return this.nodes.length
    }

    pos(i: number): Vec3 {
        return this.nodes[i]!.pos
    }

    setOpenDoors(doors: Iterable<string>): void {
        this.openDoors.clear()
        for (const d of doors) this.openDoors.add(d)
        this.fields.clear()
    }

    private passable(e: Edge): boolean {
        return !e.door || this.openDoors.has(e.door)
    }

    /** Open neighbours of node `i`. */
    neighbours(i: number): number[] {
        return (this.edges[i] ?? []).filter(e => this.passable(e)).map(e => e.to)
    }

    /** Closest node, weighting height differences so floors don't mix. -1 for an empty graph. */
    nearest(p: Vec3, filter?: (i: number) => boolean): number {
        let best = -1
        let bestD = Infinity
        for (let i = 0; i < this.nodes.length; i++) {
            if (!this.usable[i] || (filter && !filter(i))) continue
            const n = this.nodes[i]!.pos
            const dx = n.x - p.x
            const dz = n.z - p.z
            const dy = Math.abs(n.y - p.y)
            const d = Math.sqrt(dx * dx + dz * dz) + dy * 3
            if (d < bestD) {
                bestD = d
                best = i
            }
        }
        return best
    }

    /** Node indices sorted by distance to `p`, limited to `radius` metres and a height band. */
    around(p: Vec3, radius: number, maxDy: number): number[] {
        const out: { i: number, d: number }[] = []
        for (let i = 0; i < this.nodes.length; i++) {
            if (!this.usable[i]) continue
            const n = this.nodes[i]!.pos
            if (Math.abs(n.y - p.y) > maxDy) continue
            const dx = n.x - p.x
            const dz = n.z - p.z
            const d = dx * dx + dz * dz
            if (d <= radius * radius) out.push({ i, d })
        }
        out.sort((a, b) => a.d - b.d)
        return out.map(o => o.i)
    }

    /** A* from node `from` to node `to`; the list of node indices including both ends, or null if unreachable. */
    findPath(from: number, to: number): number[] | null {
        const n = this.nodes.length
        if (from < 0 || to < 0 || from >= n || to >= n) return null
        if (from === to) return [from]
        const g = new Float64Array(n).fill(Infinity)
        const came = new Int32Array(n).fill(-1)
        const closed = new Uint8Array(n)
        const heap = new MinHeap()
        const goal = this.nodes[to]!.pos
        g[from] = 0
        heap.push(from, dist3(this.nodes[from]!.pos, goal))
        while (heap.length) {
            const cur = heap.pop()
            if (cur === to) {
                const path = [to]
                let c = to
                while (came[c]! >= 0) {
                    c = came[c]!
                    path.push(c)
                }
                return path.reverse()
            }
            if (closed[cur]) continue
            closed[cur] = 1
            for (const e of this.edges[cur]!) {
                if (!this.passable(e) || closed[e.to]) continue
                const ng = g[cur]! + e.cost
                if (ng < g[e.to]!) {
                    g[e.to] = ng
                    came[e.to] = cur
                    heap.push(e.to, ng + dist3(this.nodes[e.to]!.pos, goal))
                }
            }
        }
        return null
    }

    /** Path distance from every node to `target` (Infinity when unreachable). Cached until a door opens. */
    field(target: number): Float64Array {
        const cached = this.fields.get(target)
        if (cached) {
            // most recently used last, so eviction drops the stalest field
            this.fields.delete(target)
            this.fields.set(target, cached)
            return cached
        }
        const n = this.nodes.length
        const dist = new Float64Array(n).fill(Infinity)
        if (target >= 0 && target < n) {
            const heap = new MinHeap()
            dist[target] = 0
            heap.push(target, 0)
            while (heap.length) {
                const cur = heap.pop()
                const dc = dist[cur]!
                for (const e of this.edges[cur]!) {
                    if (!this.passable(e)) continue
                    const nd = dc + e.cost
                    if (nd < dist[e.to]!) {
                        dist[e.to] = nd
                        heap.push(e.to, nd)
                    }
                }
            }
        }
        // Players wander over hundreds of nodes on a big map: keep the cache bounded.
        if (this.fields.size >= MAX_FIELDS) this.fields.delete(this.fields.keys().next().value!)
        this.fields.set(target, dist)
        return dist
    }

    /** Neighbours of `from` closer to the field's target, best first. */
    downhill(field: Float64Array, from: number): number[] {
        const here = field[from] ?? Infinity
        const out: number[] = []
        for (const e of this.edges[from] ?? []) {
            if (this.passable(e) && field[e.to]! < here) out.push(e.to)
        }
        return out.sort((a, b) => field[a]! - field[b]!)
    }

    /** Next node to walk to from `from` toward the field's target, or -1 at the target / when stuck. */
    nextHop(field: Float64Array, from: number): number {
        let best = -1
        let bestD = field[from] ?? Infinity
        for (const e of this.edges[from] ?? []) {
            if (!this.passable(e)) continue
            const d = field[e.to]!
            if (d < bestD) {
                bestD = d
                best = e.to
            }
        }
        return best
    }
}

function dist3(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** Tiny binary min-heap of (node, priority). Stale entries are skipped by the callers. */
class MinHeap {
    private items: number[] = []
    private prio: number[] = []

    get length(): number {
        return this.items.length
    }

    push(item: number, p: number): void {
        const items = this.items
        const prio = this.prio
        let i = items.length
        items.push(item)
        prio.push(p)
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (prio[parent]! <= p) break
            items[i] = items[parent]!
            prio[i] = prio[parent]!
            i = parent
        }
        items[i] = item
        prio[i] = p
    }

    pop(): number {
        const items = this.items
        const prio = this.prio
        const top = items[0]!
        const lastItem = items.pop()!
        const lastP = prio.pop()!
        const n = items.length
        if (n > 0) {
            let i = 0
            for (;;) {
                const l = i * 2 + 1
                if (l >= n) break
                const r = l + 1
                const c = r < n && prio[r]! < prio[l]! ? r : l
                if (prio[c]! >= lastP) break
                items[i] = items[c]!
                prio[i] = prio[c]!
                i = c
            }
            items[i] = lastItem
            prio[i] = lastP
        }
        return top
    }
}
