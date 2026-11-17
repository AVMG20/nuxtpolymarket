/**
 * Things a player can stand on a custom course's road: barrels to smash, concrete to dodge, oil to slide on.
 * Each sits in road coordinates, on a section of a line, so it rides the road's banks and slopes and stays
 * with its section when the course is edited. Pure data and rules here: no layout, no three.js.
 */

export type ObstacleKind = 'barrel' | 'explosive' | 'block' | 'tyres' | 'cones' | 'bumper' | 'oil'

/** How a car meets it: knocked away, bounced off, or slid over. */
export type ObstacleMechanic = 'knock' | 'solid' | 'slick'

/** An obstacle as a course stores it. */
export interface Obstacle {
    kind: ObstacleKind
    /** 0 the main road, n branch n. */
    line: number
    /** The section of that line it stands on. */
    at: number
    /** Metres into the section along the road. */
    along: number
    /** Metres from the centreline, + to the right. */
    lateral: number
    /** Turned a quarter: a block then runs along the road instead of across it. Left out when 0. */
    rot?: 90
}

export interface ObstacleSpec {
    label: string
    icon: string
    mechanic: ObstacleMechanic
    /** Half its size along the road and across it unturned; a round one has both equal to its radius. */
    halfAlong: number
    halfAcross: number
    round: boolean
    /** Metres tall: a car in the air higher than its top clears it. */
    height: number
    /** Whether `rot` changes anything. */
    turns: boolean
    /** Knock: share of speed lost. */
    slow: number
    /** Knock: upward kick in m/s and how far the path is turned away, in radians. */
    kickUp: number
    kickTurn: number
    /** Solid: how much of the speed into it comes back out, and how much the rub along it costs per unit of impact. */
    restitution: number
    friction: number
    /** Solid: share of speed kept on a first touch, like a wall's touch. */
    touchKeep: number
    /** Slick: seconds of low grip after rolling over it, and the grip left. */
    slickTime: number
    grip: number
}

const spec = (s: Partial<ObstacleSpec> & Pick<ObstacleSpec, 'label' | 'icon' | 'mechanic' | 'halfAlong' | 'halfAcross' | 'height'>): ObstacleSpec => ({
    round: false, turns: false, slow: 0, kickUp: 0, kickTurn: 0, restitution: 0, friction: 0, touchKeep: 1, slickTime: 0, grip: 1, ...s
})

/** Every kind, in palette order, with its footprint and how it plays; all tuning lives here. */
export const OBSTACLE_KINDS: Readonly<Record<ObstacleKind, ObstacleSpec>> = {
    barrel: spec({ label: 'Barrel', icon: 'i-lucide-cylinder', mechanic: 'knock', halfAlong: 0.45, halfAcross: 0.45, round: true, height: 1.1, slow: 0.22 }),
    explosive: spec({ label: 'Explosive barrel', icon: 'i-lucide-bomb', mechanic: 'knock', halfAlong: 0.45, halfAcross: 0.45, round: true, height: 1.1, slow: 0.4, kickUp: 3.5, kickTurn: 0.22 }),
    block: spec({ label: 'Concrete block', icon: 'i-lucide-brick-wall', mechanic: 'solid', halfAlong: 1, halfAcross: 3, height: 1.1, turns: true, restitution: 0.05, friction: 2, touchKeep: 0.4 }),
    tyres: spec({ label: 'Tyre stack', icon: 'i-lucide-circle-dot', mechanic: 'solid', halfAlong: 0.8, halfAcross: 0.8, round: true, height: 1.2, restitution: 0.45, friction: 0.8, touchKeep: 0.75 }),
    cones: spec({ label: 'Cone', icon: 'i-lucide-traffic-cone', mechanic: 'knock', halfAlong: 0.35, halfAcross: 0.35, round: true, height: 0.8, slow: 0.03 }),
    bumper: spec({ label: 'Bumper', icon: 'i-lucide-circle-dashed', mechanic: 'solid', halfAlong: 0.9, halfAcross: 0.9, round: true, height: 1.4, restitution: 1, friction: 0, touchKeep: 1 }),
    oil: spec({ label: 'Oil slick', icon: 'i-lucide-droplet', mechanic: 'slick', halfAlong: 3, halfAcross: 2, height: 0.02, turns: true, slickTime: 1.1, grip: 0.3 })
}

export const OBSTACLE_KIND_IDS = Object.keys(OBSTACLE_KINDS) as ObstacleKind[]
export const isObstacleKind = (k: unknown): k is ObstacleKind => typeof k === 'string' && Object.hasOwn(OBSTACLE_KINDS, k)

/** Obstacles one course may hold. */
export const MAX_OBSTACLES = 120
/** How finely a placed obstacle snaps: along the road and across it. */
export const OBSTACLE_ALONG_STEP = 2
export const OBSTACLE_LANE_STEP = 1
/** A section is never longer than this, so a stored `along` past it is junk. */
const MAX_ALONG = 1000

/** Its half size along the road and across it, turned. */
export function footprint(kind: ObstacleKind, rot: 0 | 90 = 0) {
    const k = OBSTACLE_KINDS[kind]
    return rot === 90 && k.turns ? { along: k.halfAcross, across: k.halfAlong } : { along: k.halfAlong, across: k.halfAcross }
}

/** Whether a car can't drive through it. */
export const isSolid = (kind: ObstacleKind) => OBSTACLE_KINDS[kind].mechanic === 'solid'

/** An obstacle laid out on a compiled line: its index in the course's list, and distance along the line. */
export interface ObstacleDef {
    id: number
    kind: ObstacleKind
    s: number
    lateral: number
    rot?: 90
}

const round = (v: number, step: number) => Math.round(v / step) * step

/** Stored obstacles cleaned up: unknown kinds, junk numbers and spots on sections that don't exist are dropped; null when it isn't a list. */
export function sanitizeObstacles(raw: unknown, lineLengths: readonly number[]): Obstacle[] | null {
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw)) return null
    const out: Obstacle[] = []
    for (const o of raw.slice(0, MAX_OBSTACLES)) {
        if (!o || typeof o !== 'object') continue
        const { kind, line, at, along, lateral, rot } = o as Record<string, unknown>
        if (!isObstacleKind(kind) || !Number.isInteger(line) || !Number.isInteger(at)) continue
        if (typeof along !== 'number' || typeof lateral !== 'number' || !Number.isFinite(along) || !Number.isFinite(lateral)) continue
        const l = line as number
        const a = at as number
        if (l < 0 || l >= lineLengths.length || a < 0 || a >= lineLengths[l]!) continue
        if (along < 0 || along > MAX_ALONG || Math.abs(lateral) > 30) continue
        const clean: Obstacle = { kind, line: l, at: a, along: round(along, 0.01), lateral: round(lateral, 0.01) }
        if (rot === 90 && OBSTACLE_KINDS[kind].turns) clean.rot = 90
        out.push(clean)
    }
    return out
}

/** The obstacles' part of a road key, the same whatever order they're listed in. */
export function obstacleKey(obstacles: readonly Obstacle[]) {
    return obstacles.map(o => [o.kind, o.line, o.at, o.along, o.lateral, o.rot ?? 0] as const)
        .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)
}

interface WithObstacles {
    obstacles?: Obstacle[]
}

const withList = <T extends WithObstacles>(t: T, list: Obstacle[]): T => {
    const { obstacles: _, ...rest } = t
    return (list.length ? { ...rest, obstacles: list } : rest) as T
}

/** `t` with every obstacle on line `line` at section `index` or later moved `delta` sections on: what inserting (+1) or removing (-1) a section needs. */
export function shiftObstacles<T extends WithObstacles>(t: T, line: number, index: number, delta: number): T {
    if (!t.obstacles?.length) return t
    return withList(t, t.obstacles.map(o => o.line === line && o.at >= index ? { ...o, at: o.at + delta } : o))
}

/** `t` without the obstacles on section `index` of line `line`. */
export function dropObstaclesOf<T extends WithObstacles>(t: T, line: number, index: number): T {
    if (!t.obstacles?.length) return t
    return withList(t, t.obstacles.filter(o => !(o.line === line && o.at === index)))
}

/** `t` with each obstacle on line `line` moved to section `where(at)`. */
export function remapObstacles<T extends WithObstacles>(t: T, line: number, where: (at: number) => number): T {
    if (!t.obstacles?.length) return t
    return withList(t, t.obstacles.map(o => o.line === line ? { ...o, at: where(o.at) } : o))
}

/** `t` with the obstacles on lines `gone` dropped and the rest's lines renumbered by `renumber` (old line to new). */
export function renumberObstacleLines<T extends WithObstacles>(t: T, renumber: readonly number[]): T {
    if (!t.obstacles?.length) return t
    return withList(t, t.obstacles.flatMap(o => (renumber[o.line] ?? -1) < 0 ? [] : [{ ...o, line: renumber[o.line]! }]))
}
