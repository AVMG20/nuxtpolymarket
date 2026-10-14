import { randomFloat } from '#shared/utils/random'
import { FIELD_DEPTH, FIELD_HALF_WIDTH } from './constants'

/**
 * The data lines under the lane: the only roads a ground hostile may take.
 *
 * The network is built around the path nodes, like traces on a board. The
 * portal sends several traces down to the first node, and one further along;
 * every node is wired to the next three after it; the last nodes send theirs
 * down to the fence. Every trace is a
 * light-cycle line — straight down, a hard turn across, straight down again —
 * leaving a node from a pin on its fence side and entering the next from a pin
 * on its far side, so the traces between two nodes run side by side.
 *
 * A unit rides one trace at a time; at a node it picks the trace on toward
 * the node it is after. Never up: the intrusion only moves toward the fence.
 *
 * Layout decides routes, so it rolls through `#shared/utils/random`.
 */

export interface LinePoint {
    u: number
    d: number
}

export interface NetNode {
    u: number
    d: number
    kind: 'source' | 'node' | 'sink'
    /** 0 for the portal, 1… for path nodes outermost first, last for the fence. */
    layer: number
    out: Trace[]
}

export interface Trace {
    points: LinePoint[]
    /** Index into `DataNetwork.nodes`. */
    from: number
    to: number
}

export interface DataNetwork {
    nodes: NetNode[]
    traces: Trace[]
}

/** How many nodes ahead each node is wired to. */
const LINKS_AHEAD = 3
/** Traces leave and enter a path node this far either side of its centre. */
export const PIN_GAP = 34
/** Pin offsets across a node's face: traces side by side, never on top of each other. */
const PINS = [-22, 0, 22]
/** Where the portal's traces start, and where the fence's end. */
export const SOURCE_D = FIELD_DEPTH + 150
export const SINK_D = 10

const snap = (value: number) => Math.round(value / 10) * 10

function rand(min: number, max: number) {
    return min + randomFloat() * (max - min)
}

/**
 * A light-cycle line from `a` down to `b`: down to a turning depth, across,
 * then down again. Straight down when the two already line up.
 */
function route(a: LinePoint, b: LinePoint): LinePoint[] {
    if (Math.abs(a.u - b.u) < 4) return [a, { u: a.u, d: b.d }]
    const span = a.d - b.d
    const turn = snap(b.d + span * rand(0.25, 0.75))
    return [a, { u: a.u, d: turn }, { u: b.u, d: turn }, b]
}

/**
 * Lays the network around `nodes` (the path nodes, outermost first). Called
 * once per run, after the nodes are placed.
 */
export function buildNetwork(pathNodes: readonly LinePoint[]): DataNetwork {
    const nodes: NetNode[] = []
    const traces: Trace[] = []
    const lastLayer = pathNodes.length + 1
    const spread = (count: number, i: number) => snap((-1 + (2 * i + 1) / count) * (FIELD_HALF_WIDTH - 90) + rand(-30, 30))

    const sources = [0, 1, 2, 3].map(i => nodes.push({ u: spread(4, i), d: SOURCE_D, kind: 'source', layer: 0, out: [] }) - 1)
    const middle = pathNodes.map((p, i) => nodes.push({ u: p.u, d: p.d, kind: 'node', layer: i + 1, out: [] }) - 1)
    const sinks = [0, 1, 2, 3].map(i => nodes.push({ u: spread(4, i), d: SINK_D, kind: 'sink', layer: lastLayer, out: [] }) - 1)

    // Pins hand out round-robin, so traces into or out of one node fan across its face.
    const exitPin = new Map<number, number>()
    const entryPin = new Map<number, number>()
    const pin = (counter: Map<number, number>, index: number) => {
        const n = counter.get(index) ?? Math.floor(randomFloat() * PINS.length)
        counter.set(index, n + 1)
        return PINS[n % PINS.length]!
    }
    const exitOf = (index: number): LinePoint => {
        const node = nodes[index]!
        return node.kind === 'node' ? { u: node.u + pin(exitPin, index), d: node.d - PIN_GAP } : { u: node.u, d: node.d }
    }
    const entryOf = (index: number): LinePoint => {
        const node = nodes[index]!
        return node.kind === 'node' ? { u: node.u + pin(entryPin, index), d: node.d + PIN_GAP } : { u: node.u, d: node.d }
    }
    const link = (from: number, to: number) => {
        const trace: Trace = { points: route(exitOf(from), entryOf(to)), from, to }
        traces.push(trace)
        nodes[from]!.out.push(trace)
    }

    // The layer below each layer: the next path node, or the fence once there are none.
    const below = (layer: number) => layer < pathNodes.length ? [middle[layer]!] : sinks

    // Portal: every source feeds the first node, and each also runs a line of
    // its own straight on to one of the next few, so the gate has several ways
    // into the board rather than one choke.
    const first = below(0)
    sources.forEach((source, i) => link(source, first[i % first.length]!))
    const further = middle.slice(1, 1 + LINKS_AHEAD)
    if (further.length) {
        const offset = Math.floor(randomFloat() * further.length)
        sources.forEach((source, i) => link(source, further[(i + offset) % further.length]!))
    } else {
        const skip = below(1)
        link(sources[Math.floor(randomFloat() * sources.length)]!, skip[Math.floor(randomFloat() * skip.length)]!)
    }

    // Every node is wired to the next three after it, so the whole set hangs
    // together without the board turning into a grid; the last ones run on
    // to the fence.
    middle.forEach((index, i) => {
        const layer = i + 1
        for (const later of middle.slice(i + 1, i + 1 + LINKS_AHEAD)) link(index, later)
        if (layer >= pathNodes.length - 1) link(index, sinks[Math.floor(randomFloat() * sinks.length)]!)
        if (layer === pathNodes.length) link(index, sinks[Math.floor(randomFloat() * sinks.length)]!)
    })

    return { nodes, traces }
}

/** Which way a segment runs: down toward the fence, or across. */
export function segmentDirection(a: LinePoint, b: LinePoint): 'down' | 'left' | 'right' {
    if (b.d < a.d - 0.01) return 'down'
    return b.u > a.u ? 'right' : 'left'
}

/** The closest point on any trace to (u, d): where a unit dropped onto the board lands. */
export function nearestOnNetwork(network: DataNetwork, u: number, d: number) {
    let best: { trace: Trace, seg: number, u: number, d: number, dist: number } | null = null
    for (const trace of network.traces) {
        for (let s = 0; s < trace.points.length - 1; s++) {
            const a = trace.points[s]!
            const b = trace.points[s + 1]!
            const pu = Math.max(Math.min(a.u, b.u), Math.min(Math.max(a.u, b.u), u))
            const pd = Math.max(Math.min(a.d, b.d), Math.min(Math.max(a.d, b.d), d))
            const dist = Math.hypot(pu - u, pd - d)
            if (!best || dist < best.dist) best = { trace, seg: s, u: pu, d: pd, dist }
        }
    }
    return best
}

/**
 * A point on a different line for a hacker to zap across to: at least `min`
 * and at most `max` away, never further from the fence than it is now. The
 * nearest one that qualifies, or null.
 */
export function zapTarget(network: DataNetwork, u: number, d: number, min: number, max: number) {
    let best: { trace: Trace, seg: number, u: number, d: number, dist: number } | null = null
    for (const trace of network.traces) {
        for (let s = 0; s < trace.points.length - 1; s++) {
            const a = trace.points[s]!
            const b = trace.points[s + 1]!
            // Project, then pull the point down level with the hacker if the
            // segment runs past it, so a zap never lands it further out.
            const pu = Math.max(Math.min(a.u, b.u), Math.min(Math.max(a.u, b.u), u))
            const pd = Math.max(Math.min(a.d, b.d), Math.min(Math.max(a.d, b.d), Math.min(d, Math.max(a.d, b.d))))
            if (pd > d + 0.5) continue
            const dist = Math.hypot(pu - u, pd - d)
            if (dist < min || dist > max) continue
            if (!best || dist < best.dist) best = { trace, seg: s, u: pu, d: pd, dist }
        }
    }
    return best
}

/** Whether a trace passes within `radius` of a point — a honeypot's pull. */
export function tracePassesNear(trace: Trace, u: number, d: number, radius: number) {
    for (let s = 0; s < trace.points.length - 1; s++) {
        const a = trace.points[s]!
        const b = trace.points[s + 1]!
        const pu = Math.max(Math.min(a.u, b.u), Math.min(Math.max(a.u, b.u), u))
        const pd = Math.max(Math.min(a.d, b.d), Math.min(Math.max(a.d, b.d), d))
        if (Math.hypot(pu - u, pd - d) <= radius) return true
    }
    return false
}
