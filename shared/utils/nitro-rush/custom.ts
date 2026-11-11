import { inletOf, joinMerge, meetInlet, splitArm, type InletMeet, type Merge } from './fork-pieces'
import { bankTo, boostPad, buildTrack, checkpoint, corkscrew, corner, finish, gap, jump, kicker, landing, looping, MAX_HALF_WIDTH, MIN_HALF_WIDTH, ramp, slopeTo, spiral, start, straight, TrackLayoutError, walkLayout, walkLines, widthTo, type ForkShape, type RoadState, type LayoutWalk, type TrackLayout, type TrackPiece } from './layout'
import { placementFault } from './road-checks'
import { TrackGraphError, wrapAngle, type TrackDef } from './track'
import { ROAD } from './tracks'

/**
 * Player-built courses. A player strings together pre-built sections from
 * `SECTIONS`; only section ids are stored, so every custom course is made of
 * pieces the game already knows how to drive and draw.
 */

export type SectionCategory = 'straights' | 'bends' | 'banks' | 'widths' | 'climbs' | 'jumps' | 'stunts' | 'splits' | 'lines'

export interface Section {
    label: string
    category: SectionCategory
    icon: string
    piece: TrackPiece
    /** Drawn on its own from this state, as the piece needs one to come off. */
    from?: Partial<RoadState>
    /** Off the palette; saved courses still lay it. */
    retired?: true
}

export const SECTION_CATEGORIES: readonly { id: SectionCategory, name: string }[] = [
    { id: 'straights', name: 'Straights' },
    { id: 'bends', name: 'Bends' },
    { id: 'banks', name: 'Banks' },
    { id: 'widths', name: 'Widths' },
    { id: 'climbs', name: 'Climbs' },
    { id: 'jumps', name: 'Jumps' },
    { id: 'stunts', name: 'Stunts' },
    { id: 'splits', name: 'Forks' },
    { id: 'lines', name: 'Lines' }
]

type Turn = 'left' | 'right'
const SIDE = { left: 'Left', right: 'Right' } as const
const ICONS = {
    left: { bend: 'i-lucide-corner-up-left', hairpin: 'i-lucide-undo-2', spiral: 'i-lucide-rotate-ccw' },
    right: { bend: 'i-lucide-corner-up-right', hairpin: 'i-lucide-redo-2', spiral: 'i-lucide-rotate-cw' }
} as const

const run = (length: number): Section => ({ label: `Straight ${length} m`, category: 'straights', icon: 'i-lucide-move-up', piece: straight(length) })
const bend = (turn: Turn, name: string, radius: number, angle = 90, bank = 0): Section => ({
    label: `${SIDE[turn]} ${name}`,
    category: 'bends',
    icon: angle === 180 ? ICONS[turn].hairpin : ICONS[turn].bend,
    piece: corner(turn, radius, angle, bank)
})
/** How far a bank piece tips the road. */
const BANK_ANGLE = 25
/** The grades a slope piece holds, in tenths so heights stay on whole metres. */
const GENTLE_GRADE = 0.1
const STEEP_GRADE = 0.2
/** Half widths a width piece takes the road to: half, one, one and a half and twice the normal road. */
export const ROAD_WIDTHS = { narrow: MIN_HALF_WIDTH, normal: ROAD.halfWidth, wide: ROAD.halfWidth * 1.5, veryWide: MAX_HALF_WIDTH } as const
const widen = (label: string, icon: string, to: number): Section => ({ label, category: 'widths', icon, piece: widthTo(to) })
const stunt = (label: string, icon: string, piece: TrackPiece): Section => ({ label, category: 'stunts', icon, piece })
const fork = (label: string, icon: string, type: 'split' | 'join', shape: ForkShape): Section => ({ label, category: 'splits', icon, piece: { type, shape } })
/** How high a jump ramp climbs, which its landing ramp comes back down. */
const KICKER_RISE = 4
const BIG_KICKER_RISE = 6
/** Empty road runs as far as a straight does, so a jump is as long as the player makes it. */
const empty = (length: number): Section => ({ label: `Gap ${length} m`, category: 'jumps', icon: 'i-lucide-cloud', piece: gap(length), from: { air: KICKER_RISE } })
const SPIRAL_SHARE = { 1: '', 0.5: 'half ', 0.25: 'quarter ' } as const
/** On a grid multiple, so a half or quarter spiral ends on the grid and a loop can still close. */
const SPIRAL_RADIUS = 40
/** A full turn climbs 12 m and leaves right over where it came in; a half or quarter climbs its share, so they add up to one. */
const helix = (turn: Turn, rise: number, share: keyof typeof SPIRAL_SHARE = 1): Section => ({
    label: `${SIDE[turn]} ${SPIRAL_SHARE[share]}spiral ${rise > 0 ? 'up' : 'down'}`,
    category: 'climbs',
    icon: ICONS[turn].spiral,
    piece: spiral(turn, SPIRAL_RADIUS, 360 * share, rise * share)
})

/** Every section a player can lay, in palette order within each category. Ids are stored: never rename one; a replaced one goes in REPLACED. */
export const SECTIONS = {
    'straight-10': run(10),
    'straight-20': run(20),
    'straight-60': run(60),
    'straight-100': run(100),
    'straight-200': run(200),
    'left-tight': bend('left', 'tight', 40),
    'left-wide': bend('left', 'wide', 80),
    'left-medium': bend('left', 'medium', 60),
    'left-eighth-tight': bend('left', 'tight 45°', 40, 45),
    'left-eighth': bend('left', '45°', 60, 45),
    'left-eighth-wide': bend('left', 'wide 45°', 80, 45),
    'left-hairpin': bend('left', 'hairpin', 30, 180),
    'left-hairpin-medium': bend('left', 'medium hairpin', 60, 180),
    'left-hairpin-wide': bend('left', 'wide hairpin', 80, 180),
    'left-banked': { ...bend('left', 'banked', 60, 90, BANK_ANGLE), retired: true },
    'right-tight': bend('right', 'tight', 40),
    'right-wide': bend('right', 'wide', 80),
    'right-medium': bend('right', 'medium', 60),
    'right-eighth-tight': bend('right', 'tight 45°', 40, 45),
    'right-eighth': bend('right', '45°', 60, 45),
    'right-eighth-wide': bend('right', 'wide 45°', 80, 45),
    'right-hairpin': bend('right', 'hairpin', 30, 180),
    'right-hairpin-medium': bend('right', 'medium hairpin', 60, 180),
    'right-hairpin-wide': bend('right', 'wide hairpin', 80, 180),
    'right-banked': { ...bend('right', 'banked', 60, 90, BANK_ANGLE), retired: true },
    'bank-left': { label: 'Flat to bank left', category: 'banks', icon: 'i-lucide-arrow-up-right', piece: bankTo(-BANK_ANGLE) },
    'bank-right': { label: 'Flat to bank right', category: 'banks', icon: 'i-lucide-arrow-up-left', piece: bankTo(BANK_ANGLE) },
    'bank-flat': { label: 'Bank to flat', category: 'banks', icon: 'i-lucide-arrow-down-to-line', piece: bankTo(0), from: { bank: BANK_ANGLE } },
    'width-narrow': widen('Narrow road', 'i-lucide-chevrons-right-left', ROAD_WIDTHS.narrow),
    'width-normal': { ...widen('Normal road', 'i-lucide-move-horizontal', ROAD_WIDTHS.normal), from: { halfWidth: ROAD_WIDTHS.narrow } },
    'width-wide': widen('Wide road', 'i-lucide-unfold-horizontal', ROAD_WIDTHS.wide),
    'width-very-wide': widen('Very wide road', 'i-lucide-chevrons-left-right', ROAD_WIDTHS.veryWide),
    'slope-up': { label: 'Slope up', category: 'climbs', icon: 'i-lucide-trending-up', piece: slopeTo(GENTLE_GRADE) },
    'slope-up-steep': { label: 'Steep slope up', category: 'climbs', icon: 'i-lucide-mountain', piece: slopeTo(STEEP_GRADE) },
    'slope-down': { label: 'Slope down', category: 'climbs', icon: 'i-lucide-trending-down', piece: slopeTo(-GENTLE_GRADE) },
    'slope-down-steep': { label: 'Steep slope down', category: 'climbs', icon: 'i-lucide-mountain-snow', piece: slopeTo(-STEEP_GRADE) },
    'slope-flat': { label: 'Slope to flat', category: 'climbs', icon: 'i-lucide-arrow-right-to-line', piece: slopeTo(0), from: { grade: GENTLE_GRADE } },
    'ramp-up': { label: 'Ramp up', category: 'climbs', icon: 'i-lucide-trending-up', piece: ramp(150, 12) },
    'ramp-down': { label: 'Ramp down', category: 'climbs', icon: 'i-lucide-trending-down', piece: ramp(150, -12) },
    'steep-up': { label: 'Steep ramp up', category: 'climbs', icon: 'i-lucide-mountain', piece: ramp(80, 12) },
    'steep-down': { label: 'Steep ramp down', category: 'climbs', icon: 'i-lucide-mountain-snow', piece: ramp(80, -12) },
    'left-spiral-up': helix('left', 12),
    'left-spiral-down': helix('left', -12),
    'right-spiral-up': helix('right', 12),
    'right-spiral-down': helix('right', -12),
    'left-half-spiral-up': helix('left', 12, 0.5),
    'left-half-spiral-down': helix('left', -12, 0.5),
    'right-half-spiral-up': helix('right', 12, 0.5),
    'right-half-spiral-down': helix('right', -12, 0.5),
    'left-quarter-spiral-up': helix('left', 12, 0.25),
    'left-quarter-spiral-down': helix('left', -12, 0.25),
    'right-quarter-spiral-up': helix('right', 12, 0.25),
    'right-quarter-spiral-down': helix('right', -12, 0.25),
    'jump': { ...stunt('Jump', 'i-lucide-rocket', jump(KICKER_RISE, 30)), retired: true },
    'big-jump': { ...stunt('Big jump', 'i-lucide-rocket', jump(BIG_KICKER_RISE, 60)), retired: true },
    'jump-ramp': { label: 'Jump ramp', category: 'jumps', icon: 'i-lucide-rocket', piece: kicker(KICKER_RISE) },
    'jump-ramp-big': { label: 'Big jump ramp', category: 'jumps', icon: 'i-lucide-rocket', piece: kicker(BIG_KICKER_RISE) },
    'empty-10': empty(10),
    'empty-20': empty(20),
    'empty-60': empty(60),
    'empty-100': empty(100),
    'empty-200': empty(200),
    'landing-ramp': { label: 'Landing ramp', category: 'jumps', icon: 'i-lucide-plane-landing', piece: landing, from: { air: KICKER_RISE } },
    'looping-left': stunt('Looping, out left', 'i-lucide-repeat', looping('left', 22)),
    'looping-right': stunt('Looping, out right', 'i-lucide-repeat', looping('right', 22)),
    'corkscrew-left': { ...stunt('Corkscrew left', 'i-lucide-tornado', corkscrew('left', 200)), from: { bank: -BANK_ANGLE } },
    'corkscrew-right': { ...stunt('Corkscrew right', 'i-lucide-tornado', corkscrew('right', 200)), from: { bank: BANK_ANGLE } },
    'boost-pad': stunt('Boost pad', 'i-lucide-chevrons-up', boostPad('full')),
    'boost-pad-left': stunt('Boost pad, left', 'i-lucide-chevrons-up', boostPad('left')),
    'boost-pad-right': stunt('Boost pad, right', 'i-lucide-chevrons-up', boostPad('right')),
    'split-y': fork('Y split', 'i-lucide-split', 'split', 'y'),
    'split-left': fork('Split left', 'i-lucide-git-branch', 'split', 'left'),
    'split-right': fork('Split right', 'i-lucide-git-branch', 'split', 'right'),
    'join-y': fork('Y join', 'i-lucide-merge', 'join', 'y'),
    'join-left': fork('Join from left', 'i-lucide-git-merge', 'join', 'left'),
    'join-right': fork('Join from right', 'i-lucide-git-merge', 'join', 'right'),
    'start': { label: 'Start line', category: 'lines', icon: 'i-lucide-flag-triangle-right', piece: start },
    'checkpoint': { label: 'Checkpoint', category: 'lines', icon: 'i-lucide-milestone', piece: checkpoint },
    'finish': { label: 'Finish line', category: 'lines', icon: 'i-lucide-flag', piece: finish }
} satisfies Record<string, Section>

export type SectionId = keyof typeof SECTIONS

/** What a player can pick from, in palette order. */
export const PALETTE_SECTIONS = (Object.entries(SECTIONS) as [SectionId, Section][]).filter(([, s]) => !s.retired)

export const isSectionId = (id: unknown): id is SectionId => typeof id === 'string' && Object.hasOwn(SECTIONS, id)

/** Sections since replaced, and what a saved course lays in their place. */
const REPLACED: Record<string, SectionId> = { 'straight-50': 'straight-60' }

/** A split or join section: section `at` of line `branch`, 0 the main road. */
export interface SectionSpot {
    branch: number
    at: number
}

/** A split's second arm: sections laid on from the bend it peels off on. */
export interface CustomBranch {
    sections: SectionId[]
    /** The split it leaves from, on an earlier line. */
    from: SectionSpot
    /** The join it comes into; null while it's open, or on a sprint, running to a finish line of its own. */
    to: SectionSpot | null
}

export interface CustomTrack {
    id: string
    name: string
    /** A loop, or a point-to-point sprint. */
    closed: boolean
    /** The main road. */
    sections: SectionId[]
    /** Lines 1 up; left out on a course that never forks. */
    branches?: CustomBranch[]
}

const ID_PREFIX = 'custom-'
export const MAX_NAME_LENGTH = 24
/** Keeps the crossing check, which compares every stretch with every other, quick enough to run on each edit; counted over every line. */
export const MAX_SECTIONS = 80
/** Branches a course may fork into; the route cap usually binds first. */
export const MAX_BRANCHES = 8

export const isCustomTrackId = (id: string) => id.startsWith(ID_PREFIX)

/** A published course's id: a fresh one each time its road changes, so old times never carry over. */
const PUBLISHED_PREFIX = 'pub-'
export const isPublishedTrackId = (id: string) => id.startsWith(PUBLISHED_PREFIX)
export const newPublishedTrackId = () => `${PUBLISHED_PREFIX}${crypto.randomUUID()}`
/** How many courses one player may have: the builder stops at it, and the server holds published ones to it. */
export const MAX_CUSTOM_TRACKS = 5

/** A fresh course: a loop is just its start line; a sprint has room for the grid behind it. */
export function newCustomTrack(closed = true): CustomTrack {
    return { id: `${ID_PREFIX}${crypto.randomUUID()}`, name: 'My Track', closed, sections: closed ? ['start'] : ['straight-20', 'start'] }
}

export { mapWalkHeights, raisedTo } from './layout'

const sameSpot = (a: SectionSpot | null, b: SectionSpot | null) => a === b || (!!a && !!b && a.branch === b.branch && a.at === b.at)
const sameSections = (a: readonly SectionId[], b: readonly SectionId[]) => a.length === b.length && a.every((s, i) => s === b[i])

/** True when two versions of a course drive the same, so lap times set on one stand on the other. */
export function sameRoad(a: CustomTrack, b: CustomTrack) {
    const x = a.branches ?? []
    const y = b.branches ?? []
    return a.closed === b.closed && sameSections(a.sections, b.sections) && x.length === y.length
        && x.every((p, i) => sameSections(p.sections, y[i]!.sections) && sameSpot(p.from, y[i]!.from) && sameSpot(p.to, y[i]!.to))
}

/** Line `line`'s sections: 0 is the main road. */
export const lineSections = (t: CustomTrack, line: number): SectionId[] => line ? t.branches?.[line - 1]?.sections ?? [] : t.sections

/** How many sections the course has, over every line. */
export const sectionCount = (t: CustomTrack) => t.sections.length + (t.branches ?? []).reduce((n, b) => n + b.sections.length, 0)

const piecesOf = (sections: readonly SectionId[]) => sections.map(id => SECTIONS[id].piece)

/** The shape of the split or join section `id`, or null when it's neither. */
export function forkShape(id: SectionId | undefined, type: 'split' | 'join'): ForkShape | null {
    const piece = id && SECTIONS[id].piece
    return piece && piece.type === type ? piece.shape : null
}

/** The shape of the split or join at `spot`, or null when there's none there. */
export const shapeAt = (t: CustomTrack, spot: SectionSpot, type: 'split' | 'join') => forkShape(lineSections(t, spot.branch)[spot.at], type)

/** Where section `at` of line `line` starts among the layout's pieces: a branch starts with its split's arm. */
const pieceIndex = (line: number, at: number) => line ? at + 1 : at

/** How each branch meets the join it heads for, off the lines walked with no branch coming in yet; null for a branch with no join. */
function forkMeets(t: CustomTrack): (InletMeet | null)[] {
    const branches = t.branches ?? []
    if (!branches.some(b => b.to)) return branches.map(() => null)
    const walks = walkLines(customLayout(t, branches.map(() => null)))
    return branches.map((b, i) => {
        const shape = b.to && shapeAt(t, b.to, 'join')
        const inlet = shape && inletOf(walks[b.to!.branch]!, pieceIndex(b.to!.branch, b.to!.at), shape)
        return inlet ? meetInlet(walks[i + 1]!.end, inlet) : null
    })
}

/** Per branch, how it comes into its join, or null when it doesn't. */
export const forkMerges = (t: CustomTrack): (Merge | null)[] => forkMeets(t).map(m => m && m.runIn !== null ? m as Merge : null)

/** The course as a layout; `merges` gives how each branch comes into its join, null for one that doesn't, worked out when left out. */
export function customLayout(t: CustomTrack, merges: readonly (Merge | null)[] = forkMerges(t)): TrackLayout {
    const layout: TrackLayout = {
        id: t.id,
        name: t.name.trim() || 'Untitled',
        group: t.closed ? 'circuits' : 'sprints',
        ...ROAD,
        closed: t.closed,
        origin: { x: 0, z: 0, heading: 0 },
        pieces: piecesOf(t.sections)
    }
    if (t.branches?.length) {
        layout.branches = t.branches.map((b, i) => {
            const split = shapeAt(t, b.from, 'split')
            const merge = merges[i] ?? null
            const join = b.to && merge ? shapeAt(t, b.to, 'join') : null
            return {
                pieces: [...split ? [splitArm(split)] : [], ...piecesOf(b.sections), ...join ? joinMerge(join, merge!) : []],
                from: { branch: b.from.branch, at: pieceIndex(b.from.branch, b.from.at) },
                to: b.to && join ? { branch: b.to.branch, at: pieceIndex(b.to.branch, b.to.at) + 1 } : null
            }
        })
    }
    return layout
}

/** The main road's sections laid end to end, finished or not. */
export function walkCustomTrack(t: CustomTrack): LayoutWalk {
    return walkLayout(customLayout({ ...t, branches: undefined }))
}

/** One section on its own; a downhill piece keeps its drop, like any road, by standing on its lowest point. */
export function sectionWalk(id: SectionId): LayoutWalk {
    const section: Section = SECTIONS[id]
    return walkLayout(customLayout({ id: 'section', name: '', closed: false, sections: [id] }), section.from)
}

/** What still separates a loop's end from its start: metres apart, degrees left to turn (+ right), metres to come down (- to climb), the bank and grade left to level, metres of half width to undo (+ to narrow), and a jump still to land. */
export function loopGap(walk: LayoutWalk) {
    const { x, z, heading, aboveStart, bank, grade, halfWidth, air } = walk.end
    return { distance: Math.hypot(x, z), turn: Math.round(wrapAngle(-heading) * 180 / Math.PI), climb: aboveStart, bank, grade, width: halfWidth - ROAD.halfWidth, air }
}

/** Why a section can't be laid on road in this state, in the builder's words; null when it can. */
export const sectionFault = (id: SectionId, state: Pick<RoadState, 'bank' | 'grade' | 'air'>) => placementFault(SECTIONS[id].piece, state)

/** How the state a section starts out in changes it, for its row in the list; a piece that sets that state itself doesn't ride it. */
export function rideTag(id: SectionId, { bank, grade, halfWidth }: Pick<RoadState, 'bank' | 'grade' | 'halfWidth'>) {
    const { type } = SECTIONS[id].piece
    const tilt = bank && type !== 'bank' && type !== 'corkscrew' ? 'BANKED' : ''
    const climb = grade && type !== 'slope' ? (grade > 0 ? 'UP' : 'DOWN') : ''
    const width = halfWidth !== ROAD.halfWidth && type !== 'width' ? (halfWidth < ROAD.halfWidth ? 'NARROW' : 'WIDE') : ''
    return [tilt, climb, width].filter(Boolean).join(' ')
}

/** The index of the piece holding walk point `i`. */
export function pieceAt(walk: LayoutWalk, i: number) {
    const starts = walk.pieceStarts
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid]! <= i) lo = mid
        else hi = mid - 1
    }
    return lo
}

/**
 * The road laid so far as a course to draw, finished or not: open, running on to where the last
 * piece ends, unless `closes` says the loop meets its start. Null before there's any road.
 */
export function draftTrackDef(walk: LayoutWalk, closes: boolean): TrackDef | null {
    const points = walk.pts.map(([x, z]): [number, number] => [x, z])
    const heights = [...walk.ys]
    const ups = [...walk.ups]
    const halfWidths = [...walk.halfWidths]
    if (!closes) {
        points.push([walk.end.x, walk.end.z])
        heights.push(walk.end.y)
        ups.push(ups[ups.length - 1] ?? [0, 1, 0])
        halfWidths.push(walk.end.halfWidth)
    }
    if (points.length < 2) return null
    const def: TrackDef = { id: 'draft', name: 'Draft', group: closes ? 'circuits' : 'sprints', points, ...ROAD }
    if (heights.some(y => y !== 0)) def.heights = heights
    if (halfWidths.some(w => w !== ROAD.halfWidth)) def.halfWidths = halfWidths
    if (ups.some(u => u[0] !== 0 || u[1] !== 1 || u[2] !== 0)) def.ups = ups
    if (walk.rails.length) def.rails = walk.rails
    if (walk.gaps.length) def.gaps = walk.gaps
    if (walk.boosts.length) def.boosts = walk.boosts
    if (!closes) def.closed = false
    return def
}

/** A walk's last piece cut out of it, as a course to draw on its own. */
export function lastPieceWalk(walk: LayoutWalk): LayoutWalk {
    const from = walk.pieceStarts[walk.pieceStarts.length - 1]!
    return {
        ...walk,
        pts: walk.pts.slice(from),
        ys: walk.ys.slice(from),
        lifts: walk.lifts.slice(from),
        ups: walk.ups.slice(from),
        halfWidths: walk.halfWidths.slice(from),
        walls: walk.walls.slice(from),
        rails: [],
        // Kept, so an empty piece's preview reads as empty road, not as deck.
        gaps: walk.gaps.filter(([, to]) => to > from).map(([a, b]) => [Math.max(0, a - from), b - from]),
        boosts: [],
        lines: [],
        pieceStarts: [0],
        states: walk.states.slice(-1)
    }
}

export type CompiledCustomTrack = { def: TrackDef, error: null } | { def: null, error: string }

/** The drivable course, or why it isn't one yet. */
export function compileCustomTrack(t: CustomTrack): CompiledCustomTrack {
    if (!t.sections.length) return { def: null, error: 'lay some sections first' }
    const empty = (t.branches ?? []).findIndex(b => !b.sections.length)
    if (empty >= 0) return { def: null, error: `branch ${empty + 1} is empty` }
    const lonely = lonelyJoin(t)
    if (lonely) return { def: null, error: `no road comes into the join on ${lonely.branch ? `branch ${lonely.branch}` : 'the main road'}` }
    const merges = forkMerges(t)
    // The layout drops a join a branch doesn't reach, which would leave a sprint's branch with a finish racing past it.
    const unmet = (t.branches ?? []).findIndex((b, i) => b.to && !merges[i])
    if (unmet >= 0) return { def: null, error: `branch ${unmet + 1} doesn't reach its join` }
    return compiled(customLayout(t, merges))
}

/** The main road on its own as a course, its splits and joins driven straight through: what a loop closes on whatever its branches do. */
export const compileMainRoad = (t: CustomTrack) => compiled(customLayout({ ...t, branches: undefined }))

function compiled(layout: TrackLayout): CompiledCustomTrack {
    try {
        return { def: buildTrack(layout), error: null }
    } catch (e) {
        if (e instanceof TrackLayoutError || e instanceof TrackGraphError) return { def: null, error: e.reason }
        throw e
    }
}

/** The first join section no branch comes into, or null. */
export function lonelyJoin(t: CustomTrack): SectionSpot | null {
    const taken = new Set((t.branches ?? []).flatMap(b => b.to ? [`${b.to.branch}:${b.to.at}`] : []))
    for (let line = 0; line <= (t.branches?.length ?? 0); line++) {
        const at = lineSections(t, line).findIndex((id, k) => forkShape(id, 'join') && !taken.has(`${line}:${k}`))
        if (at >= 0) return { branch: line, at }
    }
    return null
}

/** Stored section ids, with replaced ones swapped for what replaced them; null if any isn't a section. */
function sanitizeSections(raw: unknown): SectionId[] | null {
    if (!Array.isArray(raw) || raw.length > MAX_SECTIONS) return null
    const ids = raw.map(s => typeof s === 'string' && Object.hasOwn(REPLACED, s) ? REPLACED[s] : s)
    return ids.every(isSectionId) ? ids : null
}

/** A stored spot on a `type` section of one of `lines`; null if it isn't one. */
function sanitizeSpot(raw: unknown, lines: readonly (readonly SectionId[])[], type: 'split' | 'join'): SectionSpot | null {
    if (!raw || typeof raw !== 'object') return null
    const { branch, at } = raw as Record<string, unknown>
    if (!Number.isInteger(branch) || !Number.isInteger(at)) return null
    const b = branch as number
    const a = at as number
    return b >= 0 && b < lines.length && forkShape(lines[b]![a], type) ? { branch: b, at: a } : null
}

/** A stored course's branches, or null if any is malformed: one for every split, off an earlier line, each into a join of its own on another line. */
export function sanitizeBranches(raw: unknown, main: readonly SectionId[]): CustomBranch[] | null {
    if (raw === undefined || raw === null) raw = []
    if (!Array.isArray(raw) || raw.length > MAX_BRANCHES) return null
    const sections = raw.map(b => b && typeof b === 'object' ? sanitizeSections((b as Record<string, unknown>).sections) : null)
    if (!sections.every(s => s !== null)) return null
    const lines = [main, ...sections]
    const out: CustomBranch[] = []
    const used = new Set<string>()
    const claim = (s: SectionSpot) => !used.has(`${s.branch}:${s.at}`) && !!used.add(`${s.branch}:${s.at}`)
    for (let i = 0; i < raw.length; i++) {
        const { from, to } = raw[i] as Record<string, unknown>
        const start = sanitizeSpot(from, lines.slice(0, i + 1), 'split')
        const end = to === null ? null : sanitizeSpot(to, lines, 'join')
        if (!start || !claim(start) || (to !== null && (!end || end.branch === i + 1 || !claim(end)))) return null
        out.push({ sections: sections[i]!, from: start, to: end })
    }
    const splits = lines.reduce((n, l) => n + l.filter(id => forkShape(id, 'split')).length, 0)
    return splits === out.length ? out : null
}

/** A stored course as it came back from storage, or null when it isn't one. */
export function sanitizeCustomTrack(raw: unknown): CustomTrack | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, name, closed, sections, branches } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !isCustomTrackId(id) || typeof name !== 'string' || typeof closed !== 'boolean') return null
    const ids = sanitizeSections(sections)
    const forks = ids && sanitizeBranches(branches, ids)
    if (!ids || !forks) return null
    const track: CustomTrack = { id, name: name.slice(0, MAX_NAME_LENGTH), closed, sections: ids }
    if (forks.length) track.branches = forks
    return sectionCount(track) > MAX_SECTIONS ? null : track
}
