import { buildTrack, checkpoint, corkscrew, corner, finish, jump, looping, ramp, spiral, start, straight, TrackLayoutError, walkLayout, type LayoutWalk, type TrackLayout, type TrackPiece } from './layout'
import { wrapAngle, type TrackDef } from './track'
import { ROAD } from './tracks'

/**
 * Player-built courses. A player strings together pre-built sections from
 * `SECTIONS`; only section ids are stored, so every custom course is made of
 * pieces the game already knows how to drive and draw.
 */

export type SectionCategory = 'straights' | 'bends' | 'climbs' | 'stunts' | 'lines'

export interface Section {
    label: string
    category: SectionCategory
    icon: string
    piece: TrackPiece
}

export const SECTION_CATEGORIES: readonly { id: SectionCategory, name: string }[] = [
    { id: 'straights', name: 'Straights' },
    { id: 'bends', name: 'Bends' },
    { id: 'climbs', name: 'Climbs' },
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
const stunt = (label: string, icon: string, piece: TrackPiece): Section => ({ label, category: 'stunts', icon, piece })
const SPIRAL_SHARE = { 1: '', 0.5: 'half ', 0.25: 'quarter ' } as const
/** A full turn climbs 12 m and leaves right over where it came in; a half or quarter climbs its share at the same grade, so they add up to one. */
const helix = (turn: Turn, rise: number, share: keyof typeof SPIRAL_SHARE = 1): Section => ({
    label: `${SIDE[turn]} ${SPIRAL_SHARE[share]}spiral ${rise > 0 ? 'up' : 'down'}`,
    category: 'climbs',
    icon: ICONS[turn].spiral,
    piece: spiral(turn, 36, 360 * share, rise * share)
})

/** Every section a player can lay, in palette order within each category. Ids are stored: never rename one. */
export const SECTIONS = {
    'straight-20': run(20),
    'straight-50': run(50),
    'straight-100': run(100),
    'straight-200': run(200),
    'left-tight': bend('left', 'tight', 40),
    'left-wide': bend('left', 'wide', 80),
    'left-eighth': bend('left', '45°', 60, 45),
    'left-hairpin': bend('left', 'hairpin', 30, 180),
    'left-banked': bend('left', 'banked', 60, 90, 25),
    'right-tight': bend('right', 'tight', 40),
    'right-wide': bend('right', 'wide', 80),
    'right-eighth': bend('right', '45°', 60, 45),
    'right-hairpin': bend('right', 'hairpin', 30, 180),
    'right-banked': bend('right', 'banked', 60, 90, 25),
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
    'jump': stunt('Jump', 'i-lucide-rocket', jump(4, 30)),
    'big-jump': stunt('Big jump', 'i-lucide-rocket', jump(6, 60)),
    'looping-left': stunt('Looping, out left', 'i-lucide-repeat', looping('left', 22)),
    'looping-right': stunt('Looping, out right', 'i-lucide-repeat', looping('right', 22)),
    'corkscrew-left': stunt('Corkscrew left', 'i-lucide-tornado', corkscrew('left', 200)),
    'corkscrew-right': stunt('Corkscrew right', 'i-lucide-tornado', corkscrew('right', 200)),
    'start': { label: 'Start line', category: 'lines', icon: 'i-lucide-flag-triangle-right', piece: start },
    'checkpoint': { label: 'Checkpoint', category: 'lines', icon: 'i-lucide-milestone', piece: checkpoint },
    'finish': { label: 'Finish line', category: 'lines', icon: 'i-lucide-flag', piece: finish }
} satisfies Record<string, Section>

export type SectionId = keyof typeof SECTIONS

export const isSectionId = (id: unknown): id is SectionId => typeof id === 'string' && Object.hasOwn(SECTIONS, id)

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

/** What still separates a loop's end from its start: metres apart, degrees left to turn (+ right) and metres to come down. */
export function loopGap(walk: LayoutWalk) {
    const { x, z, heading, y } = walk.end
    return { distance: Math.hypot(x, z), turn: Math.round(wrapAngle(-heading) * 180 / Math.PI), climb: y }
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
    if (!closes) {
        points.push([walk.end.x, walk.end.z])
        heights.push(walk.end.y)
        ups.push(ups[ups.length - 1] ?? [0, 1, 0])
    }
    if (points.length < 2) return null
    const def: TrackDef = { id: 'draft', name: 'Draft', group: closes ? 'circuits' : 'sprints', points, ...ROAD }
    if (heights.some(y => y !== 0)) def.heights = heights.map(y => Math.max(0, y))
    if (ups.some(u => u[0] !== 0 || u[1] !== 1 || u[2] !== 0)) def.ups = ups
    if (walk.rails.length) def.rails = walk.rails
    if (walk.gaps.length) def.gaps = walk.gaps
    if (!closes) def.closed = false
    return def
}

export type CompiledCustomTrack = { def: TrackDef, error: null } | { def: null, error: string }

/** The drivable course, or why it isn't one yet. */
export function compileCustomTrack(t: CustomTrack): CompiledCustomTrack {
    if (!t.sections.length) return { def: null, error: 'lay some sections first' }
    try {
        return { def: buildTrack(customLayout(t)), error: null }
    } catch (e) {
        if (e instanceof TrackLayoutError) return { def: null, error: e.reason }
        throw e
    }
}

/** A stored course as it came back from storage, or null when it isn't one. */
export function sanitizeCustomTrack(raw: unknown): CustomTrack | null {
    if (!raw || typeof raw !== 'object') return null
    const { id, name, closed, sections } = raw as Record<string, unknown>
    if (typeof id !== 'string' || !isCustomTrackId(id) || typeof name !== 'string' || typeof closed !== 'boolean') return null
    if (!Array.isArray(sections) || sections.length > MAX_SECTIONS || !sections.every(isSectionId)) return null
    return { id, name: name.slice(0, MAX_NAME_LENGTH), closed, sections: [...sections] }
}
