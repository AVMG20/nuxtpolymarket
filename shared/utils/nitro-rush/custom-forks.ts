import { inletOf, joinInlet, joinMerge, meetInlet, splitArm, type Inlet } from './fork-pieces'
import { draftTrackDef } from './custom-draft'
import { customLayout, fieldArrivals, flippedId, forkMerges, forkShape, isFieldSection, lineSections, sectionWalk, shapeAt, walkedField, type CustomBranch, type CustomTrack, type SectionId, type SectionSpot } from './custom'
import { draftFieldDefs, fieldApproach } from './field-layout'
import { FORK_RADIUS, mapWalkHeights, walkLayout, walkLines, type ForkShape, type LayoutWalk, type Pose, type RoadState } from './layout'
import { Track, TrackGraphError, TrackLine, type BranchDef, type TrackDef } from './track'
import { ROAD } from './tracks'

/** A forked course's lines in the builder: walked with every split's arm and every join's bend in, and edited with each split and join kept to its branch. */

/** How much of the diagonal a join comes in on the map and a card show before its bend. */
const STUB_LEAD = 30

/** A join section and where a road coming into it has to arrive. */
export interface JoinInlet extends Inlet {
    spot: SectionSpot
    /** The branch coming into it, or null when none does yet. */
    branch: number | null
}

/** Every line walked, and every join with its inlet. */
export interface ForkedLines {
    /** Main road first, then each branch; a branch's walk starts with its split's arm and, once it comes into its join, ends with the bend onto it. */
    walks: LayoutWalk[]
    joins: JoinInlet[]
    /** Per branch, whether it comes into its join or field. */
    merged: boolean[]
}

const sameSpot = (a: SectionSpot, b: SectionSpot) => a.branch === b.branch && a.at === b.at

/** A walk's piece entries cut to its `count` sections, dropping a split's arm before them and a join's bend in after; their points stay. */
function sectionsOnly(w: LayoutWalk, arm: boolean, count: number): LayoutWalk {
    const from = arm ? 1 : 0
    return { ...w, pieceStarts: w.pieceStarts.slice(from, from + count), states: w.states.slice(from, from + count) }
}

/** Every join section's inlet, off walks cut to their sections. */
function inletsOf(t: CustomTrack, walks: readonly LayoutWalk[]): JoinInlet[] {
    const out: JoinInlet[] = []
    walks.forEach((w, line) => lineSections(t, line).forEach((id, at) => {
        const shape = forkShape(id, 'join')
        const inlet = shape && inletOf(w, at, shape)
        if (!inlet) return
        const spot = { branch: line, at }
        const branch = t.branches?.findIndex(b => b.to && sameSpot(b.to, spot)) ?? -1
        out.push({ ...inlet, spot, branch: branch >= 0 ? branch + 1 : null })
    }))
    return out
}

/** Every line laid from where it leaves its road, main road first, on one ground, with each branch on its join's diagonal bending in onto it, or driving into its field. */
export function walkForks(t: CustomTrack): ForkedLines {
    const branches = t.branches ?? []
    const merges = forkMerges(t)
    const arrivals = fieldArrivals(t)
    const merged = merges.map((m, i) => m !== null || arrivals[i] !== null)
    const walks = walkLines(customLayout(t, merges, arrivals)).map((w, l) => l ? sectionsOnly(w, !!shapeAt(t, branches[l - 1]!.from, 'split') || !!branches[l - 1]!.from.port, branches[l - 1]!.sections.length) : w)
    return { walks, joins: inletsOf(t, walks), merged }
}

/** Every line laid from where it leaves its road, main road first, on one ground. */
export const walkCustomLines = (t: CustomTrack) => walkForks(t).walks

/** How a branch ends: in its join, short of it or not lined up with it, at a finish line of its own, or nowhere yet. */
export type BranchEnding =
    | { kind: 'joins', to: SectionSpot }
    | { kind: 'short', to: SectionSpot, metres: number }
    | { kind: 'askew', to: SectionSpot, why: string }
    | { kind: 'finish' }
    | { kind: 'open' }

/** How branch `line` ends. */
export function branchEnding(t: CustomTrack, forks: ForkedLines, line: number): BranchEnding {
    const branch = t.branches![line - 1]!
    if (!branch.to) return branch.sections.includes('finish') ? { kind: 'finish' } : { kind: 'open' }
    if (isFieldSection(t, branch.to)) {
        if (forks.merged[line - 1]) return { kind: 'joins', to: branch.to }
        const placement = walkedField(forks.walks, branch.to)?.placement
        const approach = placement ? fieldApproach(forks.walks[line]!.end, placement) : null
        return { kind: 'askew', to: branch.to, why: approach && 'why' in approach ? approach.why : 'doesn\'t reach the field' }
    }
    const inlet = forks.joins.find(j => j.branch === line)
    if (forks.merged[line - 1] || !inlet) return { kind: 'joins', to: branch.to }
    const miss = meetInlet(forks.walks[line]!.end, inlet)
    if (miss.runIn !== null) return { kind: 'joins', to: branch.to }
    return miss.why ? { kind: 'askew', to: branch.to, why: miss.why } : { kind: 'short', to: branch.to, metres: miss.metres }
}

/** The diagonal a road comes into a join on and its bend in, from `inlet`, as a walk. */
function inletWalk(shape: ForkShape, inlet: Pose, from: Partial<RoadState> = {}) {
    const origin = { x: inlet.x - Math.sin(inlet.heading) * STUB_LEAD, z: inlet.z + Math.cos(inlet.heading) * STUB_LEAD, heading: inlet.heading }
    return walkLayout({ id: 'inlet', name: '', group: 'sprints', ...ROAD, origin, pieces: joinMerge(shape, { runIn: STUB_LEAD, radius: FORK_RADIUS }) }, from)
}

/** The way a road comes into a join as road of its own, as high and wide as the join, ending where it ends. */
export function inletRoad(inlet: Inlet): LayoutWalk {
    return mapWalkHeights(inletWalk(inlet.shape, inlet, { halfWidth: inlet.halfWidth }), y => y + inlet.y)
}

/** The way a road comes into a join, as points on the map. */
export function inletStub(inlet: JoinInlet): [number, number][] {
    const w = inletWalk(inlet.shape, inlet)
    return [...w.pts, [w.end.x, w.end.z]]
}

/** The joins no branch has come into yet, which a branch still has to get onto; `ended` is per line. */
export const openInlets = (joins: readonly JoinInlet[], ended: readonly boolean[]) => joins.filter(j => j.branch === null || !ended[j.branch])

/** A split's second arm, or the road coming into a join, as it lies beside the section laid on its own; null for any other section. */
export function sectionPartner(id: SectionId): LayoutWalk | null {
    const split = forkShape(id, 'split')
    const join = forkShape(id, 'join')
    if (split) return walkLayout({ id: 'arm', name: '', group: 'sprints', ...ROAD, origin: { x: 0, z: 0, heading: 0 }, pieces: [splitArm(split)] })
    if (!join) return null
    const { end } = sectionWalk(id)
    return inletWalk(join, joinInlet(join, end))
}

/** `t` with line `line`'s sections swapped for `sections`. */
export function withLineSections(t: CustomTrack, line: number, sections: SectionId[]): CustomTrack {
    if (!line) return { ...t, sections }
    return { ...t, branches: t.branches!.map((b, i) => i === line - 1 ? { ...b, sections } : b) }
}

/** Every spot in `t` moved by `move`, which gets each spot and gives back where it goes; a port stays with its field. */
function moveSpots(t: CustomTrack, move: (s: SectionSpot) => SectionSpot): CustomTrack {
    if (!t.branches?.length && !t.fields?.length) return t
    const out = { ...t }
    if (t.branches?.length) out.branches = t.branches.map(b => ({ ...b, from: { ...b.from, ...move(b.from) }, to: b.to && move(b.to) }))
    // Kept in course order, as storage and the road key have them.
    if (t.fields?.length) out.fields = t.fields.map(f => ({ ...f, at: move(f.at) })).sort((a, b) => a.at.branch - b.at.branch || a.at.at - b.at.at)
    return out
}

/** Puts `id` in at `index` on line `line`; a split brings its arm, as a new empty branch that's the last line. */
export function insertSection(t: CustomTrack, line: number, index: number, id: SectionId): CustomTrack {
    const sections = [...lineSections(t, line)]
    sections.splice(index, 0, id)
    const next = moveSpots(withLineSections(t, line, sections), s => s.branch === line && s.at >= index ? { ...s, at: s.at + 1 } : s)
    if (!forkShape(id, 'split')) return next
    return { ...next, branches: [...next.branches ?? [], { sections: [], from: { branch: line, at: index }, to: null }] }
}

/** Section `index` on line `line` swapped for its mirror image, its branches kept; `t` itself when it has none. */
export function flipSection(t: CustomTrack, line: number, index: number): CustomTrack {
    const flipped = flippedId(lineSections(t, line)[index])
    return flipped ? withLineSections(t, line, lineSections(t, line).map((id, k) => k === index ? flipped : id)) : t
}

/** `t` without lines `gone` (never the main road), the others renumbered; a branch heading into a join on one of them is left open. */
function withoutLines(t: CustomTrack, gone: ReadonlySet<number>): CustomTrack {
    const branches = t.branches ?? []
    const renumber: number[] = []
    let next = 0
    for (let l = 0; l <= branches.length; l++) renumber.push(gone.has(l) ? -1 : next++)
    const kept = branches.flatMap((b, i): CustomBranch[] => {
        if (gone.has(i + 1)) return []
        const to = b.to && !gone.has(b.to.branch) ? { ...b.to, branch: renumber[b.to.branch]! } : null
        return [{ ...b, from: { ...b.from, branch: renumber[b.from.branch]! }, to }]
    })
    const out: CustomTrack = { ...t, branches: kept }
    if (!kept.length) delete out.branches
    if (t.fields) out.fields = t.fields.flatMap(f => gone.has(f.at.branch) ? [] : [{ ...f, at: { ...f.at, branch: renumber[f.at.branch]! } }])
    if (!out.fields?.length) delete out.fields
    return out
}

/** Branch `line` with every branch that splits off it, however far down. */
function lineAndOffshoots(t: CustomTrack, line: number) {
    const gone = new Set([line])
    // Branches only split off earlier lines, so one pass finds every branch of a branch.
    t.branches?.forEach((b, i) => {
        if (gone.has(b.from.branch)) gone.add(i + 1)
    })
    return gone
}

/** Takes section `index` off line `line`: a split or field takes its branches with it, and a join or field leaves the branches coming into it open. */
export function removeSection(t: CustomTrack, line: number, index: number): CustomTrack {
    const gone = new Set<number>()
    t.branches?.forEach((b, i) => {
        if (b.from.branch === line && b.from.at === index) for (const l of lineAndOffshoots(t, i + 1)) gone.add(l)
    })
    // Only later lines go, so `line` keeps its number.
    let next = gone.size ? withoutLines(t, gone) : t
    next = { ...next, branches: next.branches?.map(b => b.to && b.to.branch === line && b.to.at === index ? { ...b, to: null } : b) }
    if (!next.branches) delete next.branches
    if (next.fields) next.fields = next.fields.filter(f => f.at.branch !== line || f.at.at !== index)
    if (!next.fields?.length) delete next.fields
    const sections = lineSections(next, line).filter((_, k) => k !== index)
    return moveSpots(withLineSections(next, line, sections), s => s.branch === line && s.at > index ? { ...s, at: s.at - 1 } : s)
}

/** Takes the section at `from` on line `line` out and puts it back in at `to`, counted after it's out; splits and joins keep their branches. */
export function moveSection(t: CustomTrack, line: number, from: number, to: number): CustomTrack {
    const order = lineSections(t, line).map((_, k) => k)
    order.splice(to, 0, ...order.splice(from, 1))
    const where = new Map(order.map((k, i) => [k, i]))
    const sections = order.map(k => lineSections(t, line)[k]!)
    return moveSpots(withLineSections(t, line, sections), s => s.branch === line ? { ...s, at: where.get(s.at)! } : s)
}

/** Takes branch `line` away, with its split and every branch off it. */
export function removeBranch(t: CustomTrack, line: number): CustomTrack {
    const from = t.branches?.[line - 1]?.from
    return from ? removeSection(t, from.branch, from.at) : t
}

/** Branch `line` heading into the join at `to`, or, with null, left open. */
export function setJoin(t: CustomTrack, line: number, to: SectionSpot | null): CustomTrack {
    return { ...t, branches: t.branches!.map((b, i) => i === line - 1 ? { ...b, to } : b) }
}

/** Whether any route through `t` comes back round to where it's been: a join it reaches before the split that led to it. */
function loopsBack(t: CustomTrack): boolean {
    const branches = t.branches ?? []
    const start = t.closed ? t.sections.indexOf('start') : -1
    // A loop's lap runs from its start line, so its main road is read in that order.
    const order = (s: SectionSpot) => s.branch === 0 && start >= 0 ? (s.at - start + t.sections.length) % t.sections.length : s.at
    const key = (s: SectionSpot) => `${s.branch}:${s.at}`
    const next = new Map<string, string[]>()
    const link = (a: string, b: string) => next.set(a, [...next.get(a) ?? [], b])
    for (let line = 0; line <= branches.length; line++) {
        const spots = branches.flatMap(b => [b.from, ...b.to ? [b.to] : []]).filter(s => s.branch === line).sort((a, b) => order(a) - order(b))
        // A field holds many roads at one spot, which is still one stop.
        const stops = [`${line}:head`, ...new Set(spots.map(key)), `${line}:tail`]
        for (let k = 1; k < stops.length; k++) link(stops[k - 1]!, stops[k]!)
    }
    branches.forEach((b, i) => {
        link(key(b.from), `${i + 1}:head`)
        if (b.to) link(`${i + 1}:tail`, key(b.to))
    })
    // Depth first: a stop met again while it's still being followed closes a loop.
    const state = new Map<string, 'open' | 'done'>()
    const visit = (v: string): boolean => {
        if (state.get(v) === 'done') return false
        if (state.get(v) === 'open') return true
        state.set(v, 'open')
        const loops = (next.get(v) ?? []).some(visit)
        state.set(v, 'done')
        return loops
    }
    return [...next.keys()].some(visit)
}

/** Whether branch `line` may head into the join or field at `spot`: no finish of its own, not its own line or offshoot, nor the field it leaves, and no loop back. */
export function canJoin(t: CustomTrack, line: number, spot: SectionSpot): boolean {
    const branch = t.branches?.[line - 1]
    if (!branch || branch.sections.includes('finish') || lineAndOffshoots(t, line).has(spot.branch)) return false
    const field = isFieldSection(t, spot)
    if (field && sameSpot(branch.from, spot)) return false
    // Whichever branch comes into a join now gives it up; a field takes them all.
    const freed = field ? t : { ...t, branches: t.branches!.map(b => b.to && sameSpot(b.to, spot) ? { ...b, to: null } : b) }
    return !loopsBack(setJoin(freed, line, spot))
}

/** The open branches that could head into the join at `spot`. */
export function joinCandidates(t: CustomTrack, spot: SectionSpot): number[] {
    return (t.branches ?? []).flatMap((b, i) => !b.to && canJoin(t, i + 1, spot) ? [i + 1] : [])
}

/** A loop's draft turned to begin at walk point `shift`, its ranges moved with it. */
function turnedTo(def: TrackDef, shift: number): TrackDef {
    if (!shift) return def
    const n = def.points.length
    const turn = <T>(a: T[]) => [...a.slice(shift), ...a.slice(0, shift)]
    const move = turnRange(shift, n)
    const out: TrackDef = { ...def, points: turn(def.points) }
    if (def.heights) out.heights = turn(def.heights)
    if (def.halfWidths) out.halfWidths = turn(def.halfWidths)
    if (def.ups) out.ups = turn(def.ups)
    if (def.rails) out.rails = def.rails.map(move)
    if (def.gaps) out.gaps = def.gaps.map(move)
    if (def.boosts) out.boosts = def.boosts.map(b => ({ ...b, range: move(b.range) }))
    return out
}

/** A range of a loop's `n` walk points, moved for the loop beginning at point `shift`. */
function turnRange(shift: number, n: number) {
    // No range holds the start line's section, where it's cut, so none wraps the seam.
    return ([a, b]: [number, number]): [number, number] => [(a - shift + n) % n, (a - shift + n) % n + b - a]
}

/** A forked draft to draw, and the walk point of the main road its main line begins at. */
export interface ForkedDraft {
    def: TrackDef
    shift: number
}

/** The draft as one forked course to draw, its splits and joins opened up; null when it has no branches or they don't fit together yet. */
export function draftForkedDef(t: CustomTrack, forks: ForkedLines, closes: boolean): ForkedDraft | null {
    const branches = t.branches ?? []
    const { walks } = forks
    if (!branches.length || branches.some((b, i) => !b.sections.length || (b.to && !forks.merged[i]))) return null
    // The graph cuts a loop where its main line begins, so that has to be the start line, as a compiled loop has it.
    const shift = closes ? walks[0]!.pieceStarts[t.sections.indexOf('start')] ?? 0 : 0
    const main = draftTrackDef(walks[0]!, closes, false)
    const defs = walks.map((w, l) => l ? draftTrackDef(w, false, false) : main && turnedTo(main, shift))
    if (!defs.every(d => d !== null)) return null
    const cums = defs.map(d => new TrackLine(d).cum)
    const pointS = (branch: number, k: number) => {
        const cum = cums[branch]!
        const n = walks[branch]!.pts.length
        return branch === 0 && closes ? cum[(k - shift + n) % n]! : cum[Math.min(k, cum.length - 1)]!
    }
    // A split forks where its section starts; a join meets where its section ends; a field's roads meet at its hub.
    const sAt = (branch: number, at: number) => ({ branch, at: pointS(branch, walks[branch]!.pieceStarts[at] ?? walks[branch]!.pts.length) })
    const hubAt = (spot: SectionSpot) => {
        const field = walkedField(walks, spot)
        return field && { branch: spot.branch, at: pointS(spot.branch, field.hub) }
    }
    const ends = branches.map(b => ({
        from: b.from.port ? hubAt(b.from) : sAt(b.from.branch, b.from.at),
        to: !b.to ? 'finish' as const : isFieldSection(t, b.to) ? hubAt(b.to) : sAt(b.to.branch, b.to.at + 1)
    }))
    if (ends.some(e => !e.from || !e.to)) return null
    const { defs: fields, ids } = draftFieldDefs(walks, (l, k) => ({ branch: l, s: pointS(l, k) }))
    const onFields = (l: number) => {
        const w = walks[l]!
        const move = l === 0 && closes ? turnRange(shift, w.pts.length) : (r: [number, number]) => r
        return w.fields.map(f => ({ range: move([f.from, f.to]), field: ids.get(f.id) ?? -1 }))
    }
    const def: TrackDef = {
        ...defs[0]!,
        branches: branches.map((_, i): BranchDef => {
            const { points, heights, halfWidths, ups, rails, gaps, boosts } = defs[i + 1]!
            return { points, heights, halfWidths, ups, rails, gaps, boosts, onFields: onFields(i + 1), from: ends[i]!.from!, to: ends[i]!.to! }
        })
    }
    if (fields.length) {
        def.onFields = onFields(0)
        def.fields = fields
    }
    try {
        // Built here only to see that the graph holds; the caller lays its own.
        void new Track(def)
        return { def, shift }
    } catch (e) {
        if (e instanceof TrackGraphError) return null
        throw e
    }
}
