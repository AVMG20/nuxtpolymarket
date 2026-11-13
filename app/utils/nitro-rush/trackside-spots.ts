import { ORBIT_RADIUS } from './camera'
import { CLEAR_HEIGHT, DECK_DEPTH } from './road-geometry'
import { headingOf, newTrackFrame, WALL_BASE_HALF, WALL_HEIGHT, wallFoot, type Track, type TrackLine } from '#shared/utils/nitro-rush/track'

/**
 * Where the signage round a course stands: billboards, hoardings, overhead banners, flags and corner chevrons.
 * Every piece keeps under CLEAR_HEIGHT over its own road and out of every other road's clearance, so a road passing over never cuts through one.
 */

export type Vec3 = [number, number, number]

/** A spot on the road's frame: x across to its right, y up off it, z back against the way the cars run. */
export interface Fixture {
    x: number
    y: number
    z: number
    right: Vec3
    up: Vec3
    back: Vec3
    /** The wall it stands on: -1 left, 1 right. */
    side: -1 | 1
    /** The road it stands on, and how far along. */
    branch: number
    s: number
}

export interface Billboard {
    x: number
    z: number
    /** The road's height beside it, where the board's foot is. */
    base: number
    heading: number
    /** The road it stands beside, and how far along. */
    branch: number
    s: number
}

export interface Chevron extends Fixture {
    /** 1 gentle, 2 medium, 3 hairpin. */
    grade: 1 | 2 | 3
}

export interface Overhead extends Fixture {
    /** Centreline to each wall's face. */
    wall: number
}

export interface TracksideLayout {
    billboards: Billboard[]
    chevrons: Chevron[]
    /** One list per bay between two floodlights; a bay shares one ad. */
    hoardings: Fixture[][]
    /** Clusters of flags, a cluster sharing one ad. */
    flags: Fixture[][]
    overheads: Overhead[]
}

/** Floodlights stand along each wall this far apart, the right wall's half a gap on. */
export const LAMP_SPACING = 34
export const lampSlot = (k: number, side: -1 | 1) => (k + (side > 0 ? 0.5 : 0)) * LAMP_SPACING
/** Kerbs go where the line turns tighter than this (radians per metre); anything gentler counts as straight. */
export const KERB_MIN_CURVATURE = 0.004

export const BILLBOARD_WIDTH = 9.2
export const BILLBOARD_HEIGHT = BILLBOARD_WIDTH / 2
/** The board's top sits on the clearance line. */
export const BILLBOARD_BOTTOM = CLEAR_HEIGHT - 0.05 - BILLBOARD_HEIGHT
const BILLBOARD_RADIUS = BILLBOARD_WIDTH / 2 + 0.3
/** Turned this far off the road's heading, toward the cars coming at it. */
const BILLBOARD_TOE = 0.5

export const HOARDING_LENGTH = 7.4
export const HOARDING_HEIGHT = 0.9
const HOARDING_GAP = 0.4
const HOARDINGS_PER_BAY = 4

export const CHEVRON_WIDTH = 1.3
export const CHEVRON_HEIGHT = 1
/** Up off the wall's top, clear of a tall car's roof scraping along under it. */
export const CHEVRON_LIFT = 0.64
/** The gentlest radius that gets chevrons, then the medium and hairpin limits. */
const CHEVRON_RADII = [90, 55, 35] as const
const CHEVRON_SPACING = [12, 9, 6.5] as const
/** They start this far before the bend, where the driver needs them. */
const CHEVRON_LEAD = 6
const CHEVRON_MIN_BEND = 10

export const FLAG_POLE = 4
export const FLAG_WIDTH = 0.85
export const FLAG_HEIGHT = 3
const FLAG_SPACING = 5
/** Flags line the walls this far either side of the start and the finish. */
const FLAG_REACH = 30
const FLAGS_PER_CLUSTER = 3

/** The ad formats the slots along a road take in turn. */
const SLOT_FORMATS = ['hoarding', 'billboard', 'flags'] as const
/** One ad slot every this far along a road, the two walls taking turns. */
const AD_SLOT_SPACING = LAMP_SPACING * 1.5

/** The beam's top sits on the clearance line, the banner hangs under it, its bottom above the gantry banner's so the chase camera clears it. */
export const OVERHEAD_BEAM = 0.3
export const OVERHEAD_BANNER = 1.3
const OVERHEAD_MIN_STRAIGHT = 70
const OVERHEADS_PER_COURSE = 3

/** Wall fixtures stay this far off a lap line, where the arch comes down over the wall, and off a floodlight's pole. */
const LAP_LINE_CLEAR = 4
const LAMP_CLEAR = 1.2
const BILLBOARD_LAP_CLEAR = 14

/** A stretch round `s` that hoardings leave free. */
interface KeepOut {
    line: TrackLine
    s: number
    d: number
}

const frame = newTrackFrame()

/** The road's frame `lat` across and `lift` up from its centreline at `s`, as a fixture on `side`. */
function fixtureAt(line: TrackLine, s: number, lat: number, lift: number, side: -1 | 1): Fixture {
    const f = line.frameAt(s, frame)
    return {
        x: f.x + f.rx * lat + f.ux * lift,
        y: f.y + f.ry * lat + f.uy * lift,
        z: f.z + f.rz * lat + f.uz * lift,
        right: [f.rx, f.ry, f.rz],
        up: [f.ux, f.uy, f.uz],
        back: [-f.tx, -f.ty, -f.tz],
        side,
        branch: line.branch,
        s
    }
}

/** The top of a wall's crown, where wall fixtures stand. */
const wallTop = (line: TrackLine, s: number, side: -1 | 1) => fixtureAt(line, s, side * (line.wallAt(s) + WALL_BASE_HALF), WALL_HEIGHT, side)

/** Distance along a line between two spots, the short way round a loop. */
function along(line: TrackLine, a: number, b: number) {
    const d = Math.abs(a - b)
    return line.closed ? Math.min(d, line.length - d) : d
}

/**
 * True unless a road's clearance (its deck up to CLEAR_HEIGHT over it) comes within `radius` across of (x, z) between heights `low` and `high`.
 * The stretch of `own` within `reach` of `s` is the fixture's own road, which it may stand on.
 */
export function clearOfRoads(lines: readonly TrackLine[], x: number, z: number, radius: number, low: number, high: number, own?: { line: TrackLine, s: number, reach: number }) {
    for (const line of lines) {
        for (let k = 0; k < line.n; k++) {
            if (own && line === own.line && along(line, line.cum[k]!, own.s) < own.reach) continue
            const wall = line.walls[k]!
            const foot = wallFoot(wall)
            // A bank lifts one edge and drops the other.
            const tilt = Math.abs(line.right[k * 3 + 1]!) * foot
            const y = line.ys[k]!
            if (y + CLEAR_HEIGHT + tilt < low || y - DECK_DEPTH - tilt > high) continue
            const dx = line.xs[k]! - x
            const dz = line.zs[k]! - z
            const reach = foot + radius
            if (dx * dx + dz * dz < reach * reach) return false
        }
    }
    return true
}

/** A wall fixture's clearance check: up its own height off the wall, and clear of every other road. */
function fixtureClear(track: Track, line: TrackLine, s: number, f: Fixture, radius: number, height: number) {
    const top = f.y + f.up[1] * height
    return clearOfRoads(track.branches, f.x, f.z, radius, Math.min(f.y, top) - 0.1, Math.max(f.y, top) + 0.1, { line, s, reach: 2 * (wallFoot(line.wallAt(s)) + radius) + 10 })
}

/** Lap lines on a line, by distance along it. */
function lapLinesOn(track: Track, line: TrackLine, kinds: readonly string[] = ['start', 'finish', 'checkpoint']) {
    return track.lapLines.filter(l => l.branch === line.branch && kinds.includes(l.kind)).map(l => l.s)
}

const near = (line: TrackLine, s: number, spots: readonly number[], d: number) => spots.some(t => along(line, s, t) < d)

const nearLamp = (line: TrackLine, s: number, side: -1 | 1) => {
    const k = Math.round(s / LAMP_SPACING - (side > 0 ? 0.5 : 0))
    return along(line, s, lampSlot(k, side)) < LAMP_CLEAR
}

/** Plain road with its wall standing on `side` from `from` to `to`, and the same width throughout. */
function plainWall(line: TrackLine, from: number, to: number, side: -1 | 1) {
    if (!line.closed && (from < 0 || to > line.length)) return false
    const [a, m, b] = [from, (from + to) / 2, to].map(t => line.wrapS(t)) as [number, number, number]
    for (const s of [a, m, b]) {
        if (!line.plainRoadAt(s) || line.openAt(s, side)) return false
    }
    return Math.abs(line.wallAt(a) - line.wallAt(b)) < 0.1
}

/** The bend's turn at point `i`: 1 right, -1 left. */
function turnAt(line: TrackLine, i: number) {
    const a = line.closed ? (i - 1 + line.n) % line.n : Math.max(0, i - 1)
    const b = line.closed ? (i + 1) % line.n : Math.min(line.n - 1, i + 1)
    const cross = line.txs[a]! * line.tzs[b]! - line.tzs[a]! * line.txs[b]!
    return cross > 0 ? 1 : -1
}

const chevronGrade = (curvature: number): 0 | 1 | 2 | 3 => {
    const r = 1 / curvature
    return r <= CHEVRON_RADII[2] ? 3 : r <= CHEVRON_RADII[1] ? 2 : r <= CHEVRON_RADII[0] ? 1 : 0
}

/** Boards on the outside wall of every bend, closer together and redder the tighter it is. */
function chevronsOn(track: Track, line: TrackLine, out: Chevron[], keepOut: KeepOut[]) {
    const laps = lapLinesOn(track, line)
    let i = 0
    while (i < line.n) {
        if (chevronGrade(line.curvature[i]!) === 0) {
            i++
            continue
        }
        const turn = turnAt(line, i)
        let j = i
        let tightest = 0
        while (j < line.n && chevronGrade(line.curvature[j]!) > 0 && turnAt(line, j) === turn) tightest = Math.max(tightest, line.curvature[j++]!)
        const from = line.cum[i]!
        const to = line.cum[j - 1]!
        i = j
        if (to - from < CHEVRON_MIN_BEND) continue
        const grade = chevronGrade(tightest) as 1 | 2 | 3
        const side = -turn as -1 | 1
        const start = line.closed ? from - CHEVRON_LEAD : Math.max(0, from - CHEVRON_LEAD)
        for (let s = start; s <= to; s += CHEVRON_SPACING[grade - 1]!) {
            const at = line.closed ? line.wrapS(s) : s
            if (!line.solidRoadAt(at) || line.openAt(at, side) || near(line, at, laps, LAP_LINE_CLEAR)) continue
            if (line.plainRoadAt(at) && nearLamp(line, at, side)) continue
            const f = wallTop(line, at, side)
            if (!fixtureClear(track, line, at, f, CHEVRON_WIDTH, CHEVRON_LIFT + CHEVRON_HEIGHT)) continue
            out.push({ ...f, grade })
            // Hoardings stand back from a bend's chevrons, so the bend reads on its own.
            keepOut.push({ line, s: at, d: 6 })
        }
    }
}

/** Straight stretches, as [from, to] along the line: plain road, both walls standing, turning gentler than a kerb. */
function straightsOn(line: TrackLine) {
    const runs: [number, number][] = []
    let from = -1
    for (let i = 0; i <= line.n; i++) {
        const s = i < line.n ? line.cum[i]! : line.length
        const ok = i < line.n && line.curvature[i]! < KERB_MIN_CURVATURE && line.plainRoadAt(s) && !line.openAt(s, -1) && !line.openAt(s, 1)
        if (ok && from < 0) from = s
        if (!ok && from >= 0) {
            runs.push([from, s])
            from = -1
        }
    }
    return runs
}

/** A banner across the middle of the longest straights, its posts on the walls between two floodlights. */
function overheadsOn(track: Track, out: { line: TrackLine, s: number, length: number }[]) {
    for (const line of track.branches) {
        const laps = lapLinesOn(track, line)
        for (const [from, to] of straightsOn(line)) {
            if (to - from < OVERHEAD_MIN_STRAIGHT) continue
            // Halfway between the left wall's floodlights is a right one, so a quarter of the way along clears both.
            const s = (Math.round((from + to) / 2 / LAMP_SPACING - 0.25) + 0.25) * LAMP_SPACING
            if (s < from + 10 || s > to - 10 || near(line, s, laps, 40)) continue
            out.push({ line, s, length: to - from })
        }
    }
}

/** A flag on the wall at `s` if it fits there; `keepOut` as for hoardings. */
function flagAt(track: Track, line: TrackLine, s: number, side: -1 | 1, laps: readonly number[], keepOut: readonly KeepOut[]) {
    if (!line.closed && (s < 0 || s > line.length)) return null
    const at = line.wrapS(s)
    if (!plainWall(line, at, at, side) || near(line, at, laps, LAP_LINE_CLEAR) || nearLamp(line, at, side)) return null
    if (keepOut.some(o => o.line === line && along(line, at, o.s) < o.d)) return null
    const f = wallTop(line, at, side)
    return fixtureClear(track, line, at, f, FLAG_WIDTH + 0.2, FLAG_POLE) ? f : null
}

/** Feather flags along both walls round the start and any finish, a cluster to each wall. */
function startFlagsOn(track: Track, line: TrackLine, out: Fixture[][]) {
    const laps = lapLinesOn(track, line)
    for (const centre of lapLinesOn(track, line, ['start', 'finish'])) {
        for (const side of [-1, 1] as const) {
            const cluster: Fixture[] = []
            for (let d = -FLAG_REACH; d <= FLAG_REACH; d += FLAG_SPACING) {
                const f = flagAt(track, line, centre + d, side, laps, [])
                if (f) cluster.push(f)
            }
            if (cluster.length) out.push(cluster)
        }
    }
}

/** The ad panels of the bay holding `s` on `side`, between two floodlights; only on the straight. */
function hoardingBay(track: Track, line: TrackLine, s: number, side: -1 | 1, laps: readonly number[], keepOut: readonly KeepOut[]) {
    const k = Math.floor(s / LAMP_SPACING - (side > 0 ? 0.5 : 0))
    const bayStart = lampSlot(k, side) + (LAMP_SPACING - HOARDINGS_PER_BAY * HOARDING_LENGTH - (HOARDINGS_PER_BAY - 1) * HOARDING_GAP) / 2
    const half = HOARDING_LENGTH / 2
    const bay: Fixture[] = []
    for (let p = 0; p < HOARDINGS_PER_BAY; p++) {
        const c = bayStart + half + p * (HOARDING_LENGTH + HOARDING_GAP)
        if (!plainWall(line, c - half, c + half, side)) continue
        const at = line.wrapS(c)
        if ([c - half, c, c + half].some(t => line.curvature[line.segmentAt(line.wrapS(t))]! >= KERB_MIN_CURVATURE)) continue
        if (near(line, at, laps, half + LAP_LINE_CLEAR) || keepOut.some(o => o.line === line && along(line, at, o.s) < half + o.d)) continue
        const f = wallTop(line, at, side)
        if (fixtureClear(track, line, at, f, half, HOARDING_HEIGHT)) bay.push(f)
    }
    // A bay cut down to one panel reads as a leftover, not an ad.
    return bay.length > 1 ? bay : null
}

/** Whether a board at (x, z) stands inside the menu camera's orbit of a car on any road at its height, a fork beside it included. */
function orbitHits(track: Track, x: number, z: number, y: number) {
    return track.branches.some(line => {
        const p = line.project(x, z)
        if (p.s <= 0 || p.s >= line.length || Math.abs(line.pointAt(p.s).y - y) > 1) return false
        return Math.abs(p.lateral) - BILLBOARD_RADIUS <= line.halfWidthAt(p.s) + ORBIT_RADIUS
    })
}

/** A board on legs off the plain road at `s`, if nothing else is in its way. */
function billboardAt(track: Track, line: TrackLine, s: number, side: -1 | 1, laps: readonly number[]): Billboard | null {
    if (s >= line.length || !line.plainRoadAt(s) || line.openAt(s, side) || near(line, s, laps, BILLBOARD_LAP_CLEAR)) return null
    const p = line.pointAt(s)
    // Clear of its own road, and of the menu camera circling a car that runs along the wall where the road widens nearby.
    let wide = 0
    for (let d = -BILLBOARD_WIDTH; d <= BILLBOARD_WIDTH; d += 2) wide = Math.max(wide, line.halfWidthAt(Math.min(line.length, Math.max(0, s + d))))
    const lat = side * (Math.max(wallFoot(line.wallAt(s)), wide + ORBIT_RADIUS) + BILLBOARD_RADIUS + 0.5)
    const x = p.x - p.tz * lat
    const z = p.z + p.tx * lat
    // Its legs run down to the ground, so nothing may pass anywhere under it either.
    if (!clearOfRoads(track.branches, x, z, BILLBOARD_RADIUS, Math.min(0, p.y), p.y + CLEAR_HEIGHT)) return null
    if (orbitHits(track, x, z, p.y)) return null
    return { x, z, base: p.y, heading: headingOf(p.tx, p.tz) - side * BILLBOARD_TOE, branch: line.branch, s }
}

/** A few flags together on the wall round `s`. */
function flagCluster(track: Track, line: TrackLine, s: number, side: -1 | 1, laps: readonly number[], keepOut: readonly KeepOut[]) {
    const cluster: Fixture[] = []
    for (let i = 0; i < FLAGS_PER_CLUSTER; i++) {
        const f = flagAt(track, line, s + (i - (FLAGS_PER_CLUSTER - 1) / 2) * FLAG_SPACING, side, laps, keepOut)
        if (f) cluster.push(f)
    }
    return cluster.length > 1 ? cluster : null
}

/**
 * One ad slot every AD_SLOT_SPACING along each road, the walls taking turns, and the formats taking turns round the course.
 * A slot that can't take its format tries the next, so a bend gets a billboard where a hoarding won't fit.
 */
function adSlots(track: Track, keepOut: readonly KeepOut[], overheads: readonly Overhead[], out: Pick<TracksideLayout, 'billboards' | 'hoardings' | 'flags'>) {
    let turn = 0
    for (const line of track.branches) {
        const laps = lapLinesOn(track, line)
        const banners = overheads.filter(o => o.branch === line.branch).map(o => o.s)
        let last: typeof SLOT_FORMATS[number] | null = null
        for (let j = 0; (j + 0.5) * AD_SLOT_SPACING < line.length; j++) {
            const s = (j + 0.5) * AD_SLOT_SPACING
            const side = j % 2 ? 1 : -1
            // An overhead banner is this stretch's ad.
            if (near(line, s, banners, AD_SLOT_SPACING / 2)) continue
            for (let t = 0; t < SLOT_FORMATS.length; t++) {
                const format = SLOT_FORMATS[(turn + t) % SLOT_FORMATS.length]!
                // Better an empty slot than the same ad format twice running.
                if (format === last) continue
                const placed = format === 'hoarding'
                    ? push(out.hoardings, hoardingBay(track, line, s, side, laps, keepOut))
                    : format === 'billboard'
                        ? push(out.billboards, billboardAt(track, line, s, side, laps))
                        : push(out.flags, flagCluster(track, line, s, side, laps, keepOut))
                if (placed) {
                    last = format
                    turn += t + 1
                    break
                }
            }
        }
    }
}

const push = <T>(list: T[], item: T | null) => {
    if (item) list.push(item)
    return !!item
}

export function tracksideLayout(track: Track): TracksideLayout {
    const chevrons: Chevron[] = []
    const flags: Fixture[][] = []
    const hoardings: Fixture[][] = []
    const billboards: Billboard[] = []
    const straights: { line: TrackLine, s: number, length: number }[] = []
    overheadsOn(track, straights)
    const overheads: Overhead[] = []
    const keepOut: KeepOut[] = []
    for (const o of straights.sort((a, b) => b.length - a.length)) {
        if (overheads.length >= OVERHEADS_PER_COURSE) break
        const f = fixtureAt(o.line, o.s, 0, 0, 1)
        const wall = o.line.wallAt(o.s)
        if (!clearOfRoads(track.branches, f.x, f.z, wallFoot(wall), f.y - 0.1, f.y + CLEAR_HEIGHT, { line: o.line, s: o.s, reach: 4 * wallFoot(wall) + 10 })) continue
        overheads.push({ ...f, wall })
        keepOut.push({ line: o.line, s: o.s, d: 0.8 })
    }
    for (const line of track.branches) {
        chevronsOn(track, line, chevrons, keepOut)
        startFlagsOn(track, line, flags)
        for (const s of lapLinesOn(track, line, ['start', 'finish'])) keepOut.push({ line, s, d: FLAG_REACH + 2 })
    }
    adSlots(track, keepOut, overheads, { billboards, hoardings, flags })
    return { billboards, chevrons, hoardings, flags, overheads }
}
