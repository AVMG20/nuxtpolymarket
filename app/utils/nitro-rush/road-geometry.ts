import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ROAD_TILE_LENGTH } from './textures'
import type { Track } from '#shared/utils/nitro-rush/track'

/** Strips, sweeps and clearance checks built from the track's centreline. */

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
    const samples: { s: number, x: number, y: number, z: number, tx: number, tz: number }[] = []
    const push = (s: number, i?: number) => {
        if (i === undefined) {
            const p = track.pointAt(s)
            samples.push({ s, ...p })
        } else {
            samples.push({ s, x: track.xs[i]!, y: track.ys[i]!, z: track.zs[i]!, tx: track.txs[i]!, tz: track.tzs[i]! })
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
        // Right of the driving direction is (-tz, tx).
        pos.push(p.x - p.tz * latA, p.y + y, p.z + p.tx * latA, p.x - p.tz * latB, p.y + y, p.z + p.tx * latB)
        uv.push(0, p.s / vScale, 1, p.s / vScale)
        if (i > 0) {
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
export function sweep(track: Track, side: number, offset: number, profile: [number, number][]) {
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
            for (const [a, y] of [[a0, y0], [a1, y1]] as const) {
                const lat = side * (offset - a)
                pos.push(track.xs[k]! - track.tzs[k]! * lat, track.ys[k]! + y, track.zs[k]! + track.txs[k]! * lat)
            }
            uv.push(u0, s / 4, u0 + edge, s / 4)
            if (i > 0) {
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
    const flat = (i: number) => track.ys[i % track.n]! < 0.01 && track.ys[(i + 1) % track.n]! < 0.01
    const runs: [number, number][] = []
    if (!track.elevated) {
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
        const fadeIn = track.elevated && (track.closed || from > 0)
        const fadeOut = track.elevated && (track.closed || to < L)
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
