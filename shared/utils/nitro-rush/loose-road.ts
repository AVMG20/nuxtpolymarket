import { compileMainRoad, customLayout, forkShape, lineSections, MAX_LOOSE, SECTIONS, type CustomTrack, type LooseRoad, type SectionId } from './custom'
import { walkForks, withLineSections } from './custom-forks'
import { mapWalkHeights, raisedTo, walkLayout, type LayoutWalk, type Pose, type RoadState } from './layout'
import type { Obstacle } from './obstacles'
import { clearanceReach, MIN_CLEARANCE } from './road-checks'
import { ROAD } from './tracks'

/**
 * Loose road in the track builder: sections placed anywhere, and road cut off the course, that join up with the
 * course once its end lands on their start. Each stretch is walked like a line of its own from its own pose, on
 * the grid round the main road's start, so once it joins on it walks exactly where it was drawn.
 */

const EIGHTH = Math.PI / 4
/** How far apart two levels of free placement sit: clear of the road below with room to spare. */
export const LEVEL_HEIGHT = 8
/** Ends this close count as one: walks round off to well under it. */
const MEET_DISTANCE = 0.5
const MEET_HEIGHT = 0.5
/** Placing within this many metres of an open end lays onto that end instead. */
export const SNAP_RADIUS = 18

const LEVEL: RoadState = { bank: 0, grade: 0, halfWidth: ROAD.halfWidth, air: 0 }

/** `obstacles` from section `from` up to (not including) `to` of their sections, moved onto line `line` from section `at` on. */
function carried(obstacles: readonly Obstacle[] | undefined, from: number, to: number, line: number, at: number): Obstacle[] {
    return (obstacles ?? []).filter(o => o.at >= from && o.at < to).map(o => ({ ...o, line, at: o.at - from + at }))
}

/** `r` carrying `obstacles`, or none. */
function carrying(r: LooseRoad, obstacles: Obstacle[]): LooseRoad {
    const { obstacles: _, ...rest } = r
    return obstacles.length ? { ...rest, obstacles } : rest
}

/** `t` with `obstacles` added to the course's own. */
function withMoreObstacles(t: CustomTrack, obstacles: Obstacle[]): CustomTrack {
    return obstacles.length ? { ...t, obstacles: [...t.obstacles ?? [], ...obstacles] } : t
}

export const loosePose = (r: Pick<LooseRoad, 'x' | 'z' | 'eighths'>): Pose => ({ x: r.x, z: r.z, heading: r.eighths * EIGHTH })
export const looseState = (r: LooseRoad): RoadState => ({ ...LEVEL, ...r.from })

/** A stretch of loose road walked on its own, its start's road at height 0 plus its own rise, as a line is. */
export function walkLoose(r: LooseRoad): LayoutWalk {
    return walkLayout(customLayout({ id: 'loose', name: '', closed: false, sections: r.sections }), r.from ?? {}, loosePose(r))
}

/** The lowest a walk's road gets below its start. */
function lowestBelowStart(w: LayoutWalk) {
    let low = w.end.aboveStart
    for (let k = 0; k < w.ys.length; k++) low = Math.min(low, w.ys[k]! - w.rise - w.lifts[k]!)
    return low
}

/** The course's lines and its loose road on one ground, as the builder draws them. */
export interface DraftGround {
    lines: LayoutWalk[]
    loose: LayoutWalk[]
    /** Height of the main road's start line above the ground. */
    rise: number
}

/** Lays the loose road on the lines' ground, lifting everything when loose road would dig in below it. */
export function onOneGround(lines: readonly LayoutWalk[], loose: readonly LooseRoad[]): DraftGround {
    const main = lines[0]!.rise
    const walks = loose.map(walkLoose)
    let extra = 0
    walks.forEach((w, i) => {
        extra = Math.max(extra, -(loose[i]!.y + main + lowestBelowStart(w)))
    })
    return {
        lines: extra > 1e-6 ? lines.map(w => raisedTo(w, w.rise + extra)) : [...lines],
        loose: walks.map((w, i) => raisedTo(w, loose[i]!.y + main + extra)),
        rise: main + extra
    }
}

/** Where some road ends or starts, as drawn: its pose, its road height and the state it's in there. */
export interface RoadEndPose {
    x: number
    z: number
    heading: number
    y: number
    state: RoadState
}

const stateOf = ({ bank, grade, halfWidth, air }: RoadState): RoadState => ({ bank, grade, halfWidth, air })

/** Where a drawn walk ends. */
export const endOf = ({ end }: LayoutWalk): RoadEndPose => ({ x: end.x, z: end.z, heading: end.heading, y: end.y - end.lift, state: stateOf(end) })

/** Where loose road starts, on a ground whose main start is `rise` up. */
export const headOf = (r: LooseRoad, rise: number): RoadEndPose => ({ ...loosePose(r), y: r.y + rise, state: looseState(r) })

const sameAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-3
const sameState = (a: RoadState, b: RoadState) => Math.abs(a.bank - b.bank) < 1e-3 && Math.abs(a.grade - b.grade) < 1e-6
    && Math.abs(a.halfWidth - b.halfWidth) < 1e-6 && Math.abs(a.air - b.air) < 1e-6

/** Whether road ending at `a` carries straight on into road starting at `b`. */
export function meets(a: RoadEndPose, b: RoadEndPose) {
    return Math.hypot(a.x - b.x, a.z - b.z) < MEET_DISTANCE && Math.abs(a.y - b.y) < MEET_HEIGHT && sameAngle(a.heading, b.heading) && sameState(a.state, b.state)
}

/** Per line of the course, whether new road can go on from its end: a loop's main road until it closes, a branch with no join. */
export function openLines(t: CustomTrack): boolean[] {
    return [!t.closed || !compileMainRoad(t).def, ...(t.branches ?? []).map(b => !b.to)]
}

/**
 * Joins up whatever meets: a line whose end lands on loose road's start takes that road on, and loose road
 * whose end lands on other loose road's start takes it on, until nothing more meets.
 */
export function joinLoose(t: CustomTrack): CustomTrack {
    let next = t
    for (let guard = 0; guard < 64 && next.loose?.length; guard++) {
        const ground = onOneGround(walkForks(next).walks, next.loose)
        const heads = next.loose.map(r => headOf(r, ground.rise))
        const lineOpen = openLines(next)
        let joined: CustomTrack | null = null
        for (let l = 0; l < ground.lines.length && !joined; l++) {
            if (!lineOpen[l]) continue
            const end = endOf(ground.lines[l]!)
            const k = heads.findIndex(h => meets(end, h))
            if (k < 0) continue
            const r = next.loose[k]!
            const length = lineSections(next, l).length
            joined = withoutLoose(withMoreObstacles(withLineSections(next, l, [...lineSections(next, l), ...r.sections]), carried(r.obstacles, 0, r.sections.length, l, length)), k)
        }
        for (let i = 0; i < ground.loose.length && !joined; i++) {
            const end = endOf(ground.loose[i]!)
            const k = heads.findIndex((h, j) => j !== i && meets(end, h))
            if (k < 0) continue
            const onto = next.loose[k]!
            const loose = next.loose.map((r, j) => j === i
                ? carrying({ ...r, sections: [...r.sections, ...onto.sections] }, [...r.obstacles ?? [], ...carried(onto.obstacles, 0, onto.sections.length, 0, r.sections.length)])
                : r)
            joined = withoutLoose({ ...next, loose }, k)
        }
        if (!joined) break
        next = joined
    }
    return next
}

/** `t` without loose road `k`. */
export function withoutLoose(t: CustomTrack, k: number): CustomTrack {
    const loose = (t.loose ?? []).filter((_, j) => j !== k)
    const out: CustomTrack = { ...t, loose }
    if (!loose.length) delete out.loose
    return out
}

/** `t` with loose road `k` swapped for `r`, or, with null, without it. */
export function withLoose(t: CustomTrack, k: number, r: LooseRoad | null): CustomTrack {
    if (!r || !r.sections.length) return withoutLoose(t, k)
    const loose = [...t.loose ?? []]
    if (k >= loose.length) loose.push(r)
    else loose[k] = r
    return { ...t, loose }
}

/** Rounds away a walk's float noise, so road cut off the course still lands back on it. */
const tidy = (v: number) => Math.round(v * 1e4) / 1e4

/** Loose road starting where `end` is, on a ground whose main start is `rise` up; null when the end isn't on an eighth. */
function looseAt(end: LayoutWalk['end'], rise: number, sections: SectionId[]): LooseRoad | null {
    const eighths = Math.round(end.heading / EIGHTH)
    if (Math.abs(end.heading - eighths * EIGHTH) > 1e-6) return null
    const r: LooseRoad = { x: tidy(end.x), z: tidy(end.z), eighths: ((eighths % 8) + 8) % 8, y: tidy(end.y - end.lift - rise), sections }
    const state = stateOf(end)
    if (!sameState(state, LEVEL)) r.from = state
    return r
}

/** Whether the sections from `index` on of line `line` can be cut off as loose road: no fork on them, none leaving or coming into them. */
function canCut(t: CustomTrack, line: number, index: number) {
    const rest = lineSections(t, line).slice(index)
    if (rest.some(id => forkShape(id, 'split') || forkShape(id, 'join'))) return false
    return !(t.branches ?? []).some(b => (b.from.branch === line && b.from.at >= index) || (b.to?.branch === line && b.to.at >= index))
        && !(line && t.branches?.[line - 1]?.to)
}

/**
 * Takes section `index` off line `line`, leaving the road after it where it is as loose road; null when that road
 * can't be cut off (a fork on it, or a branch hanging off it), which the caller takes out the old way instead.
 */
export function cutOut(t: CustomTrack, line: number, index: number): CustomTrack | null {
    const sections = lineSections(t, line)
    if (index < 0 || index >= sections.length) return null
    if (forkShape(sections[index], 'split') || forkShape(sections[index], 'join')) return null
    const rest = sections.slice(index + 1)
    const onLine = (t.obstacles ?? []).filter(o => o.line === line)
    // The course keeps what stands before the cut; what stands after it goes with the loose road.
    const keptObstacles = (t.obstacles ?? []).filter(o => o.line !== line || o.at < index)
    const base: CustomTrack = { ...withLineSections(t, line, sections.slice(0, index)) }
    delete base.obstacles
    const kept = keptObstacles.length ? { ...base, obstacles: keptObstacles } : base
    if (!rest.length) return kept
    if (!canCut(t, line, index + 1)) return null
    const walks = walkForks(withLineSections(t, line, sections.slice(0, index + 1))).walks
    const r = looseAt(walks[line]!.end, walks[0]!.rise, rest)
    if (!r || (t.loose?.length ?? 0) >= MAX_LOOSE) return null
    return { ...kept, loose: [...t.loose ?? [], carrying(r, carried(onLine, index + 1, sections.length, 0, 0))] }
}

/** Takes section `index` off loose road `k`: the road before it stays, the road after it stays where it is as loose road of its own. */
export function cutLoose(t: CustomTrack, k: number, index: number): CustomTrack {
    const r = t.loose?.[k]
    if (!r || index < 0 || index >= r.sections.length) return t
    const before = r.sections.slice(0, index)
    const after = r.sections.slice(index + 1)
    let next = withLoose(t, k, before.length ? carrying({ ...r, sections: before }, carried(r.obstacles, 0, index, 0, 0)) : null)
    if (after.length) {
        const w = walkLoose({ ...r, sections: r.sections.slice(0, index + 1) })
        const tail = looseAt(w.end, w.rise - r.y, after)
        if (tail) next = { ...next, loose: [...next.loose ?? [], carrying(tail, carried(r.obstacles, index + 1, r.sections.length, 0, 0))] }
    }
    return next
}

/** Loose road `k` moved `dx`, `dz` metres and `dy` up. */
export function moveLoose(t: CustomTrack, k: number, dx: number, dz: number, dy = 0): CustomTrack {
    const r = t.loose?.[k]
    return r ? withLoose(t, k, { ...r, x: tidy(r.x + dx), z: tidy(r.z + dz), y: tidy(r.y + dy) }) : t
}

/** Loose road `k` turned `quarters` quarter turns right about its start. */
export function turnLoose(t: CustomTrack, k: number, quarters: number): CustomTrack {
    const r = t.loose?.[k]
    return r ? withLoose(t, k, { ...r, eighths: (((r.eighths + quarters * 2) % 8) + 8) % 8 }) : t
}

/** Each section's mirror image: left for right; a section with no side is its own. */
const MIRROR: Record<string, SectionId> = Object.fromEntries((Object.keys(SECTIONS) as SectionId[]).map((id) => {
    const swapped = id.replace(/left|right/g, s => s === 'left' ? 'right' : 'left')
    return [id, (Object.hasOwn(SECTIONS, swapped) ? swapped : id) as SectionId]
}))

/** Loose road `k` mirrored, left turns for right, about the line it sets off along. */
export function mirrorLoose(t: CustomTrack, k: number): CustomTrack {
    const r = t.loose?.[k]
    if (!r) return t
    const from = r.from && { ...r.from, ...r.from.bank ? { bank: -r.from.bank } : {} }
    const obstacles = (r.obstacles ?? []).map(o => ({ ...o, lateral: -o.lateral }))
    return withLoose(t, k, carrying({ ...r, sections: r.sections.map(id => MIRROR[id]!), ...from ? { from } : {} }, obstacles))
}

/** A copy of loose road `k`, `dx`, `dz` metres off it; null when there's no room for more loose road. */
export function copyLoose(t: CustomTrack, k: number, dx: number, dz: number): CustomTrack | null {
    const r = t.loose?.[k]
    if (!r || (t.loose?.length ?? 0) >= MAX_LOOSE) return null
    return { ...t, loose: [...t.loose!, { ...r, x: tidy(r.x + dx), z: tidy(r.z + dz) }] }
}

/** A walk with every height moved so its start's road is at `y`. */
export function startingAt(walk: LayoutWalk, y: number): LayoutWalk {
    const at = (walk.ys[0] ?? walk.end.y) - (walk.lifts[0] ?? walk.end.lift)
    return Math.abs(at - y) < 1e-9 ? walk : mapWalkHeights(walk, v => v + y - at)
}

/** Cell size of the map of laid road a new piece is checked against. */
const CELL = 20

/** Road already laid, in buckets, for checking a piece about to go down against it quickly. */
export class LaidRoad {
    private readonly cells = new Map<string, { x: number, z: number, y: number, wall: number }[]>()

    constructor(walks: readonly LayoutWalk[]) {
        for (const w of walks) {
            const gaps = w.gaps
            for (let i = 0; i < w.pts.length; i++) {
                if (gaps.some(([a, b]) => i >= a && i < b)) continue
                const [x, z] = w.pts[i]!
                const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
                let cell = this.cells.get(key)
                if (!cell) this.cells.set(key, cell = [])
                cell.push({ x, z, y: w.ys[i]! - w.lifts[i]!, wall: w.walls[i]! })
            }
        }
    }

    /** Whether `walk` runs too close to the laid road anywhere further than `free` metres from where it starts, or `freeEnd` from where it ends. */
    clashes(walk: LayoutWalk, free: number, freeEnd = 0) {
        const [sx, sz] = walk.pts[0] ?? [walk.end.x, walk.end.z]
        for (let i = 0; i < walk.pts.length; i++) {
            if (walk.gaps.some(([a, b]) => i >= a && i < b)) continue
            const [x, z] = walk.pts[i]!
            if (Math.hypot(x - sx, z - sz) < free || Math.hypot(x - walk.end.x, z - walk.end.z) < freeEnd) continue
            const y = walk.ys[i]! - walk.lifts[i]!
            const cx = Math.floor(x / CELL)
            const cz = Math.floor(z / CELL)
            for (let ox = -2; ox <= 2; ox++) {
                for (let oz = -2; oz <= 2; oz++) {
                    for (const p of this.cells.get(`${cx + ox},${cz + oz}`) ?? []) {
                        if (Math.abs(p.y - y) >= MIN_CLEARANCE) continue
                        if (Math.hypot(p.x - x, p.z - z) < clearanceReach(p.wall, walk.walls[i]!)) return true
                    }
                }
            }
        }
        return false
    }
}
