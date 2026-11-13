import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD_TILE_LENGTH } from './textures'
import { MIN_CLEARANCE } from '#shared/utils/nitro-rush/layout'
import { newProjection, newTrackFrame, type TrackLine } from '#shared/utils/nitro-rush/track'

/**
 * Strips, sweeps and clearance checks built from a line's centreline, offset along each point's own right and up so they follow banks and loopings.
 * Nothing is laid over a jump's gap or where a side is open, and on a shared deck each road's strips stop at the seam.
 */

/** The road's width where an offset is taken: its half width and centreline to the wall's face. */
export interface RoadWidth {
    hw: number
    wall: number
}
/** An offset across the road: fixed, or measured from its edges, which can move along it. */
export type Lat = number | ((w: RoadWidth) => number)
const latAt = (lat: Lat, w: RoadWidth) => typeof lat === 'number' ? lat : lat(w)
/** The road's edges and the walls' faces, wherever along the road they're measured. */
export const roadLeft = (w: RoadWidth) => -w.hw
export const roadRight = (w: RoadWidth) => w.hw
export const wallLeft = (w: RoadWidth) => -w.wall
export const wallRight = (w: RoadWidth) => w.wall

/** The elevated road's slab, below the surface. */
export const DECK_DEPTH = 0.8
/** How high anything may stand above its own road: under the deck of a road passing over at the closest allowed. */
export const CLEAR_HEIGHT = MIN_CLEARANCE - DECK_DEPTH - 0.15
/** Over this stretch the wet mirror fades out where the road leaves the ground. */
const MIRROR_FADE = 18
/** How far before an open stretch's ends a station is doubled, so a strip's width and a wall can change right there. */
const CUT = 1e-4

type Vec = [number, number, number]

/** A spot along a line that strips and sweeps are built through, with how far its deck runs to each side. */
interface Station {
    s: number
    x: number
    y: number
    z: number
    r: Vec
    u: Vec
    w: RoadWidth
    left: number
    right: number
}

/** Every point of the line from `from` to `to`, the two ends, and both sides of each open stretch's ends. */
function stations(line: TrackLine, from: number, to: number): Station[] {
    const at: { s: number, i?: number }[] = [{ s: from }]
    const closed = line.closed
    const base = closed ? from - line.wrapS(from) : 0
    for (let k = line.segmentAt(from) + 1; closed || k < line.n; k++) {
        const i = k % line.n
        const s = base + line.cum[i]! + (closed ? Math.floor(k / line.n) * line.length : 0)
        if (s >= to - 1e-6) break
        if (s > from + 1e-6) at.push({ s, i })
    }
    at.push({ s: to })
    const laps = closed ? [-1, 0, 1, 2] : [0]
    for (const o of line.open) {
        for (const lap of laps) {
            for (const end of [o.from, o.to]) {
                const c = end + lap * line.length + base
                if (c - CUT > from && c < to) at.push({ s: c - CUT }, { s: c })
            }
        }
    }
    at.sort((a, b) => a.s - b.s)
    const f = newTrackFrame()
    return at.map(({ s, i }) => {
        const left = line.deckEdge(s, -1)
        const right = line.deckEdge(s, 1)
        if (i === undefined) {
            line.frameAt(s, f)
            return { s, x: f.x, y: f.y, z: f.z, r: [f.rx, f.ry, f.rz], u: [f.ux, f.uy, f.uz], w: { hw: line.halfWidthAt(s), wall: line.wallAt(s) }, left, right }
        }
        return { s, x: line.xs[i]!, y: line.ys[i]!, z: line.zs[i]!, r: vecAt(line.right, i), u: vecAt(line.up, i), w: widthAt(line, i), left, right }
    })
}

/**
 * A strip along the line between two lateral offsets (+ right), lifted `y` off the road, its texture tiled every `vScale` metres.
 * Over a shared deck it stops at the seam, its texture cut off there rather than squeezed.
 */
export function ribbon(line: TrackLine, from: number, to: number, latA: Lat, latB: Lat, y: number, vScale: number) {
    const samples = stations(line, from, to)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    samples.forEach((p, i) => {
        const a = latAt(latA, p.w)
        const b = latAt(latB, p.w)
        const clamp = (lat: number) => Math.min(p.right, Math.max(-p.left, lat))
        const ca = clamp(a)
        const cb = clamp(b)
        const u = (lat: number) => b === a ? 0 : (lat - a) / (b - a)
        pos.push(...offset(p, p.r, p.u, ca, y), ...offset(p, p.r, p.u, cb, y))
        uv.push(u(ca), p.s / vScale, u(cb), p.s / vScale)
        if (i > 0 && !line.gapAt((samples[i - 1]!.s + p.s) / 2)) {
            const k = (i - 1) * 2
            index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2)
        }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
}

/** A profile swept down the whole line on `side`, `profile` as [toward-the-track, height] pairs from the outer foot `from` out; left out where that side is open. */
export function sweep(line: TrackLine, side: -1 | 1, from: Lat, profile: [number, number][]) {
    const samples = stations(line, 0, line.length)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    let u0 = 0
    for (let e = 0; e < profile.length - 1; e++) {
        const [a0, y0] = profile[e]!
        const [a1, y1] = profile[e + 1]!
        const edge = Math.hypot(a1 - a0, y1 - y0)
        const start = pos.length / 3
        samples.forEach((p, i) => {
            const foot = latAt(from, p.w)
            for (const [a, y] of [[a0, y0], [a1, y1]] as const) pos.push(...offset(p, p.r, p.u, side * (foot - a), y))
            uv.push(u0, p.s / 4, u0 + edge, p.s / 4)
            const mid = i > 0 ? (samples[i - 1]!.s + p.s) / 2 : 0
            if (i > 0 && !line.gapAt(mid) && !line.openAt(mid, side)) {
                const b = start + (i - 1) * 2
                index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
            }
        })
        u0 += edge
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
}

/**
 * The wet mirror's strip: every line's road on the ground, as a planar mirror can't follow a climb, faded toward each ramp.
 * One strip for the lot, since each mirror renders the scene again.
 */
export function mirrorStrip(lines: readonly TrackLine[], hw: Lat) {
    const geos = lines.flatMap(line => flatRuns(line, hw))
    if (!geos.length) {
        const line = lines[0]!
        const g = ribbon(line, 0, line.length, w => -latAt(hw, w), hw, 0, ROAD_TILE_LENGTH)
        g.setAttribute('fade', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('uv').count), 1))
        return g
    }
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!
    if (geos.length > 1) for (const g of geos) g.dispose()
    return merged
}

/** The line's road lying flat on the ground, a strip per run, each faded toward the ramps it meets. */
function flatRuns(track: TrackLine, hw: Lat): THREE.BufferGeometry[] {
    const L = track.length
    // A planar mirror only fits road lying flat on the ground: not a bank, a looping or a gap.
    const level = (k: number) => track.ys[k]! < 0.01 && track.plainAt(k)
    const flat = (i: number) => level(i % track.n) && level((i + 1) % track.n) && !track.gapAt(sAtIndex(track, i) + 0.5)
    const runs: [number, number][] = []
    let allFlat = !track.elevated && track.gaps.length === 0
    for (let k = 0; allFlat && k < track.n; k++) allFlat = track.plainAt(k)
    if (allFlat) {
        runs.push([0, L])
    } else {
        // On a loop, start the scan just past a raised segment so no run is split at the seam.
        let first = 0
        if (track.closed) while (flat(first)) first++
        const begin = track.closed ? first + 1 : 0
        let open = -1
        for (let k = begin; k < begin + track.segments; k++) {
            if (flat(k) && open < 0) open = k
            if (!flat(k) && open >= 0) {
                runs.push([sAtIndex(track, open), sAtIndex(track, k)])
                open = -1
            }
        }
        if (open >= 0) runs.push([sAtIndex(track, open), sAtIndex(track, begin + track.segments)])
    }
    return runs.filter(([a, b]) => b - a > 1).map(([from, to]) => {
        const g = ribbon(track, from, to, w => -latAt(hw, w), hw, 0, ROAD_TILE_LENGTH)
        const uv = g.getAttribute('uv')
        const fade = new Float32Array(uv.count)
        // Only an end that meets a ramp fades; an open course's ends and a flat loop stay bright.
        const fadeIn = !allFlat && (track.closed || from > 0)
        const fadeOut = !allFlat && (track.closed || to < L)
        for (let i = 0; i < uv.count; i++) {
            const s = uv.getY(i) * ROAD_TILE_LENGTH
            fade[i] = Math.max(0, Math.min(1, fadeIn ? (s - from) / MIRROR_FADE : 1, fadeOut ? (to - s) / MIRROR_FADE : 1))
        }
        g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1))
        return g
    })
}

const vecAt = (arr: Float64Array, i: number): Vec => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
const widthAt = (line: TrackLine, i: number): RoadWidth => ({ hw: line.halfWidths[i]!, wall: line.walls[i]! })
/** The point `lat` across and `lift` up from a spot on the centreline, in the road's own frame. */
const offset = (p: { x: number, y: number, z: number }, r: Vec, u: Vec, lat: number, lift: number): Vec =>
    [p.x + r[0] * lat + u[0] * lift, p.y + r[1] * lat + u[1] * lift, p.z + r[2] * lat + u[2] * lift]

/** Distance along the line at point index `k`, counting on past the seam of a loop. */
function sAtIndex(line: TrackLine, k: number) {
    return line.cum[k % line.n]! + Math.floor(k / line.n) * line.length
}

/** True when any of `lines` covers ground within `pad` of its walls from (x, z) at a height `level` accepts. */
function roadNear(lines: readonly TrackLine[], x: number, z: number, pad: number, level: (y: number) => boolean) {
    for (const line of lines) {
        for (let k = 0; k < line.n; k++) {
            if (!level(line.ys[k]!)) continue
            const dx = line.xs[k]! - x
            const dz = line.zs[k]! - z
            const radius = line.walls[k]! + pad
            if (dx * dx + dz * dz < radius * radius) return true
        }
    }
    return false
}

/** True when road below `top` covers ground within `pad` of its walls from (x, z). */
export function roadBelow(lines: readonly TrackLine[], x: number, z: number, pad: number, top: number) {
    return roadNear(lines, x, z, pad, y => y < top)
}

/** True when road lies above (x, y, z), between `low` and `high` metres up, within `pad` of its walls across. */
export function roadAbove(lines: readonly TrackLine[], x: number, y: number, z: number, pad: number, low: number, high: number) {
    return roadNear(lines, x, z, pad, ry => ry - y >= low && ry - y <= high)
}

/** True when road within `depth` of height `y` covers ground within `pad` of its walls from (x, z): another road's deck right there. */
export function roadLevelWith(lines: readonly TrackLine[], x: number, y: number, z: number, pad: number, depth: number) {
    return roadNear(lines, x, z, pad, ry => Math.abs(ry - y) < depth)
}

const clearanceScratch = newProjection()

/** Metres on the ground from (x, z) out past the nearest road's wall; an open line stops at its ends rather than running on past them. */
export function roadClearance(lines: readonly TrackLine[], x: number, z: number) {
    const p = clearanceScratch
    let least = Infinity
    for (const line of lines) {
        line.projectAll(x, z, p)
        const past = line.closed ? 0 : Math.max(0, -p.s, p.s - line.length)
        least = Math.min(least, Math.hypot(p.lateral, past) - line.wallAt(Math.min(Math.max(p.s, 0), line.length)))
    }
    return least
}
