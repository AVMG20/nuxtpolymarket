import { bankTo, boostPad, buildTrack, checkpoint, corkscrew, corner, finish, gap, jump, kicker, landing, looping, MAX_HALF_WIDTH, MIN_HALF_WIDTH, ramp, slopeTo, spiral, start, straight, TrackLayoutError, walkLayout, widthTo, type RoadState, type LayoutWalk, type TrackLayout, type TrackPiece } from './layout'
import { placementFault } from './road-checks'
import { TrackGraphError, wrapAngle, type TrackDef } from './track'
import { ROAD } from './tracks'

/**
 * Player-built courses. A player strings together pre-built sections from
 * `SECTIONS`; only section ids are stored, so every custom course is made of
 * pieces the game already knows how to drive and draw.
 */

export type SectionCategory = 'straights' | 'bends' | 'banks' | 'widths' | 'climbs' | 'jumps' | 'stunts' | 'lines'

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

export interface CustomTrack {
    id: string
    name: string
    /** A loop, or a point-to-point sprint. */
    closed: boolean
    sections: SectionId[]
}

const ID_PREFIX = 'custom-'
export const MAX_NAME_LENGTH = 24
/** Keeps the crossing check, which compares every stretch with every other, quick enough to run on each edit. */
export const MAX_SECTIONS = 80

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

/** True when two versions of a course drive the same, so lap times set on one stand on the other. */
export function sameRoad(a: CustomTrack, b: CustomTrack) {
    return a.closed === b.closed && a.sections.length === b.sections.length && a.sections.every((s, i) => s === b.sections[i])
}

export function customLayout(t: CustomTrack): TrackLayout {
    return {
        id: t.id,
        name: t.name.trim() || 'Untitled',
        group: t.closed ? 'circuits' : 'sprints',
        ...ROAD,
        closed: t.closed,
        origin: { x: 0, z: 0, heading: 0 },
        pieces: t.sections.map(id => SECTIONS[id].piece)
    }
}

/** The sections laid end to end, finished or not. */
export function walkCustomTrack(t: CustomTrack): LayoutWalk {
    return walkLayout(customLayout(t))
}

/** The same walk with every height passed through `f`. */
export function mapWalkHeights(walk: LayoutWalk, f: (y: number) => number): LayoutWalk {
    return { ...walk, ys: walk.ys.map(f), end: { ...walk.end, y: f(walk.end.y) } }
}

/** The same road raised to stand `rise` above where it set off, so roads lifted by different amounts share one ground. */
export function raisedTo(walk: LayoutWalk, rise: number): LayoutWalk {
    const by = rise - walk.rise
    return by ? { ...mapWalkHeights(walk, y => y + by), rise } : walk
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
    try {
        return { def: buildTrack(customLayout(t)), error: null }
    } catch (e) {
        if (e instanceof TrackLayoutError || e instanceof TrackGraphError) return { def: null, error: e.reason }
        throw e
    }
}

/** A stored course as it came back from storage, or null when it isn't one. */
export function sanitizeCustomTrack(raw: unknown): CustomTrack | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, name, closed, sections } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !isCustomTrackId(id) || typeof name !== 'string' || typeof closed !== 'boolean') return null
    if (!Array.isArray(sections) || sections.length > MAX_SECTIONS) return null
    const ids = sections.map(s => typeof s === 'string' && Object.hasOwn(REPLACED, s) ? REPLACED[s] : s)
    if (!ids.every(isSectionId)) return null
    return { id, name: name.slice(0, MAX_NAME_LENGTH), closed, sections: ids }
}
