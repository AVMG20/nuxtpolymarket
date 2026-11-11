import { cheapestPath, type PathStep } from './cheapest-path'
import { BENDS, SLOPE_STEPS, STRAIGHTS, STRAIGHT_LENGTHS, targetOf, type BendSize, type Curve } from './construct'
import { compileMainRoad, mapWalkHeights, MAX_SECTIONS, SECTIONS, sectionCount, walkCustomTrack, type CustomTrack, type SectionId } from './custom'
import { draftForkedDef, walkCustomLines, walkForks, type JoinInlet } from './custom-forks'
import { mergeFrom } from './fork-pieces'
import { BANK_LENGTH, GRID, onAxis, SLOPE_LENGTH, type LayoutWalk } from './layout'
import { clearanceFault, clearanceReach, clearanceSpan, layoutFault, MIN_CLEARANCE, STEP, trackClearanceFault } from './road-checks'
import { Track } from './track'
import { ROAD } from './tracks'

/** Finishing a loop or a branch: the sections that take an open road, from wherever it ends, back to its start line or onto the road it joins. */

export type FinishedLoop = { sections: SectionId[], error: null } | { sections: null, error: string }

interface Found {
    sections: SectionId[]
    cost: number
}

type Step<S> = PathStep<S, SectionId>

/** Keeps a course with no way back from holding up the page while it looks. */
const SEARCH_LIMIT = 15_000

/** Where the road is, in metres from the start line's height, and heading; grades in tenths, since every height lands on a whole metre. */
interface Height {
    y: number
    tenths: number
    banked: boolean
}

const UNIT_RUN = STRAIGHT_LENGTHS[0]!
const UNIT_SECTION = STRAIGHTS[UNIT_RUN]
/** A small nudge, so a bank levels first wherever the order makes no other difference. */
const BANKED_NUDGE = 1e-3
/** How far above where it began a road may climb to get the run-up a low descent needs. */
const CLIMB_ROOM = 12

const SLOPES = SLOPE_STEPS.map(s => ({ id: s.id, tenths: Math.round(targetOf(s.id) * 10) }))

const found = (path: { labels: SectionId[], cost: number } | null): Found | null => path && { sections: path.labels, cost: path.cost }

/** The state pieces and straights that take a road to a height and grade that's `settled`, never below `floor`. */
function settleAbove(floor: number, from: Height, settled: (h: Height) => boolean) {
    const ceiling = Math.max(0, from.y) + CLIMB_ROOM
    return found(cheapestPath<Height, SectionId>(from, {
        limit: SEARCH_LIMIT,
        key: h => `${h.y}:${h.tenths}:${h.banked}`,
        done: settled,
        estimate: () => 0,
        steps({ y, tenths, banked }) {
            const nudge = banked ? BANKED_NUDGE : 0
            const steps: Step<Height>[] = []
            for (const s of SLOPES) {
                if (s.tenths === tenths) continue
                // A change of direction bottoms out part way along the piece.
                const bottom = tenths < 0 && s.tenths > 0 ? y + (tenths / 10) * (SLOPE_LENGTH * -tenths / (s.tenths - tenths)) / 2 : y
                if (bottom < floor) continue
                steps.push({ to: { y: y + SLOPE_LENGTH * (tenths + s.tenths) / 20, tenths: s.tenths, banked }, cost: SLOPE_LENGTH + nudge, label: s.id })
            }
            if (tenths) steps.push({ to: { y: y + UNIT_RUN * tenths / 10, tenths, banked }, cost: UNIT_RUN + nudge, label: UNIT_SECTION })
            if (banked) steps.push({ to: { y: y + BANK_LENGTH * tenths / 10, tenths, banked: false }, cost: BANK_LENGTH, label: 'bank-flat' })
            return steps.filter(s => s.to.y >= floor && s.to.y <= ceiling)
        }
    }))
}

/** Keeps above the ground, so the start line stays where it is, unless the road has no other way: digging in just lifts the lot. */
function settle(ground: number, from: Height, settled: (h: Height) => boolean) {
    return settleAbove(ground, from, settled) ?? settleAbove(ground - CLIMB_ROOM, from, settled)
}

interface Move {
    section: SectionId
    x: number
    z: number
    turn: number
    length: number
    cost: number
    /** Points along the move to check for other road, each with how far along it is. */
    samples: { x: number, z: number, along: number }[]
}

/** What a turn costs on top of its length, so the road back doesn't wriggle. */
const BEND_COST = 40
/** Hairpins are for when nothing else fits, not for saving a few metres. */
const HAIRPIN_COST = 100
const SAMPLE_SPACING = 5
const ROUTE_CURVES: Exclude<Curve, 'straight'>[] = ['left-90', 'right-90', 'left-180', 'right-180']
const ROUTE_SIZES: BendSize[] = ['tight', 'medium', 'wide']
/** Open ground a road may swing out over, past everything already laid. */
const ROUTE_MARGIN = 400

/** A map offset from setting off on heading 0, for setting off `k` quarter turns to the right of it. */
function turned(x: number, z: number, k: number) {
    for (let i = 0; i < k; i++) [x, z] = [-z, x]
    return { x, z }
}

/** What a section does on heading 0, walked so its shape has one home: the layout. */
function moveOf(section: SectionId): Move {
    const { pts, end } = walkCustomTrack({ id: 'move', name: '', closed: false, sections: [section] })
    const line = [...pts, [end.x, end.z] as [number, number]]
    const samples: Move['samples'] = []
    let length = 0
    let sampledAt = 0
    for (let i = 1; i < line.length; i++) {
        length += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1])
        if (length - sampledAt < SAMPLE_SPACING && i < line.length - 1) continue
        samples.push({ x: line[i]![0], z: line[i]![1], along: length })
        sampledAt = length
    }
    const turn = Math.round(end.heading * 2 / Math.PI)
    return { section, x: Math.round(end.x), z: Math.round(end.z), turn, length, cost: length + (Math.abs(turn) === 2 ? HAIRPIN_COST : turn ? BEND_COST : 0), samples }
}

const BASE_MOVES = [UNIT_SECTION, ...ROUTE_CURVES.flatMap(c => ROUTE_SIZES.map(s => BENDS[c][s]))].map(moveOf)
const MOVES = [0, 1, 2, 3].map(k => BASE_MOVES.map(m => ({
    ...m,
    ...turned(m.x, m.z, k),
    samples: m.samples.map(p => ({ ...turned(p.x, p.z, k), along: p.along }))
})))

interface Bounds {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
}

/** How fine the map of taken ground is; as fine as the moves are sampled. */
const RASTER_CELL = SAMPLE_SPACING
/** A cell counts as taken if any point in it could be: its centre to its corner. */
const RASTER_SLACK = RASTER_CELL * Math.SQRT1_2

/** Road already laid that new road keeps clear of, except by where the new road sets off and by the spot it heads for. */
interface Laid {
    walk: Pick<LayoutWalk, 'pts' | 'ys' | 'lifts' | 'walls'>
    /** The new road sets off from where this one ends. */
    setsOff: boolean
    /** The point the new road heads for, when it's on this road. */
    target: number | null
}

/** A map spot. */
interface At {
    x: number
    z: number
}

/** Where new road is headed: a point on the grid and the way it faces there. */
interface Goal {
    x: number
    z: number
    k: number
}

/** Map offset of one step along quarter turn `k`: heading 0 runs up the screen, -z. */
const AHEAD = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const

/** Whether new road at height `level` would come too close to the road already laid; a raster, since the search asks millions of times. */
function roadCheck(laid: readonly Laid[], level: number, bounds: Bounds, from: At, goal: Goal) {
    const { apart } = clearanceSpan(ROAD.wallOffset)
    const sameStretch = apart * STEP
    const width = Math.ceil((bounds.maxX - bounds.minX) / RASTER_CELL) + 1
    const height = Math.ceil((bounds.maxZ - bounds.minZ) / RASTER_CELL) + 1
    const taken = new Uint8Array(width * height)
    const nearJoin = new Uint8Array(width * height)
    // The road back is laid at the normal width, whatever the road it passes.
    const reachOf = (wall: number) => clearanceReach(wall, ROAD.wallOffset)
    const paint = (raster: Uint8Array, x: number, z: number, reach: number) => {
        const span = Math.ceil((reach + RASTER_SLACK) / RASTER_CELL)
        const limit = (reach + RASTER_SLACK) ** 2
        const cx = Math.round((x - bounds.minX) / RASTER_CELL)
        const cz = Math.round((z - bounds.minZ) / RASTER_CELL)
        for (let gz = Math.max(0, cz - span); gz <= cz + span && gz < height; gz++) {
            for (let gx = Math.max(0, cx - span); gx <= cx + span && gx < width; gx++) {
                const dx = bounds.minX + gx * RASTER_CELL - x
                const dz = bounds.minZ + gz * RASTER_CELL - z
                if (dx * dx + dz * dz <= limit) raster[gz * width + gx] = 1
            }
        }
    }
    // Road by either end of the new stretch can count as the same road, depending on how far along the new one is.
    const joins: { x: number, z: number, reach: number, fromEnd: number, fromTarget: number, behind: boolean }[] = []
    for (const { walk: { pts, ys, lifts, walls }, setsOff, target } of laid) {
        const n = pts.length
        for (let i = 0; i < n; i++) {
            if (Math.max(0, Math.abs(ys[i]! - level) - lifts[i]!) >= MIN_CLEARANCE) continue
            const [x, z] = pts[i]!
            const reach = reachOf(walls[i]!)
            // On other road, straight-line distance stands in for distance along it: a branch by the start or the goal is the same road there.
            const fromEnd = setsOff ? (n - i) * STEP : Math.hypot(x - from.x, z - from.z)
            const fromTarget = target === null ? Math.hypot(x - goal.x, z - goal.z) : Math.abs(i - target) * STEP
            if (fromEnd < sameStretch || fromTarget < sameStretch) {
                joins.push({ x, z, reach, fromEnd, fromTarget, behind: target !== null && i < target })
                paint(nearJoin, x, z, reach)
            } else {
                paint(taken, x, z, reach)
            }
        }
    }
    const [ax, az] = AHEAD[goal.k]!
    /** `run` is how far along the new road this point is. */
    return (x: number, z: number, run: number) => {
        const cx = Math.round((x - bounds.minX) / RASTER_CELL)
        const cz = Math.round((z - bounds.minZ) / RASTER_CELL)
        if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false
        const cell = cz * width + cx
        if (taken[cell]) return true
        if (!nearJoin[cell]) return false
        // The new road only ever reaches the goal from behind it, so ground ahead of it is a long way round from it.
        const home = (x - goal.x) * ax + (z - goal.z) * az <= 0 ? Math.hypot(x - goal.x, z - goal.z) : Infinity
        return joins.some((j) => {
            if ((j.x - x) * (j.x - x) + (j.z - z) * (j.z - z) >= j.reach ** 2) return false
            // Road behind a join is where the new road curves in alongside it, so only how near the goal both are counts.
            const nearGoal = j.behind ? home < sameStretch : j.fromTarget + home < sameStretch
            return j.fromEnd + run >= sameStretch && !nearGoal
        })
    }
}

interface Spot {
    x: number
    z: number
    k: number
    /** Real metres of new road so far, which the cost isn't; it has the turns' penalties in it. */
    run: number
}

/** A touch greedy: the road back comes out barely longer, and it's found far sooner. */
const ROUTE_HASTE = 1.3

/** Level road on the grid from where `walk` ends to `runIn` metres behind `goal`, heading its way, clear of `laid`. */
function routeTo(walk: LayoutWalk, laid: readonly Laid[], goal: Goal, runIn: number, budget?: { left: number }) {
    const { end } = walk
    const x = Math.round(end.x / GRID) * GRID
    const z = Math.round(end.z / GRID) * GRID
    if (Math.abs(x - end.x) > 0.01 || Math.abs(z - end.z) > 0.01) return null
    const k = ((Math.round(end.heading * 2 / Math.PI) % 4) + 4) % 4
    const [ax, az] = AHEAD[goal.k]!
    const px = goal.x - ax * runIn
    const pz = goal.z - az * runIn
    const xs = [goal.x, px, ...laid.flatMap(l => l.walk.pts.map(p => p[0]))]
    const zs = [goal.z, pz, ...laid.flatMap(l => l.walk.pts.map(p => p[1]))]
    const bounds = {
        minX: Math.min(...xs) - ROUTE_MARGIN,
        maxX: Math.max(...xs) + ROUTE_MARGIN,
        minZ: Math.min(...zs) - ROUTE_MARGIN,
        maxZ: Math.max(...zs) + ROUTE_MARGIN
    }
    const blocked = roadCheck(laid, end.y, bounds, end, goal)
    return found(cheapestPath<Spot, SectionId>({ x, z, k, run: 0 }, {
        limit: SEARCH_LIMIT,
        budget,
        // Offset to keep it positive; a course never reaches 20 km out.
        key: s => ((s.x / GRID + 2000) * 4000 + s.z / GRID + 2000) * 4 + s.k,
        done: s => s.x === px && s.z === pz && s.k === goal.k,
        estimate: s => Math.hypot(s.x - px, s.z - pz) * ROUTE_HASTE,
        steps(s) {
            const steps: Step<Spot>[] = []
            for (const m of MOVES[s.k]!) {
                const nx = s.x + m.x
                const nz = s.z + m.z
                if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ) continue
                if (m.samples.some(p => blocked(s.x + p.x, s.z + p.z, s.run + p.along))) continue
                steps.push({ to: { x: nx, z: nz, k: (s.k + m.turn + 4) % 4, run: s.run + m.length }, cost: m.cost, label: m.section })
            }
            return steps
        }
    }))
}

const LONGEST_FIRST = [...STRAIGHT_LENGTHS].reverse()

/** Runs of short straights as the fewest longer ones, which saves on the section limit. */
function compact(sections: SectionId[]) {
    const out: SectionId[] = []
    let run = 0
    const flush = () => {
        for (const length of LONGEST_FIRST) {
            while (run >= length) {
                out.push(STRAIGHTS[length])
                run -= length
            }
        }
    }
    for (const id of sections) {
        if (id === UNIT_SECTION) {
            run += UNIT_RUN
        } else {
            flush()
            out.push(id)
        }
    }
    flush()
    return out
}

/** A level road leaving a diagonal comes back onto the grid through a bend, either way round. */
const OFF_DIAGONAL = [[BENDS['left-45'].tight], [BENDS['right-45'].tight]]

const atStart = (h: Height) => h.y === 0 && h.tenths === 0 && !h.banked
const isLevel = (h: Height) => h.tenths === 0 && !h.banked

/** Where a walk's road ends, in the terms `settle` works in. */
const heightAtEnd = ({ end }: LayoutWalk): Height => ({ y: Math.round(end.aboveStart), tenths: Math.round(end.grade * 10), banked: Math.abs(end.bank) > 1e-6 })

/** The ways of getting to the start's height: straight away and drive home at it, or stay where it is and change height on the last run into the line. */
function descents(t: CustomTrack) {
    const walk = walkCustomTrack(t)
    const from = heightAtEnd(walk)
    const plans: { before: Found, after: Found }[] = []
    const now = settle(-walk.rise, from, atStart)
    if (now) plans.push({ before: now, after: { sections: [], cost: 0 } })
    const levelled = settle(-walk.rise, from, isLevel)
    if (levelled) {
        const flat = walkCustomTrack({ ...t, sections: [...t.sections, ...levelled.sections] })
        const last = settle(-flat.rise, heightAtEnd(flat), atStart)
        if (last?.sections.length) plans.push({ before: levelled, after: last })
    }
    return plans
}

/** When the road can't go straight on from where it ends, a bend first often clears it. */
const LEAD_INS: SectionId[][] = [[], ...ROUTE_CURVES.map(c => [BENDS[c].tight])]
/** A dead end is the slowest thing to search, so a click only gets so many tries. */
const MAX_ROUTE_SEARCHES = 12
/** A join has several spots to come onto its diagonal from, each its own search. */
const MAX_JOIN_SEARCHES = 24
/** States a join's searches open between them: room for a few dead ends before one that gets there. */
const JOIN_SEARCH_BUDGET = 55_000

/** A forked course's branches, as road the main road's way home keeps clear of, on the main road's ground. */
function branchRoads(t: CustomTrack, main: LayoutWalk): Laid[] {
    if (!t.branches?.length) return []
    const lines = walkCustomLines(t)
    const by = main.rise - lines[0]!.rise
    return lines.slice(1).map(w => ({ walk: mapWalkHeights(w, y => y + by), setsOff: false, target: null }))
}

const HOME: Goal = { x: 0, z: 0, k: 0 }

/** The shortest finish after `lead`, counting off the route searches it uses from `searches`. */
function finishAfter(t: CustomTrack, lead: SectionId[], searches: { left: number }) {
    const led = { ...t, sections: [...t.sections, ...lead] }
    let best: { sections: SectionId[], metres: number } | null = null
    let tooMany = false
    for (const { before, after } of descents(led)) {
        const settled = [...led.sections, ...before.sections]
        const turns = onAxis(walkCustomTrack({ ...t, sections: settled }).end.heading) ? [[]] : OFF_DIAGONAL
        for (const turn of turns) {
            if (searches.left-- <= 0) break
            const walk = walkCustomTrack({ ...t, sections: [...settled, ...turn] })
            const route = routeTo(walk, [{ walk, setsOff: true, target: 0 }, ...branchRoads(t, walk)], HOME, after.cost)
            if (!route) continue
            const sections = compact([...lead, ...before.sections, ...turn, ...route.sections, ...after.sections])
            if (sectionCount(t) + sections.length > MAX_SECTIONS) {
                tooMany = true
                continue
            }
            // The main road on its own: a branch still open mustn't hold up the loop.
            const { def } = compileMainRoad({ ...t, sections: [...t.sections, ...sections] })
            if (!def) continue
            const metres = new Track(def).length
            if (!best || metres < best.metres) best = { sections, metres }
            // The first way off a diagonal that works is good enough.
            break
        }
    }
    return { best, tooMany }
}

/** The sections to lay after the last one so that a loop closes, or why there are none: what's already wrong with the road, or no way back round it. */
export function finishLoop(t: CustomTrack): FinishedLoop {
    const walk = walkCustomTrack(t)
    const fault = layoutFault(walk, true) ?? clearanceFault(walk, true)
    if (fault) return { sections: null, error: fault }
    const searches = { left: MAX_ROUTE_SEARCHES }
    let tooMany = false
    // A jump in the air lands first, then the road goes back to the start's width, which the loop closes at.
    const rewiden: SectionId[] = [...walk.end.air ? ['landing-ramp' as const] : [], ...walk.end.halfWidth === ROAD.halfWidth ? [] : ['width-normal' as const]]
    for (const lead of LEAD_INS) {
        const tried = finishAfter(t, [...rewiden, ...lead], searches)
        if (tried.best) return { sections: tried.best.sections, error: null }
        tooMany ||= tried.tooMany
    }
    return { sections: null, error: tooMany ? 'that takes more sections than a track can have' : 'there\'s no way back round the road from here' }
}

/** Line `line` of `t` with `sections` laid on its end. */
function extended(t: CustomTrack, line: number, sections: readonly SectionId[]): CustomTrack {
    return { ...t, branches: t.branches!.map((b, i) => i === line - 1 ? { ...b, sections: [...b.sections, ...sections] } : b) }
}

/** The eighths a route can end on to come onto a join's diagonal, with which way they turn and how wide. */
const ONTO_DIAGONAL = (['left-45', 'right-45'] as const).flatMap(c => Object.values(BENDS[c]).flatMap((id) => {
    const piece = SECTIONS[id].piece
    return piece.type === 'corner' ? [{ id: id as SectionId | null, side: c === 'left-45' ? -1 : 1, radius: piece.radius }] : []
}))
/** How far round a join a route may come onto its way in, and how many spots on each way to try. */
const APPROACH_REACH = 200
const APPROACH_TRIES = 3

/** A spot a route heads for and the eighth, if any, that takes it from there onto the road into a join. */
interface Approach {
    goal: Goal
    last: SectionId | null
}

/**
 * Grid spots heading along the grid from which road bends into `inlet`'s join, the shortest way from `start` first:
 * straight on when it comes in along the grid, else through an eighth onto its diagonal.
 */
function approaches(inlet: JoinInlet, start: At): Approach[] {
    const { x, z, heading } = inlet
    const right = [Math.cos(heading), Math.sin(heading)] as const
    const leads = onAxis(heading) ? [{ id: null, side: 0, radius: 0 }] : ONTO_DIAGONAL
    const found: (Approach & { metres: number })[] = []
    for (const { id, side, radius } of leads) {
        const from = heading - side * Math.PI / 4
        const quarter = Math.round(from * 2 / Math.PI)
        if (Math.abs(from - quarter * Math.PI / 2) > 1e-6) continue
        // Where the eighth comes out, from where it starts: radius * side * (right(from) - right(heading)).
        const ox = radius * side * (Math.cos(from) - right[0])
        const oz = radius * side * (Math.sin(from) - right[1])
        const spots: (Approach & { metres: number })[] = []
        for (let gx = Math.round((x - APPROACH_REACH) / GRID) * GRID; gx <= x + APPROACH_REACH; gx += GRID) {
            for (let gz = Math.round((z - APPROACH_REACH) / GRID) * GRID; gz <= z + APPROACH_REACH; gz += GRID) {
                const merge = mergeFrom({ x: gx + ox, z: gz + oz, heading }, inlet)
                // As the crow flies to the spot, then the run in: a guess at the road it takes.
                if (merge) spots.push({ goal: { x: gx, z: gz, k: ((quarter % 4) + 4) % 4 }, last: id, metres: Math.hypot(gx - start.x, gz - start.z) + merge.runIn })
            }
        }
        found.push(...spots.sort((a, b) => a.metres - b.metres).slice(0, APPROACH_TRIES))
    }
    return found.sort((a, b) => a.metres - b.metres)
}

/** Whether branch `line` comes into its join clear of other road: across the whole course once every branch fits, else on its own. */
function joinsClear(t: CustomTrack, line: number, closes: boolean) {
    const forks = walkForks(t)
    if (!forks.merged[line - 1]) return false
    // The route is checked as it's searched, but not the eighth onto the diagonal and the run in after it.
    const draft = draftForkedDef(t, forks, closes)
    return !(draft ? trackClearanceFault(new Track(draft.def)) : clearanceFault(forks.walks[line]!, false))
}

/** The sections to lay on the end of branch `line` so it comes into its join, or why there are none. */
export function finishJoin(t: CustomTrack, line: number): FinishedLoop {
    const branch = t.branches?.[line - 1]
    if (!branch?.to) return { sections: null, error: 'pick a join first' }
    const to = branch.to
    const { walks: lines, joins } = walkForks(t)
    const walk = lines[line]!
    if (walk.misplaced) return { sections: null, error: walk.misplaced }
    const inlet = joins.find(j => j.branch === line)
    if (!inlet) return { sections: null, error: 'no way into that join from here' }
    // Heights as the main road's start has them, which every line shares.
    const ground = -lines[0]!.rise
    const goalY = Math.round(inlet.y + ground)
    const heightOf = (w: LayoutWalk): Height => ({ y: Math.round(w.end.y - w.end.lift + ground), tenths: Math.round(w.end.grade * 10), banked: Math.abs(w.end.bank) > 1e-6 })
    const arrived = (h: Height) => h.y === goalY && isLevel(h)
    const rewiden: SectionId[] = [...walk.end.air ? ['landing-ramp' as const] : [], ...walk.end.halfWidth === ROAD.halfWidth ? [] : ['width-normal' as const]]
    let searches = MAX_JOIN_SEARCHES
    const budget = { left: JOIN_SEARCH_BUDGET }
    const closes = t.closed !== false && !!compileMainRoad(t).def
    let tooMany = false
    for (const lead of LEAD_INS) {
        if (searches <= 0 || budget.left <= 0) break
        const led = [...rewiden, ...lead]
        const levelled = settle(ground, heightOf(walkCustomLines(extended(t, line, led))[line]!), arrived)
        if (!levelled) continue
        const settled = [...led, ...levelled.sections]
        const turns = onAxis(walkCustomLines(extended(t, line, settled))[line]!.end.heading) ? [[]] : OFF_DIAGONAL
        for (const turn of turns) {
            const laidOut = walkCustomLines(extended(t, line, [...settled, ...turn]))
            const laid = laidOut.map((w, l): Laid => ({ walk: w, setsOff: l === line, target: l === to.branch ? inlet.point : null }))
            for (const { goal, last } of approaches(inlet, laidOut[line]!.end)) {
                if (searches-- <= 0 || budget.left <= 0) break
                const route = routeTo(laidOut[line]!, laid, goal, 0, budget)
                if (!route) continue
                const sections = compact([...settled, ...turn, ...route.sections, ...last ? [last] : []])
                if (sectionCount(t) + sections.length > MAX_SECTIONS) {
                    tooMany = true
                    continue
                }
                if (joinsClear(extended(t, line, sections), line, closes)) return { sections, error: null }
            }
        }
    }
    return { sections: null, error: tooMany ? 'that takes more sections than a track can have' : 'no way into that join from here' }
}
