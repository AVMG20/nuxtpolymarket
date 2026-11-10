import { cheapestPath, type PathStep } from './cheapest-path'
import { BENDS, SLOPE_STEPS, STRAIGHTS, STRAIGHT_LENGTHS, targetOf, type BendSize, type Curve } from './construct'
import { compileCustomTrack, MAX_SECTIONS, walkCustomTrack, type CustomTrack, type SectionId } from './custom'
import { BANK_LENGTH, GRID, onAxis, SLOPE_LENGTH, type LayoutWalk } from './layout'
import { clearanceFault, clearanceReach, clearanceSpan, layoutFault, MIN_CLEARANCE, STEP } from './road-checks'
import { Track } from './track'
import { ROAD } from './tracks'

/** Finishing a loop: the sections that take an open road, from wherever it ends, back to its start line. */

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

/** Whether new road at height `level` would come too close to the road already laid; a raster, since the search asks millions of times. */
function roadCheck({ pts, ys, lifts, walls }: LayoutWalk, level: number, bounds: Bounds) {
    const { apart } = clearanceSpan(ROAD.wallOffset)
    const sameStretch = apart * STEP
    const n = pts.length
    const width = Math.ceil((bounds.maxX - bounds.minX) / RASTER_CELL) + 1
    const height = Math.ceil((bounds.maxZ - bounds.minZ) / RASTER_CELL) + 1
    const taken = new Uint8Array(width * height)
    const nearJoin = new Uint8Array(width * height)
    // The road back is laid at the normal width, whatever the road it passes.
    const reachOf = (i: number) => clearanceReach(walls[i]!, ROAD.wallOffset)
    const paint = (raster: Uint8Array, i: number) => {
        const [x, z] = pts[i]!
        const span = Math.ceil((reachOf(i) + RASTER_SLACK) / RASTER_CELL)
        const limit = (reachOf(i) + RASTER_SLACK) ** 2
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
    const joins: number[] = []
    for (let i = 0; i < n; i++) {
        if (Math.max(0, Math.abs(ys[i]! - level) - lifts[i]!) >= MIN_CLEARANCE) continue
        if ((n - i) * STEP < sameStretch || i * STEP < sameStretch) {
            joins.push(i)
            paint(nearJoin, i)
        } else {
            paint(taken, i)
        }
    }
    /** `run` is how far along the new road this point is. */
    return (x: number, z: number, run: number) => {
        const cx = Math.round((x - bounds.minX) / RASTER_CELL)
        const cz = Math.round((z - bounds.minZ) / RASTER_CELL)
        if (cx < 0 || cz < 0 || cx >= width || cz >= height) return false
        const cell = cz * width + cx
        if (taken[cell]) return true
        if (!nearJoin[cell]) return false
        // The new road only ever reaches the line from behind it, so ground ahead of the line is a long way round from it.
        const home = z >= 0 ? Math.hypot(x, z) : Infinity
        return joins.some((i) => {
            const [px, pz] = pts[i]!
            if ((px - x) * (px - x) + (pz - z) * (pz - z) >= reachOf(i) ** 2) return false
            return (n - i) * STEP + run >= sameStretch && i * STEP + home >= sameStretch
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

/** Level road on the grid from where `walk` ends to `runIn` metres behind the start line, heading for it. */
function routeHome(walk: LayoutWalk, runIn: number) {
    const { end, pts } = walk
    const x = Math.round(end.x / GRID) * GRID
    const z = Math.round(end.z / GRID) * GRID
    if (Math.abs(x - end.x) > 0.01 || Math.abs(z - end.z) > 0.01) return null
    const k = ((Math.round(end.heading * 2 / Math.PI) % 4) + 4) % 4
    const xs = pts.map(p => p[0])
    const zs = pts.map(p => p[1])
    const bounds = {
        minX: Math.min(0, ...xs) - ROUTE_MARGIN,
        maxX: Math.max(0, ...xs) + ROUTE_MARGIN,
        minZ: Math.min(0, ...zs) - ROUTE_MARGIN,
        maxZ: Math.max(runIn, ...zs) + ROUTE_MARGIN
    }
    const blocked = roadCheck(walk, end.y, bounds)
    return found(cheapestPath<Spot, SectionId>({ x, z, k, run: 0 }, {
        limit: SEARCH_LIMIT,
        // Offset to keep it positive; a course never reaches 20 km out.
        key: s => ((s.x / GRID + 2000) * 4000 + s.z / GRID + 2000) * 4 + s.k,
        done: s => s.x === 0 && s.z === runIn && s.k === 0,
        estimate: s => Math.hypot(s.x, s.z - runIn) * ROUTE_HASTE,
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
            const route = routeHome(walkCustomTrack({ ...t, sections: [...settled, ...turn] }), after.cost)
            if (!route) continue
            const sections = compact([...lead, ...before.sections, ...turn, ...route.sections, ...after.sections])
            if (t.sections.length + sections.length > MAX_SECTIONS) {
                tooMany = true
                continue
            }
            const { def } = compileCustomTrack({ ...t, sections: [...t.sections, ...sections] })
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
