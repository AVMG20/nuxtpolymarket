// Call of Xeno — level layout ("Outpost 13").
//
// One building, two floors. The ground floor is a ring of rooms that all share
// walls — Barracks, Mess Hall, Atrium, Garage, Workshop, Lab and the Reactor
// Hall — with six buyable doors and three free openings knitting them into a
// loop you can kite. Two stairs climb out of the Atrium onto a catwalk that
// runs over it and into the two rooms above the Barracks and the Mess.
//
// The outer shell is unbroken except for boarded windows. Enemies arrive
// outside those windows, tear the boards off and climb in; the player can nail
// the boards back on for points. Nothing spawns inside the building.
//
// Everything is axis aligned. Collision is circle-vs-AABB with a vertical
// band test, navigation is a graph with a precomputed next-hop table.

import type { CallOfXenoPerkId, CallOfXenoWeaponId } from './call-of-xeno'

/** An axis-aligned footprint on the floor plane. */
export interface CallOfXenoBox {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
}

/** A footprint with a vertical band: occupies [baseY, baseY + height]. */
export interface CallOfXenoSolid {
    box: CallOfXenoBox
    baseY: number
    height: number
}

/** A walkable slab. Also solid, so you can walk under a raised deck. */
export interface CallOfXenoPlatform {
    box: CallOfXenoBox
    /** Height of the walking surface. */
    y: number
    thickness: number
}

/** A walkable slope. Height varies linearly along one axis. */
export interface CallOfXenoRamp {
    box: CallOfXenoBox
    axis: 'x' | 'z'
    /** Coordinate on `axis` where the ramp meets the low floor. */
    lowAt: number
    lowY: number
    /** Coordinate on `axis` where the ramp meets the high floor. */
    highAt: number
    highY: number
    /** Drawn as a flight of steps rather than a smooth slab. */
    steps: number
}

/** Storey height of an ordinary room. */
export const CALL_OF_XENO_WALL_HEIGHT = 4.2
/** Ceiling of the rooms that run the full two storeys. */
export const CALL_OF_XENO_ATRIUM_HEIGHT = 8.8
/** Walking surface of the second floor. */
export const CALL_OF_XENO_UPPER_Y = 4.6
/** How high a step the player and zombies can walk up without jumping. */
export const CALL_OF_XENO_STEP_UP = 0.65

const H = CALL_OF_XENO_WALL_HEIGHT
const A = CALL_OF_XENO_ATRIUM_HEIGHT
const U = CALL_OF_XENO_UPPER_Y
/** Height of the walls that sit on the second floor. */
const UH = A - U

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export const CALL_OF_XENO_SHELL: CallOfXenoBox = { minX: 0, maxX: 58, minZ: 0, maxZ: 48 }
/** Thickness of the outer wall, measured outward from the shell. */
const SHELL_T = 0.5
/** The dirt apron drawn outside the building, where enemies come from. */
export const CALL_OF_XENO_EXTERIOR: CallOfXenoBox = { minX: -26, maxX: 84, minZ: -26, maxZ: 74 }

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** Boards a fully repaired window carries. */
export const CALL_OF_XENO_WINDOW_BOARDS = 6
/** Bottom of the window opening — everything below is sill. */
export const CALL_OF_XENO_WINDOW_SILL = 1
/** Top of the window opening — everything above is lintel. */
export const CALL_OF_XENO_WINDOW_HEAD = 2.7
/** Seconds an enemy spends prising a single board off. */
export const CALL_OF_XENO_TEAR_TIME = 1.6
/** Seconds an enemy takes to climb through once the boards are gone. */
export const CALL_OF_XENO_CLIMB_TIME = 1.15
/** Seconds of holding the repair key per board nailed back on. */
export const CALL_OF_XENO_REPAIR_TIME = 0.6
/** Points paid for each board repaired. */
export const CALL_OF_XENO_REPAIR_POINTS = 10

interface WindowSpec {
    id: string
    /** Axis the wall runs along. 'x' means the opening spans X. */
    axis: 'x' | 'z'
    from: number
    to: number
    /** Coordinate of the shell face this window is cut into. */
    at: number
    /** +1 when the outside is at the greater coordinate. */
    outward: 1 | -1
    region: number
    /** Navigation node an enemy joins the graph on once it is inside. */
    node: number
}

export interface CallOfXenoWindow extends WindowSpec {
    /** Where an enemy queues up before it starts tearing boards. */
    outside: { x: number, z: number }
    /** Where it lands after climbing through. */
    inside: { x: number, z: number }
    /** Centre of the opening, on the wall plane. */
    centre: { x: number, z: number }
    /** Yaw of the outward normal. */
    facing: number
}

const WINDOW_SPECS: WindowSpec[] = [
    { id: 'win-barracks-w1', axis: 'z', from: 3, to: 7, at: 0, outward: -1, region: 0, node: 0 },
    { id: 'win-barracks-w2', axis: 'z', from: 10, to: 14, at: 0, outward: -1, region: 0, node: 23 },
    { id: 'win-barracks-s1', axis: 'x', from: 10, to: 14, at: 0, outward: -1, region: 0, node: 0 },
    { id: 'win-mess-s1', axis: 'x', from: 22, to: 26, at: 0, outward: -1, region: 1, node: 3 },
    { id: 'win-mess-s2', axis: 'x', from: 28, to: 32, at: 0, outward: -1, region: 1, node: 3 },
    { id: 'win-garage-s1', axis: 'x', from: 40, to: 44, at: 0, outward: -1, region: 3, node: 5 },
    { id: 'win-garage-e1', axis: 'z', from: 6, to: 10, at: 58, outward: 1, region: 3, node: 6 },
    { id: 'win-atrium-w1', axis: 'z', from: 18, to: 22, at: 0, outward: -1, region: 2, node: 22 },
    { id: 'win-atrium-w2', axis: 'z', from: 29, to: 33, at: 0, outward: -1, region: 2, node: 31 },
    { id: 'win-workshop-e1', axis: 'z', from: 22, to: 26, at: 58, outward: 1, region: 4, node: 8 },
    { id: 'win-workshop-e2', axis: 'z', from: 29, to: 33, at: 58, outward: 1, region: 4, node: 11 },
    { id: 'win-lab-w1', axis: 'z', from: 37, to: 41, at: 0, outward: -1, region: 5, node: 18 },
    { id: 'win-lab-n1', axis: 'x', from: 5, to: 9, at: 48, outward: 1, region: 5, node: 18 },
    { id: 'win-reactor-n1', axis: 'x', from: 26, to: 30, at: 48, outward: 1, region: 6, node: 16 },
    { id: 'win-reactor-n2', axis: 'x', from: 44, to: 48, at: 48, outward: 1, region: 6, node: 12 },
    { id: 'win-reactor-e1', axis: 'z', from: 38, to: 42, at: 58, outward: 1, region: 6, node: 12 }
]

/** How far out an enemy waits, and how far in it lands. */
const WINDOW_OUTSIDE = 2.6
const WINDOW_INSIDE = 2

export const CALL_OF_XENO_WINDOWS: CallOfXenoWindow[] = WINDOW_SPECS.map((spec) => {
    const mid = (spec.from + spec.to) / 2
    const outAt = spec.at + spec.outward * WINDOW_OUTSIDE
    const inAt = spec.at - spec.outward * WINDOW_INSIDE
    const along = spec.axis === 'x'
    return {
        ...spec,
        outside: along ? { x: mid, z: outAt } : { x: outAt, z: mid },
        inside: along ? { x: mid, z: inAt } : { x: inAt, z: mid },
        centre: along ? { x: mid, z: spec.at } : { x: spec.at, z: mid },
        // Yaw such that (sin, cos) points along the outward normal.
        facing: along
            ? (spec.outward > 0 ? 0 : Math.PI)
            : (spec.outward > 0 ? Math.PI / 2 : -Math.PI / 2)
    }
})

/** Width of a window opening, shared by every one of them. */
export const CALL_OF_XENO_WINDOW_WIDTH = WINDOW_SPECS[0]!.to - WINDOW_SPECS[0]!.from

/**
 * Sideways gap between two enemies queued abreast at a window, and the gap
 * between one row of the queue and the next.
 *
 * Both are deliberately wider than the widest separation radius the sim
 * pushes bodies apart by (0.9 x the Brute's 1.5 scale = 1.35): slots that
 * sat closer than that would have the separation pass fighting the approach
 * every frame, which is the stall this queue exists to prevent.
 */
export const CALL_OF_XENO_WINDOW_SLOT_SPACING = 1.7
/** How close an enemy has to be to its slot to count as posted at it. */
export const CALL_OF_XENO_WINDOW_SLOT_RADIUS = 0.45

/**
 * Where the enemy `rank` places in a window's queue should stand. Rank 0 is
 * the breach position — the window's own `outside` point, so the enemy
 * working the boards stands exactly where it always did. Everything behind
 * it fans out two abreast in rows heading away from the wall.
 *
 * A single shared approach point is what let a pack deadlock: every body
 * steered at the same spot, and the separation pass shoved whoever reached
 * it back out of the arrival radius, so nobody ever held the post long
 * enough to prise a board off.
 */
export function windowApproachSlot(window: CallOfXenoWindow, rank: number): { x: number, z: number } {
    if (rank <= 0) return { x: window.outside.x, z: window.outside.z }
    const row = Math.ceil(rank / 2)
    const lateral = (rank % 2 === 1 ? -1 : 1) * CALL_OF_XENO_WINDOW_SLOT_SPACING
    const depth = window.outward * row * CALL_OF_XENO_WINDOW_SLOT_SPACING
    return window.axis === 'x'
        ? { x: window.outside.x + lateral, z: window.outside.z + depth }
        : { x: window.outside.x + depth, z: window.outside.z + lateral }
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

export interface CallOfXenoRegion {
    id: number
    name: string
    bounds: CallOfXenoBox
    /** Walking surface this region sits on. */
    floorY: number
    /** Absolute height of its ceiling. */
    ceiling: number
    /** Palette index into CALL_OF_XENO_ROOM_THEMES. */
    theme: number
    /** False when something else already roofs it — an upper floor, or the
     *  ceiling of the tall room it hangs inside. */
    capped: boolean
}

/** Floor and ceiling slabs. Also drives which palette each area is drawn in. */
export const CALL_OF_XENO_REGIONS: CallOfXenoRegion[] = [
    { id: 0, name: 'Barracks', bounds: { minX: 0, maxX: 18, minZ: 0, maxZ: 16 }, floorY: 0, ceiling: H, theme: 0, capped: false },
    { id: 1, name: 'Mess Hall', bounds: { minX: 18, maxX: 36, minZ: 0, maxZ: 16 }, floorY: 0, ceiling: H, theme: 0, capped: false },
    { id: 2, name: 'Atrium', bounds: { minX: 0, maxX: 36, minZ: 16, maxZ: 34 }, floorY: 0, ceiling: A, theme: 1, capped: true },
    { id: 3, name: 'Garage', bounds: { minX: 36, maxX: 58, minZ: 0, maxZ: 18 }, floorY: 0, ceiling: A, theme: 1, capped: true },
    { id: 4, name: 'Workshop', bounds: { minX: 36, maxX: 58, minZ: 18, maxZ: 34 }, floorY: 0, ceiling: H, theme: 2, capped: true },
    { id: 5, name: 'Lab', bounds: { minX: 0, maxX: 18, minZ: 34, maxZ: 48 }, floorY: 0, ceiling: H, theme: 3, capped: true },
    { id: 6, name: 'Reactor Hall', bounds: { minX: 18, maxX: 58, minZ: 34, maxZ: 48 }, floorY: 0, ceiling: A, theme: 2, capped: true },
    { id: 7, name: 'Overwatch', bounds: { minX: 0, maxX: 18, minZ: 0, maxZ: 16 }, floorY: U, ceiling: A, theme: 0, capped: true },
    { id: 8, name: 'Signals', bounds: { minX: 18, maxX: 36, minZ: 0, maxZ: 16 }, floorY: U, ceiling: A, theme: 0, capped: true },
    { id: 9, name: 'Catwalk', bounds: { minX: 0, maxX: 36, minZ: 16, maxZ: 22 }, floorY: U, ceiling: A, theme: 1, capped: false }
]

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function wall(minX: number, maxX: number, minZ: number, maxZ: number, height = H, baseY = 0): CallOfXenoSolid {
    return { box: { minX, maxX, minZ, maxZ }, baseY, height }
}

/** One face of the outer shell, split around the windows cut into it. */
function shellRun(axis: 'x' | 'z', at: number, outward: 1 | -1, from: number, to: number): CallOfXenoSolid[] {
    const out: CallOfXenoSolid[] = []
    const near = outward > 0 ? at : at - SHELL_T
    const far = outward > 0 ? at + SHELL_T : at

    const push = (lo: number, hi: number, baseY: number, height: number) => {
        if (hi - lo < 1e-6 || height < 1e-6) return
        out.push(axis === 'x'
            ? wall(lo, hi, near, far, height, baseY)
            : wall(near, far, lo, hi, height, baseY))
    }

    const here = CALL_OF_XENO_WINDOWS
        .filter(w => w.axis === axis && w.at === at)
        .sort((a, b) => a.from - b.from)

    let cursor = from
    for (const window of here) {
        push(cursor, window.from, 0, A)
        push(window.from, window.to, 0, CALL_OF_XENO_WINDOW_SILL)
        push(window.from, window.to, CALL_OF_XENO_WINDOW_HEAD, A - CALL_OF_XENO_WINDOW_HEAD)
        cursor = window.to
    }
    push(cursor, to, 0, A)
    return out
}

const SX0 = CALL_OF_XENO_SHELL.minX
const SX1 = CALL_OF_XENO_SHELL.maxX
const SZ0 = CALL_OF_XENO_SHELL.minZ
const SZ1 = CALL_OF_XENO_SHELL.maxZ

/** The unbroken outer shell, minus the window openings. */
export const CALL_OF_XENO_SHELL_WALLS: CallOfXenoSolid[] = [
    ...shellRun('z', SX0, -1, SZ0 - SHELL_T, SZ1 + SHELL_T),
    ...shellRun('z', SX1, 1, SZ0 - SHELL_T, SZ1 + SHELL_T),
    ...shellRun('x', SZ0, -1, SX0 - SHELL_T, SX1 + SHELL_T),
    ...shellRun('x', SZ1, 1, SX0 - SHELL_T, SX1 + SHELL_T)
]

/**
 * Invisible panes filling the window openings — player-only collision. A
 * running jump otherwise clears the one-metre sill and sails out through
 * the empty opening band, and the map leaks. Deliberately kept out of the
 * shared solid set: enemies script their climb through the opening without
 * consulting collision, and rays (bullets, deploy placement) keep their
 * existing line-of-sight through the boards. Only player movement unions
 * these in.
 */
export const CALL_OF_XENO_WINDOW_BARRIERS: CallOfXenoSolid[] = CALL_OF_XENO_WINDOWS.map(w => {
    const near = w.outward > 0 ? w.at : w.at - SHELL_T
    const far = w.outward > 0 ? w.at + SHELL_T : w.at
    const height = CALL_OF_XENO_WINDOW_HEAD - CALL_OF_XENO_WINDOW_SILL
    return w.axis === 'x'
        ? { box: { minX: w.from, maxX: w.to, minZ: near, maxZ: far }, baseY: CALL_OF_XENO_WINDOW_SILL, height }
        : { box: { minX: near, maxX: far, minZ: w.from, maxZ: w.to }, baseY: CALL_OF_XENO_WINDOW_SILL, height }
})

// Interior structures that get dressed up by the renderer. They stay in the
// wall list for collision; the decor entry tells the builder what to draw.
export type CallOfXenoDecorKind = 'pillar' | 'machine' | 'container' | 'truck'

export interface CallOfXenoDecor {
    box: CallOfXenoBox
    kind: CallOfXenoDecorKind
    /** Top of the prop. Pillars run to the deck they hold up. */
    height: number
    theme: number
}

export const CALL_OF_XENO_DECOR: CallOfXenoDecor[] = [
    // Barracks column.
    { box: { minX: 12.5, maxX: 13.4, minZ: 2.6, maxZ: 3.5 }, kind: 'pillar', height: H, theme: 0 },
    // The columns holding the catwalk up over the Atrium. They sit clear of
    // both flights and of the lane in from the Barracks door.
    { box: { minX: 6.6, maxX: 7.5, minZ: 21.1, maxZ: 22 }, kind: 'pillar', height: U, theme: 1 },
    { box: { minX: 10.05, maxX: 10.95, minZ: 21.1, maxZ: 22 }, kind: 'pillar', height: U, theme: 1 },
    { box: { minX: 16, maxX: 16.9, minZ: 21.1, maxZ: 22 }, kind: 'pillar', height: U, theme: 1 },
    { box: { minX: 21.6, maxX: 22.5, minZ: 21.1, maxZ: 22 }, kind: 'pillar', height: U, theme: 1 },
    { box: { minX: 26.5, maxX: 27.4, minZ: 21.1, maxZ: 22 }, kind: 'pillar', height: U, theme: 1 },
    // Garage: a flatbed and a shipping container.
    { box: { minX: 38.5, maxX: 42.5, minZ: 11.5, maxZ: 17 }, kind: 'truck', height: 2.4, theme: 1 },
    { box: { minX: 45, maxX: 53, minZ: 2.5, maxZ: 5 }, kind: 'container', height: 2.6, theme: 1 },
    // Workshop benches.
    { box: { minX: 36.5, maxX: 40, minZ: 30, maxZ: 33 }, kind: 'machine', height: 2.2, theme: 2 },
    { box: { minX: 53, maxX: 57, minZ: 25, maxZ: 28 }, kind: 'machine', height: 2.2, theme: 2 },
    // Lab bank.
    { box: { minX: 0.5, maxX: 4, minZ: 34.5, maxZ: 37.5 }, kind: 'machine', height: 2.2, theme: 3 },
    // Reactor Hall: generator banks pushed flat against the north wall so the
    // room reads as machinery without a block sticking into the fighting floor.
    { box: { minX: 21, maxX: 25, minZ: 44.5, maxZ: 47.5 }, kind: 'machine', height: 2.6, theme: 2 },
    { box: { minX: 39, maxX: 43, minZ: 44.5, maxZ: 47.5 }, kind: 'machine', height: 2.6, theme: 2 }
]

/** Static geometry. Full height unless noted, so it stops bullets too. */
export const CALL_OF_XENO_WALLS: CallOfXenoSolid[] = [
    ...CALL_OF_XENO_SHELL_WALLS,

    // Barracks | Mess Hall, at x = 18. Door opening at z 6-10.
    wall(17.75, 18.25, 0, 6),
    wall(17.75, 18.25, 10, 16.25),

    // Barracks / Mess Hall | Atrium, at z = 16. Door opening at x 6-10.
    wall(0, 6, 15.75, 16.25),
    wall(10, 36.25, 15.75, 16.25),
    // The same divider on the second floor: Overwatch / Signals | Catwalk.
    // Openings at x 4-10 and x 24-30.
    wall(0, 4, 15.75, 16.25, UH, U),
    wall(10, 24, 15.75, 16.25, UH, U),
    wall(30, 36.25, 15.75, 16.25, UH, U),

    // Overwatch | Signals, at x = 18 on the second floor. Opening at z 8-12.
    wall(17.75, 18.25, 0, 8, UH, U),
    wall(17.75, 18.25, 12, 16.25, UH, U),

    // Mess Hall / Signals | Garage, at x = 36. Door opening at z 5-9.
    wall(35.75, 36.25, 0, 5, A),
    wall(35.75, 36.25, 9, 18.25, A),
    wall(35.75, 36.25, 5, 9, A - H, H),

    // Atrium | Workshop, at x = 36. Door opening at z 23-27.
    wall(35.75, 36.25, 18, 23, A),
    wall(35.75, 36.25, 27, 34.25, A),
    wall(35.75, 36.25, 23, 27, A - H, H),

    // Garage | Workshop, at z = 18. Free opening at x 45-49.
    wall(35.75, 45, 17.75, 18.25, A),
    wall(49, 58.25, 17.75, 18.25, A),
    wall(45, 49, 17.75, 18.25, A - H, H),

    // Atrium | Lab and Atrium | Reactor Hall, at z = 34.
    // Door openings at x 5-9 and x 24-28.
    wall(0, 5, 33.75, 34.25, A),
    wall(9, 24, 33.75, 34.25, A),
    wall(28, 36.25, 33.75, 34.25, A),
    wall(5, 9, 33.75, 34.25, A - H, H),
    wall(24, 28, 33.75, 34.25, A - H, H),

    // Workshop | Reactor Hall, at z = 34. Free opening at x 45-49.
    wall(35.75, 45, 33.75, 34.25, A),
    wall(49, 58.25, 33.75, 34.25, A),
    wall(45, 49, 33.75, 34.25, A - H, H),

    // Lab | Reactor Hall, at x = 18. Free opening at z 40-44.
    wall(17.75, 18.25, 33.75, 40, A),
    wall(17.75, 18.25, 44, 48.25, A),
    wall(17.75, 18.25, 40, 44, A - H, H),

    // Catwalk edge rail, broken where each flight of stairs arrives. Low
    // enough to vault back down into the Atrium, high enough not to walk off.
    wall(5.5, 29.5, 21.8, 22.2, 1, U),
    wall(34.5, 36, 21.8, 22.2, 1, U),

    ...CALL_OF_XENO_DECOR.map(d => ({ box: d.box, baseY: 0, height: d.height }))
]

/**
 * Waist-high cover. Blocks movement but only blocks a shot low enough to hit
 * it, so you can fire over a barrier you are stood behind.
 */
export const CALL_OF_XENO_CRATES: CallOfXenoSolid[] = [
    // Barracks
    { box: { minX: 4, maxX: 6.5, minZ: 12.5, maxZ: 14.5 }, baseY: 0, height: 1.4 },
    { box: { minX: 14, maxX: 17.5, minZ: 3, maxZ: 5 }, baseY: 0, height: 1.5 },
    { box: { minX: 2.5, maxX: 4.5, minZ: 8.5, maxZ: 10.5 }, baseY: 0, height: 1.2 },
    // Mess Hall
    { box: { minX: 21, maxX: 25, minZ: 11, maxZ: 13 }, baseY: 0, height: 1 },
    { box: { minX: 28, maxX: 32, minZ: 11, maxZ: 13 }, baseY: 0, height: 1 },
    { box: { minX: 32.5, maxX: 35, minZ: 2.5, maxZ: 4.5 }, baseY: 0, height: 1.4 },
    // Atrium
    { box: { minX: 13, maxX: 16, minZ: 31.5, maxZ: 33.5 }, baseY: 0, height: 1.2 },
    { box: { minX: 21, maxX: 24, minZ: 18.5, maxZ: 20.5 }, baseY: 0, height: 1.1 },
    { box: { minX: 9, maxX: 12, minZ: 23, maxZ: 25 }, baseY: 0, height: 1.5 },
    { box: { minX: 6, maxX: 8.5, minZ: 25, maxZ: 27 }, baseY: 0, height: 1.1 },
    // Garage
    { box: { minX: 53.5, maxX: 56.5, minZ: 2.5, maxZ: 5 }, baseY: 0, height: 1.2 },
    { box: { minX: 43, maxX: 46, minZ: 12.5, maxZ: 15 }, baseY: 0, height: 1.4 },
    // Workshop
    { box: { minX: 38, maxX: 41, minZ: 20, maxZ: 22 }, baseY: 0, height: 1.1 },
    { box: { minX: 50, maxX: 53, minZ: 30.5, maxZ: 33 }, baseY: 0, height: 1.4 },
    // Lab
    { box: { minX: 3, maxX: 6, minZ: 44, maxZ: 46.5 }, baseY: 0, height: 1.2 },
    { box: { minX: 12, maxX: 15.5, minZ: 35.5, maxZ: 37.5 }, baseY: 0, height: 1.4 },
    // Reactor Hall
    { box: { minX: 29, maxX: 32, minZ: 43.5, maxZ: 45.5 }, baseY: 0, height: 1.1 },
    { box: { minX: 50, maxX: 53, minZ: 43.5, maxZ: 46 }, baseY: 0, height: 1.4 },
    { box: { minX: 52, maxX: 55, minZ: 36, maxZ: 38 }, baseY: 0, height: 1.2 },
    // Second floor
    { box: { minX: 3, maxX: 5.5, minZ: 3, maxZ: 5.5 }, baseY: U, height: 1.1 },
    { box: { minX: 13, maxX: 16, minZ: 12, maxZ: 14.5 }, baseY: U, height: 1.2 },
    { box: { minX: 20, maxX: 22.5, minZ: 3, maxZ: 5.5 }, baseY: U, height: 1.2 },
    { box: { minX: 31, maxX: 34, minZ: 12, maxZ: 14 }, baseY: U, height: 1.1 },
    { box: { minX: 23, maxX: 25.5, minZ: 16.6, maxZ: 18.2 }, baseY: U, height: 1 }
]

/** The second floor: one deck over the Barracks, the Mess and the Atrium's
 *  south strip. Solid from below, so the rooms underneath keep a ceiling. */
export const CALL_OF_XENO_PLATFORMS: CallOfXenoPlatform[] = [
    { box: { minX: 0, maxX: 36, minZ: 0, maxZ: 22 }, y: U, thickness: U - H }
]

/** Two flights out of the Atrium, one at each end of the catwalk. */
export const CALL_OF_XENO_RAMPS: CallOfXenoRamp[] = [
    {
        box: { minX: 30, maxX: 34, minZ: 22, maxZ: 30 },
        axis: 'z',
        lowAt: 30,
        lowY: 0,
        highAt: 22,
        highY: U,
        steps: 14
    },
    {
        box: { minX: 1, maxX: 5, minZ: 22, maxZ: 30 },
        axis: 'z',
        lowAt: 30,
        lowY: 0,
        highAt: 22,
        highY: U,
        steps: 14
    }
]

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

export interface CallOfXenoDoor {
    id: string
    name: string
    cost: number
    box: CallOfXenoBox
    /** Navigation edge this door blocks until bought. */
    blocks: [number, number]
    prompt: { x: number, z: number }
}

export const CALL_OF_XENO_DOORS: CallOfXenoDoor[] = [
    {
        id: 'door-barracks-mess',
        name: 'Mess Hall',
        cost: 750,
        box: { minX: 17.75, maxX: 18.25, minZ: 6, maxZ: 10 },
        blocks: [1, 2],
        prompt: { x: 18, z: 8 }
    },
    {
        id: 'door-barracks-atrium',
        name: 'Atrium',
        cost: 1000,
        box: { minX: 6, maxX: 10, minZ: 15.75, maxZ: 16.25 },
        blocks: [23, 22],
        prompt: { x: 8, z: 16 }
    },
    {
        id: 'door-mess-garage',
        name: 'Garage',
        cost: 1250,
        box: { minX: 35.75, maxX: 36.25, minZ: 5, maxZ: 9 },
        blocks: [4, 5],
        prompt: { x: 36, z: 7 }
    },
    {
        id: 'door-atrium-lab',
        name: 'Lab',
        cost: 1250,
        box: { minX: 5, maxX: 9, minZ: 33.75, maxZ: 34.25 },
        blocks: [20, 19],
        prompt: { x: 7, z: 34 }
    },
    {
        id: 'door-atrium-workshop',
        name: 'Workshop',
        cost: 1500,
        box: { minX: 35.75, maxX: 36.25, minZ: 23, maxZ: 27 },
        blocks: [10, 9],
        prompt: { x: 36, z: 25 }
    },
    {
        id: 'door-atrium-reactor',
        name: 'Reactor Hall',
        cost: 1750,
        box: { minX: 24, maxX: 28, minZ: 33.75, maxZ: 34.25 },
        blocks: [15, 14],
        prompt: { x: 26, z: 34 }
    }
]

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Navigation graph. Nodes 0-23 are the ground ring, 24-33 the two stairs and
 * the second floor. Zombies walk node to node until they share one with the
 * player, then head straight for them.
 */
export const CALL_OF_XENO_NODES: { x: number, z: number, y: number }[] = [
    { x: 9, z: 8, y: 0 },        // 0  Barracks centre
    { x: 17, z: 8, y: 0 },       // 1  Barracks side of the Mess door
    { x: 19, z: 8, y: 0 },       // 2  Mess side of the Barracks door
    { x: 27, z: 8, y: 0 },       // 3  Mess Hall centre
    { x: 35, z: 7, y: 0 },       // 4  Mess side of the Garage door
    { x: 37, z: 7, y: 0 },       // 5  Garage side of the Mess door
    { x: 47, z: 9, y: 0 },       // 6  Garage centre
    { x: 47, z: 18, y: 0 },      // 7  Garage / Workshop opening
    { x: 47, z: 26, y: 0 },      // 8  Workshop centre
    { x: 37, z: 25, y: 0 },      // 9  Workshop side of the Atrium door
    { x: 35, z: 25, y: 0 },      // 10 Atrium side of the Workshop door
    { x: 47, z: 34, y: 0 },      // 11 Workshop / Reactor opening
    { x: 48, z: 41, y: 0 },      // 12 Reactor Hall east
    { x: 36, z: 41, y: 0 },      // 13 Reactor Hall centre
    { x: 26, z: 35, y: 0 },      // 14 Reactor side of the Atrium door
    { x: 26, z: 33, y: 0 },      // 15 Atrium side of the Reactor door
    { x: 21, z: 42, y: 0 },      // 16 Reactor Hall west
    { x: 15, z: 42, y: 0 },      // 17 Lab / Reactor opening
    { x: 8, z: 41, y: 0 },       // 18 Lab centre
    { x: 7, z: 35, y: 0 },       // 19 Lab side of the Atrium door
    { x: 7, z: 33, y: 0 },       // 20 Atrium side of the Lab door
    { x: 18, z: 26, y: 0 },      // 21 Atrium centre
    { x: 8, z: 17.5, y: 0 },     // 22 Atrium side of the Barracks door
    { x: 8, z: 14.5, y: 0 },     // 23 Barracks side of the Atrium door
    { x: 32, z: 30, y: 0 },      // 24 East stair foot
    { x: 32, z: 26, y: U / 2 },  // 25 East stair middle
    { x: 32, z: 21.5, y: U },    // 26 East stair head
    { x: 7, z: 19, y: U },       // 27 Catwalk west
    { x: 28, z: 19, y: U },      // 28 Catwalk east
    { x: 9, z: 9, y: U },        // 29 Overwatch centre
    { x: 27, z: 9, y: U },       // 30 Signals centre
    { x: 3, z: 30, y: 0 },       // 31 West stair foot
    { x: 3, z: 26, y: U / 2 },   // 32 West stair middle
    { x: 3, z: 21.5, y: U }      // 33 West stair head
]

export const CALL_OF_XENO_EDGES: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10],
    [10, 21], [21, 15], [15, 14], [14, 13], [13, 12], [12, 11], [11, 8],
    [13, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21],
    [0, 23], [23, 22], [22, 21],
    [21, 24], [24, 25], [25, 26], [26, 28], [27, 28], [27, 29], [28, 30], [29, 30],
    [20, 31], [31, 32], [32, 33], [33, 27]
]

/** Where shootable explosive barrels start a run. */
export const CALL_OF_XENO_BARREL_SPOTS: { x: number, z: number }[] = [
    { x: 5, z: 11 },
    { x: 31, z: 6 },
    { x: 10, z: 28 },
    { x: 33, z: 20 },
    { x: 49, z: 13 },
    { x: 55, z: 30 },
    { x: 9, z: 46 },
    { x: 33, z: 45 },
    { x: 51, z: 43 },
    { x: 26, z: 12 }
]

// ---------------------------------------------------------------------------
// Interactables
// ---------------------------------------------------------------------------

export type CallOfXenoInteractableKind = 'wallbuy' | 'perk' | 'power' | 'papunch' | 'mysterybox' | 'workbench'

export interface CallOfXenoInteractable {
    id: string
    kind: CallOfXenoInteractableKind
    x: number
    y: number
    z: number
    /** Yaw the prop faces, in radians. */
    facing: number
    region: number
    weapon?: CallOfXenoWeaponId
    perk?: CallOfXenoPerkId
    needsPower: boolean
}

export const CALL_OF_XENO_INTERACTABLES: CallOfXenoInteractable[] = [
    // Barracks — the room you wake up in.
    { id: 'buy-skorpion', kind: 'wallbuy', x: 14, y: 0, z: 15.6, facing: Math.PI, region: 0, weapon: 'skorpion', needsPower: false },
    { id: 'perk-quickrevive', kind: 'perk', x: 3.5, y: 0, z: 0.9, facing: 0, region: 0, perk: 'quickrevive', needsPower: true },

    // Mess Hall — the first door out.
    { id: 'buy-trench', kind: 'wallbuy', x: 34, y: 0, z: 15.6, facing: Math.PI, region: 1, weapon: 'trench', needsPower: false },

    // Atrium — the only mystery box on the map. Set against the north wall
    // between the corner crate and the Reactor door, clear of both flights.
    { id: 'mysterybox', kind: 'mysterybox', x: 19, y: 0, z: 32.6, facing: Math.PI, region: 2, needsPower: false },

    // Catwalk — Juggernog is the reward for taking the high ground.
    { id: 'perk-juggernog', kind: 'perk', x: 18, y: CALL_OF_XENO_UPPER_Y, z: 17, facing: 0, region: 9, perk: 'juggernog', needsPower: true },

    // Garage and Workshop — the east wing.
    { id: 'perk-speedcola', kind: 'perk', x: 57.4, y: 0, z: 15, facing: -Math.PI / 2, region: 3, perk: 'speedcola', needsPower: true },

    // Lab — the far corner.
    { id: 'perk-doubletap', kind: 'perk', x: 14, y: 0, z: 47.6, facing: Math.PI, region: 5, perk: 'doubletap', needsPower: true },

    // Workshop — the deployable-equipment bench.
    { id: 'workbench', kind: 'workbench', x: 56.6, y: 0, z: 20.8, facing: -Math.PI / 2, region: 4, needsPower: false },

    // Reactor Hall — power, Pack-a-Punch and the last wall gun.
    { id: 'buy-ak74', kind: 'wallbuy', x: 36, y: 0, z: 47.6, facing: Math.PI, region: 6, weapon: 'ak74', needsPower: false },
    { id: 'power', kind: 'power', x: 57.4, y: 0, z: 44, facing: -Math.PI / 2, region: 6, needsPower: false },
    { id: 'papunch', kind: 'papunch', x: 22, y: 0, z: 38, facing: Math.PI / 2, region: 6, needsPower: true }
]

export const CALL_OF_XENO_PLAYER_START = { x: 9, z: 11 }

/** Free-standing props the player cannot walk through. */
export const CALL_OF_XENO_PROP_SOLIDS: CallOfXenoSolid[] = CALL_OF_XENO_INTERACTABLES
    .filter(i => i.kind === 'perk' || i.kind === 'papunch' || i.kind === 'power' || i.kind === 'mysterybox' || i.kind === 'workbench')
    .map(i => ({
        box: {
            minX: i.x - (i.kind === 'papunch' ? 1.25 : i.kind === 'workbench' ? 0.85 : 0.6),
            maxX: i.x + (i.kind === 'papunch' ? 1.25 : i.kind === 'workbench' ? 0.85 : 0.6),
            minZ: i.z - (i.kind === 'workbench' ? 0.55 : 0.6),
            maxZ: i.z + (i.kind === 'workbench' ? 0.55 : 0.6)
        },
        baseY: i.y,
        height: i.kind === 'papunch' ? 2 : i.kind === 'mysterybox' ? 1.2 : i.kind === 'workbench' ? 1.2 : 2.2
    }))

// ---------------------------------------------------------------------------
// Geometry queries
// ---------------------------------------------------------------------------

/**
 * Which region a position sits in, or -1 if it is outside every one. Regions
 * stack now, so the height picks the storey: the highest floor at or below
 * `y` wins.
 */
export function regionAt(x: number, z: number, y = 0): number {
    let best = -1
    let bestFloor = -Infinity
    for (const region of CALL_OF_XENO_REGIONS) {
        const b = region.bounds
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue
        if (region.floorY > y + CALL_OF_XENO_STEP_UP) continue
        if (region.floorY <= bestFloor) continue
        bestFloor = region.floorY
        best = region.id
    }
    return best
}

function inside(box: CallOfXenoBox, x: number, z: number) {
    return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ
}

/**
 * The surface an actor at (x, z) should be standing on. Only surfaces at or
 * slightly above their current feet count, so walking off the platform drops
 * you rather than teleporting you up.
 */
export function groundHeight(x: number, z: number, feetY: number): number {
    const reach = feetY + CALL_OF_XENO_STEP_UP
    let best = 0

    for (const platform of CALL_OF_XENO_PLATFORMS) {
        if (!inside(platform.box, x, z)) continue
        if (platform.y <= reach && platform.y > best) best = platform.y
    }

    for (const ramp of CALL_OF_XENO_RAMPS) {
        if (!inside(ramp.box, x, z)) continue
        const at = ramp.axis === 'x' ? x : z
        const t = (at - ramp.lowAt) / (ramp.highAt - ramp.lowAt)
        const y = ramp.lowY + (ramp.highY - ramp.lowY) * Math.max(0, Math.min(1, t))
        if (y <= reach && y > best) best = y
    }

    for (const crate of CALL_OF_XENO_CRATES) {
        if (!inside(crate.box, x, z)) continue
        const top = crate.baseY + crate.height
        if (top <= reach && top > best) best = top
    }

    return best
}

/**
 * Height of the stair surface at a point, or null when no flight covers it.
 * Unlike `groundHeight` this reports the slope regardless of whether a body
 * standing on the floor could actually step up onto it — the navigation grid
 * needs the true surface to decide which storey a ramp cell belongs to.
 */
export function rampSurfaceAt(x: number, z: number): number | null {
    for (const ramp of CALL_OF_XENO_RAMPS) {
        if (!inside(ramp.box, x, z)) continue
        const at = ramp.axis === 'x' ? x : z
        const t = (at - ramp.lowAt) / (ramp.highAt - ramp.lowAt)
        return ramp.lowY + (ramp.highY - ramp.lowY) * Math.max(0, Math.min(1, t))
    }
    return null
}

/**
 * How far off the edge of a flight a body still counts as being on it. The
 * pack can shove a climber this far sideways in a single frame, and it has to
 * still be recognised as belonging to the stairs to be put back on them.
 */
const RAMP_EDGE_GRACE = 0.6

/**
 * The flight a body is currently climbing, or null when it is not on one.
 *
 * Height is what decides it: a body inside a flight's footprint but down on
 * the floor underneath is not on the stairs, and one shoved just off the edge
 * still is. The flights carry no side walls, so this is what lets the sim put
 * a climber back on the steps instead of letting the pack push it into
 * mid-air, where it drops to the floor and has to walk all the way round
 * again.
 */
export function rampUnderBody(x: number, z: number, y: number): CallOfXenoRamp | null {
    for (const ramp of CALL_OF_XENO_RAMPS) {
        const lateralLow = ramp.axis === 'z' ? ramp.box.minX : ramp.box.minZ
        const lateralHigh = ramp.axis === 'z' ? ramp.box.maxX : ramp.box.maxZ
        const lateral = ramp.axis === 'z' ? x : z
        if (lateral <= lateralLow - RAMP_EDGE_GRACE || lateral >= lateralHigh + RAMP_EDGE_GRACE) continue
        const alongLow = ramp.axis === 'z' ? ramp.box.minZ : ramp.box.minX
        const alongHigh = ramp.axis === 'z' ? ramp.box.maxZ : ramp.box.maxX
        const along = ramp.axis === 'z' ? z : x
        if (along <= alongLow || along >= alongHigh) continue
        const t = (along - ramp.lowAt) / (ramp.highAt - ramp.lowAt)
        const surface = ramp.lowY + (ramp.highY - ramp.lowY) * Math.max(0, Math.min(1, t))
        if (Math.abs(y - surface) > CALL_OF_XENO_STEP_UP) continue
        return ramp
    }
    return null
}

/**
 * Whether a body may tick off a waypoint it has walked up to.
 *
 * Anywhere but the stairs, arriving is arriving. On a flight it is not: a
 * body heading for the foot retires that waypoint while still short of it,
 * out on the floor inside the footprint where the steps are already too high
 * to mount, and turns for the next waypoint up the flight. It walks into the
 * dead ground under the stairs, the next replan sends it back to the foot,
 * and it shuttles between the two forever — the body circling the bottom of
 * the stairs, never getting on them. A step of the flight only counts as
 * reached once the body is actually standing on the flight.
 */
export function waypointFootingOk(
    bodyX: number, bodyZ: number, bodyY: number,
    waypointX: number, waypointZ: number
): boolean {
    if (rampSurfaceAt(waypointX, waypointZ) === null) return true
    return rampUnderBody(bodyX, bodyZ, bodyY) !== null
}

/** Everything solid right now, including shut doors and any live extras. */
export function collisionSolids(openDoors: ReadonlySet<string>, extra: readonly CallOfXenoSolid[] = []): CallOfXenoSolid[] {
    return [
        ...CALL_OF_XENO_WALLS,
        ...CALL_OF_XENO_CRATES,
        ...CALL_OF_XENO_PROP_SOLIDS,
        ...CALL_OF_XENO_PLATFORMS.map(p => ({
            box: p.box,
            baseY: p.y - p.thickness,
            height: p.thickness
        })),
        ...CALL_OF_XENO_DOORS
            .filter(d => !openDoors.has(d.id))
            .map(d => ({ box: d.box, baseY: 0, height: CALL_OF_XENO_ATRIUM_HEIGHT })),
        ...extra
    ]
}

/**
 * The subset of solids an actor can actually walk into: those whose vertical
 * band overlaps the band their body occupies. This is what lets you stand on
 * the platform without the crates underneath it blocking you.
 */
export function solidsInBand(solids: readonly CallOfXenoSolid[], feetY: number, bodyHeight: number): CallOfXenoBox[] {
    const headY = feetY + bodyHeight
    const boxes: CallOfXenoBox[] = []
    for (const solid of solids) {
        const top = solid.baseY + solid.height
        // Anything low enough to step onto is floor, not wall — this is what
        // lets an actor walk off the top of a ramp onto the deck instead of
        // being stopped by the deck's own collision box.
        if (top <= feetY + CALL_OF_XENO_STEP_UP) continue
        // Anything starting above head height is something to walk under.
        if (solid.baseY >= headY) continue
        boxes.push(solid.box)
    }
    return boxes
}

export interface CallOfXenoRayHit {
    distance: number
    nx: number
    ny: number
    nz: number
}

/**
 * Distance along a ray to the nearest solid, with the face normal. The slab
 * test covers the vertical band for free, so a level shot passes over a crate
 * and under the platform without any special casing.
 */
export function rayBlockDistance(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    solids: readonly CallOfXenoSolid[],
    max: number
): CallOfXenoRayHit {
    let best = max
    let nx = 0
    let ny = 0
    let nz = 0

    for (const solid of solids) {
        const lo = [solid.box.minX, solid.baseY, solid.box.minZ]
        const hi = [solid.box.maxX, solid.baseY + solid.height, solid.box.maxZ]
        const origin = [ox, oy, oz]
        const dir = [dx, dy, dz]

        let tMin = 0
        let tMax = best
        let axis = -1
        let sign = 1
        let miss = false

        for (let a = 0; a < 3; a++) {
            const o = origin[a]!
            const d = dir[a]!
            if (Math.abs(d) < 1e-8) {
                if (o < lo[a]! || o > hi[a]!) { miss = true; break }
                continue
            }
            let t1 = (lo[a]! - o) / d
            let t2 = (hi[a]! - o) / d
            let enterSign = -1
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; enterSign = 1 }
            if (t1 > tMin) { tMin = t1; axis = a; sign = enterSign }
            if (t2 < tMax) tMax = t2
            if (tMin > tMax) { miss = true; break }
        }

        if (miss || axis === -1 || tMin >= best) continue
        best = tMin
        nx = axis === 0 ? sign : 0
        ny = axis === 1 ? sign : 0
        nz = axis === 2 ? sign : 0
    }

    return { distance: best, nx, ny, nz }
}

/**
 * Pushes a circle out of any box it overlaps, along the shallowest axis.
 */
export function resolveCircle(x: number, z: number, radius: number, boxes: readonly CallOfXenoBox[]): { x: number, z: number } {
    let px = x
    let pz = z
    for (const box of boxes) {
        const closestX = Math.max(box.minX, Math.min(px, box.maxX))
        const closestZ = Math.max(box.minZ, Math.min(pz, box.maxZ))
        const dx = px - closestX
        const dz = pz - closestZ
        const distSq = dx * dx + dz * dz
        if (distSq >= radius * radius) continue

        if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq)
            px = closestX + (dx / dist) * radius
            pz = closestZ + (dz / dist) * radius
            continue
        }

        const left = px - box.minX
        const right = box.maxX - px
        const up = pz - box.minZ
        const down = box.maxZ - pz
        const min = Math.min(left, right, up, down)
        if (min === left) px = box.minX - radius
        else if (min === right) px = box.maxX + radius
        else if (min === up) pz = box.minZ - radius
        else pz = box.maxZ + radius
    }
    return { x: px, z: pz }
}

// ---------------------------------------------------------------------------
// Pathing
// ---------------------------------------------------------------------------

/**
 * Next-hop table for the current door state. `table[from * n + to]` is the node
 * to walk to next, or -1 when there is no route. Rebuilt whenever a door opens,
 * which is a handful of times a run.
 */
export function buildNavTable(openDoors: ReadonlySet<string>): Int8Array {
    const n = CALL_OF_XENO_NODES.length
    const blocked = new Set<string>()
    for (const door of CALL_OF_XENO_DOORS) {
        if (openDoors.has(door.id)) continue
        blocked.add(`${door.blocks[0]}:${door.blocks[1]}`)
        blocked.add(`${door.blocks[1]}:${door.blocks[0]}`)
    }

    const neighbours: number[][] = Array.from({ length: n }, () => [])
    for (const [a, b] of CALL_OF_XENO_EDGES) {
        if (blocked.has(`${a}:${b}`)) continue
        neighbours[a]!.push(b)
        neighbours[b]!.push(a)
    }

    const table = new Int8Array(n * n).fill(-1)
    for (let source = 0; source < n; source++) {
        // Breadth-first from `source`, recording the first step of every route.
        const firstStep = new Int8Array(n).fill(-1)
        const queue: number[] = [source]
        const seen = new Uint8Array(n)
        seen[source] = 1
        while (queue.length > 0) {
            const current = queue.shift()!
            for (const next of neighbours[current]!) {
                if (seen[next]) continue
                seen[next] = 1
                firstStep[next] = current === source ? next : firstStep[current]!
                queue.push(next)
            }
        }
        for (let target = 0; target < n; target++) {
            table[source * n + target] = firstStep[target]!
        }
    }
    return table
}

/** Node to walk to next when travelling from `from` to `to`, or -1. */
export function nextHop(table: Int8Array, from: number, to: number): number {
    if (from === to) return to
    const n = CALL_OF_XENO_NODES.length
    return table[from * n + to] ?? -1
}

/**
 * Nearest navigation node. Height is weighted heavily so an actor under the
 * catwalk does not latch onto a node above its head. Nodes inside `banned`
 * are skipped — the game passes every node that sits inside a shut door's
 * footprint, so an actor pressing against a locked door cannot snap to the
 * node on the far side and "reach" rooms it has no way into.
 */
export function nearestNode(x: number, z: number, y: number, banned?: ReadonlySet<number>): number {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
        if (banned?.has(i)) continue
        const node = CALL_OF_XENO_NODES[i]!
        const dy = (node.y - y) * 6
        const dist = (node.x - x) ** 2 + (node.z - z) ** 2 + dy * dy
        if (dist < bestDist) {
            bestDist = dist
            best = i
        }
    }
    return best
}

/**
 * Node ids that sit inside a door that is still shut. Nothing can legally
 * stand there — the door is solid — so pathing must never route through them.
 */
export function bannedNodesFor(openDoors: ReadonlySet<string>): Set<number> {
    const banned = new Set<number>()
    for (const door of CALL_OF_XENO_DOORS) {
        if (openDoors.has(door.id)) continue
        CALL_OF_XENO_NODES.forEach((node, i) => {
            if (node.x >= door.box.minX && node.x <= door.box.maxX
                && node.z >= door.box.minZ && node.z <= door.box.maxZ) {
                banned.add(i)
            }
        })
    }
    return banned
}

/** Nodes a zombie could reach the player from, given the doors bought so far. */
export function reachableNodes(table: Int8Array, playerNode: number): Set<number> {
    const reached = new Set<number>([playerNode])
    for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
        if (nextHop(table, i, playerNode) !== -1) reached.add(i)
    }
    return reached
}

/** The windows enemies may currently use, given where the player can be got at. */
export function reachableWindows(table: Int8Array, playerNode: number): CallOfXenoWindow[] {
    const reached = reachableNodes(table, playerNode)
    return CALL_OF_XENO_WINDOWS.filter(w => reached.has(w.node))
}

/**
 * Where a zombie should head right now: the player once they share a node,
 * otherwise the next waypoint along the route.
 */
export function zombieTarget(
    table: Int8Array,
    zx: number, zz: number, zy: number,
    playerX: number, playerZ: number, playerY: number,
    banned?: ReadonlySet<number>
): { x: number, z: number } {
    const here = nearestNode(zx, zz, zy, banned)
    const there = nearestNode(playerX, playerZ, playerY, banned)
    if (here === there) return { x: playerX, z: playerZ }
    const step = nextHop(table, here, there)
    if (step === -1) return { x: playerX, z: playerZ }
    const node = CALL_OF_XENO_NODES[step]!
    return { x: node.x, z: node.z }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Look and lighting per area. Deliberately desaturated: worn concrete, painted
 * steel and dirty plaster, lit by tungsten and cold strip lights. Nothing on
 * the map itself glows — the only saturated colours in the world belong to
 * gameplay props the player has to be able to pick out at a glance.
 */
export interface CallOfXenoRoomTheme {
    floor: [string, string, string]
    wall: [string, string, string]
    ceiling: [string, string]
    lightColor: number
    accent: number
}

export const CALL_OF_XENO_ROOM_THEMES: CallOfXenoRoomTheme[] = [
    {
        // Barracks and the rooms above it: plaster over brick, warm bulbs.
        floor: ['#3a3630', '#443f38', '#524c43'],
        wall: ['#4a4740', '#535046', '#615c52'],
        ceiling: ['#26241f', '#2e2b26'],
        lightColor: 0xffe3ba,
        accent: 0x6d6961
    },
    {
        // Atrium and Garage: bare poured concrete.
        floor: ['#3b3d3e', '#464849', '#54575a'],
        wall: ['#4c4e50', '#545658', '#63666a'],
        ceiling: ['#232527', '#2b2d2f'],
        lightColor: 0xfff0d8,
        accent: 0x74777a
    },
    {
        // Workshop and Reactor Hall: painted steel gone to rust.
        floor: ['#35322e', '#403d38', '#4d4942'],
        wall: ['#464340', '#4f4c46', '#5d584f'],
        ceiling: ['#212020', '#292827'],
        lightColor: 0xffe8c6,
        accent: 0x7d6a52
    },
    {
        // Lab: cold grey tile under fluorescents.
        floor: ['#383b3d', '#434749', '#515659'],
        wall: ['#4a4d4f', '#525557', '#5f6467'],
        ceiling: ['#212426', '#282c2e'],
        lightColor: 0xeef3fa,
        accent: 0x767c80
    }
]
