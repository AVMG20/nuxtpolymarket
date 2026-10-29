import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD_TILE_LENGTH } from './textures'
import { newTrackFrame, type Track } from '#shared/utils/nitro-rush/track'

/**
 * Strips, sweeps and clearance checks built from the track's centreline. Offsets
 * run along each point's right and up, so they follow banks, loopings and
 * corkscrews; on plain road that's the plan's right and straight up. Nothing is
 * laid over a jump's gap.
 */

/** Half the jersey barrier's base; its road-side face sits on the track's wall offset. */
export const WALL_BASE_HALF = 0.32
/** Over this stretch the wet mirror fades out where the road leaves the ground. */
const MIRROR_FADE = 18

/**
 * A strip laid flat along the track between two lateral offsets (+ is right
 * of the driving direction), from distance `from` to `to`. `u` runs 0 to 1
 * across, `v` is distance divided by `vScale`, so textures tile at a fixed
 * world scale. `y` lifts it off the road surface.
 */
export function ribbon(track: Track, from: number, to: number, latA: number, latB: number, y: number, vScale: number) {
    const samples: { s: number, x: number, y: number, z: number, r: Vec, u: Vec }[] = []
    const push = (s: number, i?: number) => {
        if (i === undefined) {
            const f = track.frameAt(s, newTrackFrame())
            samples.push({ s, x: f.x, y: f.y, z: f.z, r: [f.rx, f.ry, f.rz], u: [f.ux, f.uy, f.uz] })
        } else {
            samples.push({ s, x: track.xs[i]!, y: track.ys[i]!, z: track.zs[i]!, r: vecAt(track.right, i), u: vecAt(track.up, i) })
        }
    }
    push(from)
    const closed = track.closed
    const base = closed ? from - track.wrapS(from) : 0
    for (let k = track.segmentAt(from) + 1; closed || k < track.n; k++) {
        const i = k % track.n
        const s = base + track.cum[i]! + (closed ? Math.floor(k / track.n) * track.length : 0)
        if (s >= to - 1e-6) break
        if (s > from + 1e-6) push(s, i)
    }
    push(to)
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    samples.forEach((p, i) => {
        pos.push(...offset(p, p.r, p.u, latA, y), ...offset(p, p.r, p.u, latB, y))
        uv.push(0, p.s / vScale, 1, p.s / vScale)
        if (i > 0 && !track.gapAt((samples[i - 1]!.s + p.s) / 2)) {
            const a = (i - 1) * 2
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(index)
    g.computeVertexNormals()
    return g
}

/** A profile swept down the whole course, `profile` as [toward-the-track, height] pairs from the outer foot. */
export function sweep(track: Track, side: number, from: number, profile: [number, number][]) {
    const pos: number[] = []
    const uv: number[] = []
    const index: number[] = []
    const n = track.n
    let u0 = 0
    for (let e = 0; e < profile.length - 1; e++) {
        const [a0, y0] = profile[e]!
        const [a1, y1] = profile[e + 1]!
        const edge = Math.hypot(a1 - a0, y1 - y0)
        const start = pos.length / 3
        // A loop's last vertex repeats the first so the seam closes; an open course stops at its last point.
        for (let i = 0; i <= (track.closed ? n : n - 1); i++) {
            const k = i % n
            const s = i === n ? track.length : track.cum[k]!
            const p = { x: track.xs[k]!, y: track.ys[k]!, z: track.zs[k]! }
            const r = vecAt(track.right, k)
            const u = vecAt(track.up, k)
            for (const [a, y] of [[a0, y0], [a1, y1]] as const) pos.push(...offset(p, r, u, side * (from - a), y))
            uv.push(u0, s / 4, u0 + edge, s / 4)
            if (i > 0 && !track.gapAt(s - 0.5)) {
                const b = start + (i - 1) * 2
                index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2)
            }
        }
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
 * The wet mirror's strip: the road where it lies on the ground, since a planar
 * mirror can't follow a climb. Its `fade` attribute dims it toward each ramp.
 */
export function mirrorStrip(track: Track, hw: number) {
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
    const geos = runs.filter(([a, b]) => b - a > 1).map(([from, to]) => {
        const g = ribbon(track, from, to, -hw, hw, 0, ROAD_TILE_LENGTH)
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
    if (!geos.length) {
        const g = ribbon(track, 0, L, -hw, hw, 0, ROAD_TILE_LENGTH)
        g.setAttribute('fade', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('uv').count), 1))
        return g
    }
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!
    if (geos.length > 1) for (const g of geos) g.dispose()
    return merged
}

type Vec = [number, number, number]
const vecAt = (arr: Float64Array, i: number): Vec => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!]
/** The point `lat` across and `lift` up from a spot on the centreline, in the road's own frame. */
const offset = (p: { x: number, y: number, z: number }, r: Vec, u: Vec, lat: number, lift: number): Vec =>
    [p.x + r[0] * lat + u[0] * lift, p.y + r[1] * lat + u[1] * lift, p.z + r[2] * lat + u[2] * lift]

/** Distance along the line at point index `k`, counting on past the seam of a loop. */
function sAtIndex(track: Track, k: number) {
    return track.cum[k % track.n]! + Math.floor(k / track.n) * track.length
}

/** True when another stretch of road below `top` covers ground within `radius` of (x, z). */
export function roadBelow(track: Track, x: number, z: number, radius: number, top: number) {
    for (let k = 0; k < track.n; k++) {
        if (track.ys[k]! >= top) continue
        const dx = track.xs[k]! - x
        const dz = track.zs[k]! - z
        if (dx * dx + dz * dz < radius * radius) return true
    }
    return false
}

/** True when road lies above (x, y, z), between `low` and `high` metres up, within `radius` across. */
export function roadAbove(track: Track, x: number, y: number, z: number, radius: number, low: number, high: number) {
    for (let k = 0; k < track.n; k++) {
        const up = track.ys[k]! - y
        if (up < low || up > high) continue
        const dx = track.xs[k]! - x
        const dz = track.zs[k]! - z
        if (dx * dx + dz * dz < radius * radius) return true
    }
    return false
}
