// Call of Xeno — level layout ("Outpost 13").
//
// Classic zombies progression: a Barracks spawn room with two ways out —
// east into the Courtyard hub or north into the Armory. The Courtyard is the
// big room: a raised firing platform in the middle with ramps on both sides,
// the mystery box and Juggernog. From there doors lead south to the Lab and
// east to the Power Room, and the Lab connects back to the Armory, so all
// five doors bought leaves a full loop for kiting.
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
}

export const CALL_OF_XENO_WALL_HEIGHT = 4.2
/** The Courtyard is the tall room; everything else is corridor height. */
export const CALL_OF_XENO_ATRIUM_HEIGHT = 8
/** Height of the Courtyard firing platform. */
export const CALL_OF_XENO_CATWALK_Y = 2.2
/** How high a step the player and zombies can walk up without jumping. */
export const CALL_OF_XENO_STEP_UP = 0.65

export interface CallOfXenoSpawnPoint {
    x: number
    z: number
    /** Navigation node this spawn sits on, used for reachability. */
    node: number
}

export interface CallOfXenoRegion {
    id: number
    name: string
    bounds: CallOfXenoBox
    ceiling: number
    /** Palette index into CALL_OF_XENO_ROOM_THEMES. */
    theme: number
}

/** Floor and ceiling slabs. Also drives which palette each area is drawn in. */
export const CALL_OF_XENO_REGIONS: CallOfXenoRegion[] = [
    { id: 0, name: 'Barracks', bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 14 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 1, name: 'Corridor A', bounds: { minX: 16, maxX: 22, minZ: 5, maxZ: 9 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 2, name: 'Courtyard', bounds: { minX: 22, maxX: 52, minZ: 0, maxZ: 26 }, ceiling: CALL_OF_XENO_ATRIUM_HEIGHT, theme: 1 },
    { id: 3, name: 'Corridor B', bounds: { minX: 6, maxX: 10, minZ: 14, maxZ: 20 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 4, name: 'Armory', bounds: { minX: 0, maxX: 16, minZ: 20, maxZ: 36 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 5, name: 'Corridor C', bounds: { minX: 12, maxX: 26, minZ: 36, maxZ: 40 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 6, name: 'Lab', bounds: { minX: 26, maxX: 46, minZ: 34, maxZ: 50 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 3 },
    { id: 7, name: 'Corridor D', bounds: { minX: 34, maxX: 38, minZ: 26, maxZ: 34 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 1 },
    { id: 8, name: 'Corridor E', bounds: { minX: 52, maxX: 58, minZ: 6, maxZ: 10 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 9, name: 'Power Room', bounds: { minX: 58, maxX: 74, minZ: 0, maxZ: 18 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 }
]

const H = CALL_OF_XENO_WALL_HEIGHT
const A = CALL_OF_XENO_ATRIUM_HEIGHT

function wall(minX: number, maxX: number, minZ: number, maxZ: number, height = H): CallOfXenoSolid {
    return { box: { minX, maxX, minZ, maxZ }, baseY: 0, height }
}

// Interior structures that get dressed up by the renderer. They stay in the
// wall list for collision; the decor entry tells the builder what to draw.
const PILLAR_BARRACKS = wall(12.5, 13.5, 2.5, 3.5)
const PILLAR_ARMORY = wall(11.5, 12.5, 26.5, 27.5)
const PILLAR_COURTYARD_W = wall(23.5, 24.5, 25, 26)
const PILLAR_COURTYARD_E = wall(50.5, 51.5, 24, 25)
const MACHINE_A = wall(60, 62, 2, 7)
const MACHINE_B = wall(70, 72, 2, 7)
const REACTOR = wall(63, 69, 6, 12)

export type CallOfXenoDecorKind = 'pillar' | 'machine' | 'reactor'

export interface CallOfXenoDecor {
    box: CallOfXenoBox
    kind: CallOfXenoDecorKind
    theme: number
}

export const CALL_OF_XENO_DECOR: CallOfXenoDecor[] = [
    { box: PILLAR_BARRACKS.box, kind: 'pillar', theme: 0 },
    { box: PILLAR_ARMORY.box, kind: 'pillar', theme: 2 },
    { box: PILLAR_COURTYARD_W.box, kind: 'pillar', theme: 1 },
    { box: PILLAR_COURTYARD_E.box, kind: 'pillar', theme: 1 },
    { box: MACHINE_A.box, kind: 'machine', theme: 2 },
    { box: MACHINE_B.box, kind: 'machine', theme: 2 },
    { box: REACTOR.box, kind: 'reactor', theme: 2 }
]

/** Static geometry. Full height unless noted, so it stops bullets too. */
export const CALL_OF_XENO_WALLS: CallOfXenoSolid[] = [
    // Barracks: gap east at z 5-9 (corridor A), gap north at x 6-10 (corridor B).
    wall(-0.5, 16.5, -0.5, 0),
    wall(-0.5, 0, -0.5, 14.5),
    wall(-0.5, 6, 14, 14.5),
    wall(10, 16.5, 14, 14.5),
    wall(16, 16.5, -0.5, 5),
    wall(16, 16.5, 9, 14.5),
    PILLAR_BARRACKS,

    // Corridor A (Barracks -> Courtyard).
    wall(16, 22, 4.5, 5),
    wall(16, 22, 9, 9.5),

    // Courtyard atrium: gaps west z 5-9, north x 34-38 (corridor D), east z 6-10 (corridor E).
    wall(21.5, 52.5, -0.5, 0, A),
    wall(21.5, 22, -0.5, 5, A),
    wall(21.5, 22, 9, 26.5, A),
    wall(21.5, 34, 26, 26.5, A),
    wall(38, 52.5, 26, 26.5, A),
    wall(52, 52.5, -0.5, 6, A),
    wall(52, 52.5, 10, 26.5, A),
    PILLAR_COURTYARD_W,
    PILLAR_COURTYARD_E,

    // Corridor B (Barracks -> Armory).
    wall(5.5, 6, 14, 20.5),
    wall(10, 10.5, 14, 20.5),

    // Armory: gap south x 6-10 (corridor B), gap north x 12-16 (corridor C).
    wall(-0.5, 0, 19.5, 36.5),
    wall(-0.5, 6, 20, 20.5),
    wall(10, 16.5, 20, 20.5),
    wall(16, 16.5, 19.5, 36.5),
    wall(-0.5, 12, 36, 36.5),
    wall(16, 16.5, 36, 36.5),
    PILLAR_ARMORY,

    // Corridor C (Armory -> Lab). The south side is sealed against the void
    // between the Armory and the Lab; the Lab's own west wall carries the gap.
    wall(11.5, 12, 36, 40.5),
    wall(16.5, 25.5, 35.5, 36),
    wall(11.5, 26, 40, 40.5),

    // Lab: gaps west z 36-40 (corridor C), north x 34-38 (corridor D).
    wall(25.5, 26, 33.5, 36),
    wall(25.5, 26, 40, 50.5),
    wall(25.5, 34, 33.5, 34),
    wall(38, 46.5, 33.5, 34),
    wall(46, 46.5, 33.5, 50.5),
    wall(25.5, 46.5, 50, 50.5),

    // Corridor D (Courtyard -> Lab).
    wall(33.5, 34, 26, 34),
    wall(38, 38.5, 26, 34),

    // Corridor E (Courtyard -> Power).
    wall(52, 58, 5.5, 6),
    wall(52, 58, 10, 10.5),

    // Power Room: gap west z 6-10 (corridor E).
    wall(57.5, 74.5, -0.5, 0),
    wall(57.5, 58, -0.5, 6),
    wall(57.5, 58, 10, 18.5),
    wall(57.5, 74.5, 18, 18.5),
    wall(74, 74.5, -0.5, 18.5),
    MACHINE_A,
    MACHINE_B,
    REACTOR
]

/**
 * Waist-high cover. Blocks movement but only blocks a shot low enough to hit
 * it, so you can fire over a barrier you are stood behind.
 */
export const CALL_OF_XENO_CRATES: CallOfXenoSolid[] = [
    // Barracks
    { box: { minX: 4, maxX: 6, minZ: 4, maxZ: 6 }, baseY: 0, height: 1.2 },
    { box: { minX: 12, maxX: 15, minZ: 10, maxZ: 12 }, baseY: 0, height: 1.5 },
    // Courtyard — barriers flank the south ramp, crates dress the corners.
    { box: { minX: 30, maxX: 32.8, minZ: 17, maxZ: 19 }, baseY: 0, height: 1.1 },
    { box: { minX: 41, maxX: 44, minZ: 17, maxZ: 19 }, baseY: 0, height: 1.1 },
    { box: { minX: 44.5, maxX: 46.5, minZ: 10, maxZ: 12 }, baseY: 0, height: 1.2 },
    { box: { minX: 25, maxX: 27, minZ: 15, maxZ: 17 }, baseY: 0, height: 1.2 },
    { box: { minX: 48, maxX: 50, minZ: 23, maxZ: 25 }, baseY: 0, height: 1.1 },
    // Armory
    { box: { minX: 3, maxX: 5, minZ: 24, maxZ: 26 }, baseY: 0, height: 1.1 },
    { box: { minX: 12, maxX: 14, minZ: 30, maxZ: 32 }, baseY: 0, height: 1.2 },
    // Lab
    { box: { minX: 29.5, maxX: 31.5, minZ: 42, maxZ: 44 }, baseY: 0, height: 1.1 },
    { box: { minX: 39, maxX: 41, minZ: 42, maxZ: 44 }, baseY: 0, height: 1.2 },
    // Power Room
    { box: { minX: 72.5, maxX: 74, minZ: 14, maxZ: 16 }, baseY: 0, height: 1.1 }
]

/** The Courtyard firing platform, with a ramp on its north and south sides. */
export const CALL_OF_XENO_PLATFORMS: CallOfXenoPlatform[] = [
    { box: { minX: 33, maxX: 41, minZ: 9, maxZ: 15 }, y: CALL_OF_XENO_CATWALK_Y, thickness: 0.3 }
]

export const CALL_OF_XENO_RAMPS: CallOfXenoRamp[] = [
    {
        box: { minX: 34, maxX: 40, minZ: 5, maxZ: 9 },
        axis: 'z',
        lowAt: 5,
        lowY: 0,
        highAt: 9,
        highY: CALL_OF_XENO_CATWALK_Y
    },
    {
        box: { minX: 34, maxX: 40, minZ: 15, maxZ: 19 },
        axis: 'z',
        lowAt: 19,
        lowY: 0,
        highAt: 15,
        highY: CALL_OF_XENO_CATWALK_Y
    }
]

export interface CallOfXenoDoor {
    id: string
    cost: number
    box: CallOfXenoBox
    /** Navigation edge this door blocks until bought. */
    blocks: [number, number]
    prompt: { x: number, z: number }
}

export const CALL_OF_XENO_DOORS: CallOfXenoDoor[] = [
    {
        id: 'door-barracks-courtyard',
        cost: 750,
        box: { minX: 18.5, maxX: 19.5, minZ: 5, maxZ: 9 },
        blocks: [0, 1],
        prompt: { x: 19, z: 7 }
    },
    {
        id: 'door-barracks-armory',
        cost: 1000,
        box: { minX: 6, maxX: 10, minZ: 16.5, maxZ: 17.5 },
        blocks: [0, 15],
        prompt: { x: 8, z: 17 }
    },
    {
        id: 'door-armory-lab',
        cost: 1250,
        box: { minX: 20.5, maxX: 21.5, minZ: 36, maxZ: 40 },
        blocks: [11, 12],
        prompt: { x: 21, z: 38 }
    },
    {
        id: 'door-courtyard-lab',
        cost: 1500,
        box: { minX: 34, maxX: 38, minZ: 29.5, maxZ: 30.5 },
        blocks: [4, 7],
        prompt: { x: 36, z: 30 }
    },
    {
        id: 'door-courtyard-power',
        cost: 1750,
        box: { minX: 54.5, maxX: 55.5, minZ: 6, maxZ: 10 },
        blocks: [5, 16],
        prompt: { x: 55, z: 8 }
    }
]

/**
 * Navigation graph. Nodes 0-17 are the ground loop and its branches, 18-20
 * the Courtyard platform and its two ramps. Zombies walk node to node until
 * they share one with the player, then head straight for them.
 */
export const CALL_OF_XENO_NODES: { x: number, z: number, y: number }[] = [
    { x: 8, z: 7, y: 0 },                              // 0  Barracks centre
    { x: 19, z: 7, y: 0 },                             // 1  Corridor A
    { x: 25, z: 7, y: 0 },                             // 2  Courtyard west mouth
    { x: 37, z: 4, y: 0 },                             // 3  Courtyard north lane
    { x: 37, z: 21, y: 0 },                            // 4  Courtyard south lane
    { x: 49, z: 7, y: 0 },                             // 5  Courtyard east mouth
    { x: 44, z: 21, y: 0 },                            // 6  Courtyard south-east
    { x: 36, z: 30, y: 0 },                            // 7  Corridor D
    { x: 36, z: 38, y: 0 },                            // 8  Lab north
    { x: 36, z: 45, y: 0 },                            // 9  Lab centre
    { x: 29, z: 38, y: 0 },                            // 10 Lab west mouth
    { x: 21, z: 38, y: 0 },                            // 11 Corridor C east
    { x: 14, z: 38, y: 0 },                            // 12 Corridor C west
    { x: 8, z: 28, y: 0 },                             // 13 Armory centre
    { x: 8, z: 22, y: 0 },                             // 14 Armory south mouth
    { x: 8, z: 17, y: 0 },                             // 15 Corridor B
    { x: 55, z: 8, y: 0 },                             // 16 Corridor E
    { x: 62, z: 8, y: 0 },                             // 17 Power Room centre
    { x: 37, z: 7, y: 1.1 },                              // 18 North ramp mid-way
    { x: 37, z: 12, y: CALL_OF_XENO_CATWALK_Y },       // 19 Platform top
    { x: 37, z: 17.5, y: 0.825 }                       // 20 South ramp mid-way
]

export const CALL_OF_XENO_EDGES: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 5], [5, 6], [6, 4], [4, 2], [4, 7],
    [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 0],
    [5, 16], [16, 17],
    [3, 18], [18, 19], [19, 20], [20, 4]
]

export const CALL_OF_XENO_SPAWNS: CallOfXenoSpawnPoint[] = [
    { x: 2, z: 2, node: 0 },
    { x: 14, z: 22, node: 14 },
    { x: 2, z: 34, node: 13 },
    { x: 26, z: 23, node: 4 },
    { x: 50, z: 2, node: 3 },
    { x: 28, z: 47, node: 9 },
    { x: 72, z: 15, node: 17 },
    { x: 60, z: 16, node: 17 }
]

/** Where shootable explosive barrels start a run. */
export const CALL_OF_XENO_BARREL_SPOTS: { x: number, z: number }[] = [
    { x: 27, z: 3 },
    { x: 46, z: 23 },
    { x: 44, z: 4 },
    { x: 10, z: 25 },
    { x: 30, z: 47 },
    { x: 66, z: 15 },
    { x: 66, z: 3 }
]

export type CallOfXenoInteractableKind = 'wallbuy' | 'perk' | 'power' | 'papunch' | 'mysterybox'

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
    // Barracks — the cheap way out.
    { id: 'buy-skorpion', kind: 'wallbuy', x: 0.4, y: 0, z: 7, facing: Math.PI / 2, region: 0, weapon: 'skorpion', needsPower: false },
    { id: 'perk-quickrevive', kind: 'perk', x: 3, y: 0, z: 13.2, facing: Math.PI, region: 0, perk: 'quickrevive', needsPower: true },

    // Courtyard — the reward room.
    { id: 'buy-trench', kind: 'wallbuy', x: 37, y: 0, z: 0.4, facing: 0, region: 2, weapon: 'trench', needsPower: false },
    { id: 'buy-ak74', kind: 'wallbuy', x: 51.6, y: 0, z: 20, facing: -Math.PI / 2, region: 2, weapon: 'ak74', needsPower: false },
    { id: 'mysterybox', kind: 'mysterybox', x: 24.5, y: 0, z: 22.5, facing: -Math.PI / 2, region: 2, needsPower: false },
    { id: 'perk-juggernog', kind: 'perk', x: 34.5, y: CALL_OF_XENO_CATWALK_Y, z: 12, facing: -Math.PI / 2, region: 2, perk: 'juggernog', needsPower: true },

    // Armory — the gun room.
    { id: 'buy-magnum', kind: 'wallbuy', x: 0.4, y: 0, z: 28, facing: Math.PI / 2, region: 4, weapon: 'magnum', needsPower: false },
    { id: 'buy-bar', kind: 'wallbuy', x: 8, y: 0, z: 35.6, facing: Math.PI, region: 4, weapon: 'bar', needsPower: false },
    { id: 'perk-doubletap', kind: 'perk', x: 15.5, y: 0, z: 24, facing: -Math.PI / 2, region: 4, perk: 'doubletap', needsPower: true },

    // Lab — the far side of the loop.
    { id: 'buy-mp40', kind: 'wallbuy', x: 36, y: 0, z: 49.4, facing: Math.PI, region: 6, weapon: 'mp40', needsPower: false },
    { id: 'buy-rpk', kind: 'wallbuy', x: 45.6, y: 0, z: 42, facing: -Math.PI / 2, region: 6, weapon: 'rpk', needsPower: false },
    { id: 'perk-speedcola', kind: 'perk', x: 42, y: 0, z: 49.4, facing: Math.PI, region: 6, perk: 'speedcola', needsPower: true },

    // Power Room — the end of the road.
    { id: 'power', kind: 'power', x: 73.4, y: 0, z: 9, facing: -Math.PI / 2, region: 9, needsPower: false },
    { id: 'papunch', kind: 'papunch', x: 70, y: 0, z: 17.4, facing: Math.PI, region: 9, needsPower: true }
]

export const CALL_OF_XENO_PLAYER_START = { x: 9, z: 11 }

/** Free-standing props the player cannot walk through. */
export const CALL_OF_XENO_PROP_SOLIDS: CallOfXenoSolid[] = CALL_OF_XENO_INTERACTABLES
    .filter(i => i.kind === 'perk' || i.kind === 'papunch' || i.kind === 'power' || i.kind === 'mysterybox')
    .map(i => ({
        box: {
            minX: i.x - (i.kind === 'papunch' ? 1.25 : 0.6),
            maxX: i.x + (i.kind === 'papunch' ? 1.25 : 0.6),
            minZ: i.z - 0.6,
            maxZ: i.z + 0.6
        },
        baseY: i.y,
        height: i.kind === 'papunch' ? 2 : i.kind === 'mysterybox' ? 1.2 : 2.2
    }))

/** Which region a position sits in, or -1 if it is inside a wall. */
export function regionAt(x: number, z: number): number {
    for (const region of CALL_OF_XENO_REGIONS) {
        const b = region.bounds
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return region.id
    }
    return -1
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
// Navigation
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
 * platform does not latch onto a node above its head.
 */
export function nearestNode(x: number, z: number, y: number): number {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
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

/** Nodes a zombie could reach the player from, given the doors bought so far. */
export function reachableNodes(table: Int8Array, playerNode: number): Set<number> {
    const reached = new Set<number>([playerNode])
    for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
        if (nextHop(table, i, playerNode) !== -1) reached.add(i)
    }
    return reached
}

/**
 * Where a zombie should head right now: the player once they share a node,
 * otherwise the next waypoint along the route.
 */
export function zombieTarget(
    table: Int8Array,
    zx: number, zz: number, zy: number,
    playerX: number, playerZ: number, playerY: number
): { x: number, z: number } {
    const here = nearestNode(zx, zz, zy)
    const there = nearestNode(playerX, playerZ, playerY)
    if (here === there) return { x: playerX, z: playerZ }
    const step = nextHop(table, here, there)
    if (step === -1) return { x: playerX, z: playerZ }
    const node = CALL_OF_XENO_NODES[step]!
    return { x: node.x, z: node.z }
}

/** Look and lighting per area, so the map does not read as one corridor. */
export interface CallOfXenoRoomTheme {
    floor: [string, string, string]
    wall: [string, string, string]
    ceiling: [string, string]
    lightColor: number
    accent: number
}

export const CALL_OF_XENO_ROOM_THEMES: CallOfXenoRoomTheme[] = [
    {
        floor: ['#272b33', '#3b424d', '#5d6672'],
        wall: ['#3a414b', '#454d59', '#7b8593'],
        ceiling: ['#15181d', '#1e222a'],
        lightColor: 0xffdcb0,
        accent: 0x8fb8d8
    },
    {
        floor: ['#2e2620', '#453930', '#6d5a45'],
        wall: ['#43372c', '#4f4235', '#8a6f4e'],
        ceiling: ['#1a1512', '#241d17'],
        lightColor: 0xffb265,
        accent: 0xd88a3c
    },
    {
        floor: ['#1e2a2c', '#2c3d40', '#456064'],
        wall: ['#2b3a3d', '#344a4d', '#4e7b80'],
        ceiling: ['#111819', '#182123'],
        lightColor: 0x9fe4ff,
        accent: 0x3fd8c0
    },
    {
        floor: ['#22202a', '#302c3c', '#4a4459'],
        wall: ['#2c2836', '#363044', '#5a5170'],
        ceiling: ['#141220', '#1b1828'],
        lightColor: 0xc9a8ff,
        accent: 0x8b6fd0
    }
]
