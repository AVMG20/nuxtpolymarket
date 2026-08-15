// Call of Xeno — level layout.
//
// The map is a ring: three rooms in a row joined by corridors, plus a service
// tunnel running back along the south side. Buy all four doors and you can kite
// a horde in a full circle, which is where the skill ceiling lives.
//
// The Reactor Hall in the middle is a tall atrium with a U-shaped catwalk
// around it, reached by two ramps. High ground gives sightlines over the whole
// hall; the price is that both ramp mouths can fill at once and the only other
// way down is off the edge.
//
// Everything is axis aligned. Collision is circle-vs-AABB with a vertical
// band test, navigation is a small graph with a precomputed next-hop table.

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

/** A walkable slab. Also solid, so you can walk under a catwalk. */
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
/** The Reactor Hall is an atrium so the catwalk has headroom above and below. */
export const CALL_OF_XENO_ATRIUM_HEIGHT = 8
export const CALL_OF_XENO_CATWALK_Y = 3.6
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
    { id: 0, name: 'Landing Bay', bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 20 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 1, name: 'Reactor Hall', bounds: { minX: 24, maxX: 44, minZ: 0, maxZ: 20 }, ceiling: CALL_OF_XENO_ATRIUM_HEIGHT, theme: 1 },
    { id: 2, name: 'Power Deck', bounds: { minX: 48, maxX: 68, minZ: 0, maxZ: 20 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 3, name: 'Corridor AB', bounds: { minX: 20, maxX: 24, minZ: 8, maxZ: 12 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 4, name: 'Corridor BC', bounds: { minX: 44, maxX: 48, minZ: 8, maxZ: 12 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 5, name: 'Bay Stairwell', bounds: { minX: 4, maxX: 8, minZ: 20, maxZ: 24 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 0 },
    { id: 6, name: 'Deck Stairwell', bounds: { minX: 60, maxX: 64, minZ: 20, maxZ: 24 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 2 },
    { id: 7, name: 'Service Tunnel', bounds: { minX: 4, maxX: 64, minZ: 24, maxZ: 28 }, ceiling: CALL_OF_XENO_WALL_HEIGHT, theme: 3 }
]

const H = CALL_OF_XENO_WALL_HEIGHT
const A = CALL_OF_XENO_ATRIUM_HEIGHT

function wall(minX: number, maxX: number, minZ: number, maxZ: number, height = H): CallOfXenoSolid {
    return { box: { minX, maxX, minZ, maxZ }, baseY: 0, height }
}

/** Static geometry. Full height unless noted, so it stops bullets too. */
export const CALL_OF_XENO_WALLS: CallOfXenoSolid[] = [
    // Landing Bay: gap at x=20 for corridor AB, gap at z=20 for the stairwell.
    wall(-0.5, 20.5, -0.5, 0),
    wall(-0.5, 0, -0.5, 20.5),
    wall(20, 20.5, -0.5, 8),
    wall(20, 20.5, 12, 20.5),
    wall(-0.5, 4, 20, 20.5),
    wall(8, 20.5, 20, 20.5),

    // Corridor AB.
    wall(20, 24, 7.5, 8),
    wall(20, 24, 12, 12.5),

    // Reactor Hall atrium: gaps at x=24 and x=44.
    wall(23.5, 44.5, -0.5, 0, A),
    wall(23.5, 44.5, 20, 20.5, A),
    wall(23.5, 24, -0.5, 8, A),
    wall(23.5, 24, 12, 20.5, A),
    wall(44, 44.5, -0.5, 8, A),
    wall(44, 44.5, 12, 20.5, A),

    // Corridor BC.
    wall(44, 48, 7.5, 8),
    wall(44, 48, 12, 12.5),

    // Power Deck: gap at x=48, gap at z=20 for the stairwell.
    wall(47.5, 68.5, -0.5, 0),
    wall(47.5, 60, 20, 20.5),
    wall(64, 68.5, 20, 20.5),
    wall(47.5, 48, -0.5, 8),
    wall(47.5, 48, 12, 20.5),
    wall(68, 68.5, -0.5, 20.5),

    // The two stairwells down into the service tunnel.
    wall(3.5, 4, 20, 24.5),
    wall(8, 8.5, 20, 24.5),
    wall(59.5, 60, 20, 24.5),
    wall(64, 64.5, 20, 24.5),

    // Service tunnel: north wall closed except where the stairwells meet it.
    wall(8, 60, 23.5, 24),
    wall(3.5, 64.5, 28, 28.5),
    wall(3.5, 4, 24, 28.5),
    wall(64, 64.5, 24, 28.5),

    // Full-height structure inside the rooms.
    wall(3, 4, 3, 4),
    wall(16, 17, 16, 17),
    wall(31, 37, 4, 8, A),
    wall(54, 56, 3, 9),
    wall(60, 62, 3, 9)
]

/**
 * Waist-high cover. Blocks movement but only blocks a shot low enough to hit
 * it, so you can fire over a crate you are stood behind.
 */
export const CALL_OF_XENO_CRATES: CallOfXenoSolid[] = [
    { box: { minX: 13, maxX: 16, minZ: 12, maxZ: 15 }, baseY: 0, height: 1.1 },
    { box: { minX: 4, maxX: 6, minZ: 4, maxZ: 6 }, baseY: 0, height: 1.5 },
    { box: { minX: 15, maxX: 17, minZ: 6, maxZ: 8 }, baseY: 0, height: 1.1 },
    { box: { minX: 28, maxX: 30, minZ: 12, maxZ: 14 }, baseY: 0, height: 1.2 },
    { box: { minX: 38, maxX: 40, minZ: 12, maxZ: 14 }, baseY: 0, height: 1.2 },
    { box: { minX: 50, maxX: 53, minZ: 13, maxZ: 16 }, baseY: 0, height: 1.2 },
    { box: { minX: 20, maxX: 23, minZ: 24.2, maxZ: 25.2 }, baseY: 0, height: 1.1 },
    { box: { minX: 44, maxX: 47, minZ: 24.2, maxZ: 25.2 }, baseY: 0, height: 1.1 },
    // On the catwalk, tucked against the outer wall so the walking lane stays
    // clear — the high ground should be cover, not a maze.
    { box: { minX: 29, maxX: 31, minZ: 2.6, maxZ: 3.4 }, baseY: CALL_OF_XENO_CATWALK_Y, height: 1 },
    { box: { minX: 37, maxX: 39, minZ: 2.6, maxZ: 3.4 }, baseY: CALL_OF_XENO_CATWALK_Y, height: 1 }
]

/** The catwalk: a U around the Reactor Hall, open over the south half. */
export const CALL_OF_XENO_PLATFORMS: CallOfXenoPlatform[] = [
    { box: { minX: 24, maxX: 27, minZ: 0, maxZ: 20 }, y: CALL_OF_XENO_CATWALK_Y, thickness: 0.3 },
    { box: { minX: 41, maxX: 44, minZ: 0, maxZ: 20 }, y: CALL_OF_XENO_CATWALK_Y, thickness: 0.3 },
    { box: { minX: 27, maxX: 41, minZ: 0, maxZ: 3.5 }, y: CALL_OF_XENO_CATWALK_Y, thickness: 0.3 }
]

/** The two ramps up onto the catwalk, both rising off the hall's south floor. */
export const CALL_OF_XENO_RAMPS: CallOfXenoRamp[] = [
    {
        box: { minX: 27, maxX: 30.5, minZ: 16.5, maxZ: 20 },
        axis: 'x',
        lowAt: 30.5,
        lowY: 0,
        highAt: 27,
        highY: CALL_OF_XENO_CATWALK_Y
    },
    {
        box: { minX: 37.5, maxX: 41, minZ: 16.5, maxZ: 20 },
        axis: 'x',
        lowAt: 37.5,
        lowY: 0,
        highAt: 41,
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
        id: 'door-bay-hall',
        cost: 750,
        box: { minX: 21.5, maxX: 22.5, minZ: 8, maxZ: 12 },
        blocks: [1, 2],
        prompt: { x: 22, z: 10 }
    },
    {
        id: 'door-hall-deck',
        cost: 1250,
        box: { minX: 45.5, maxX: 46.5, minZ: 8, maxZ: 12 },
        blocks: [4, 5],
        prompt: { x: 46, z: 10 }
    },
    {
        id: 'door-deck-tunnel',
        cost: 1500,
        box: { minX: 60, maxX: 64, minZ: 21.5, maxZ: 22.5 },
        blocks: [7, 8],
        prompt: { x: 62, z: 22 }
    },
    {
        id: 'door-tunnel-bay',
        cost: 1000,
        box: { minX: 4, maxX: 8, minZ: 21.5, maxZ: 22.5 },
        blocks: [9, 10],
        prompt: { x: 6, z: 22 }
    }
]

/**
 * Navigation graph. Nodes 0-10 are the ground ring, 11-20 the catwalk loop and
 * its two ramps. Zombies walk node to node until they share one with the
 * player, then head straight for them.
 */
export const CALL_OF_XENO_NODES: { x: number, z: number, y: number }[] = [
    { x: 10, z: 10, y: 0 },        // 0  Landing Bay centre
    { x: 19, z: 10, y: 0 },        // 1  Bay east mouth
    { x: 25, z: 10, y: 0 },        // 2  Hall west mouth
    { x: 34, z: 10, y: 0 },        // 3  Hall centre
    { x: 43, z: 10, y: 0 },        // 4  Hall east mouth
    { x: 49, z: 10, y: 0 },        // 5  Deck west mouth
    { x: 58, z: 10, y: 0 },        // 6  Power Deck centre
    { x: 62, z: 19, y: 0 },        // 7  Deck stairwell
    { x: 62, z: 26, y: 0 },        // 8  Tunnel east
    { x: 6, z: 26, y: 0 },         // 9  Tunnel west
    { x: 6, z: 19, y: 0 },         // 10 Bay stairwell
    { x: 34, z: 18, y: 0 },        // 11 Hall south floor
    { x: 30.8, z: 18.5, y: 0 },    // 12 West ramp base
    { x: 25.5, z: 18.5, y: CALL_OF_XENO_CATWALK_Y }, // 13 West ramp top
    { x: 25.5, z: 10, y: CALL_OF_XENO_CATWALK_Y },   // 14 Catwalk west
    { x: 25.5, z: 1.4, y: CALL_OF_XENO_CATWALK_Y },  // 15 Catwalk north-west
    { x: 34, z: 1.4, y: CALL_OF_XENO_CATWALK_Y },    // 16 Catwalk north
    { x: 42.5, z: 1.4, y: CALL_OF_XENO_CATWALK_Y },  // 17 Catwalk north-east
    { x: 42.5, z: 10, y: CALL_OF_XENO_CATWALK_Y },   // 18 Catwalk east
    { x: 42.5, z: 18.5, y: CALL_OF_XENO_CATWALK_Y }, // 19 East ramp top
    { x: 37.2, z: 18.5, y: 0 }     // 20 East ramp base
]

export const CALL_OF_XENO_EDGES: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 0],
    [3, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 11]
]

export const CALL_OF_XENO_SPAWNS: CallOfXenoSpawnPoint[] = [
    { x: 2.5, z: 3, node: 0 },
    { x: 17.5, z: 3, node: 1 },
    { x: 28, z: 17, node: 11 },
    { x: 40, z: 17, node: 11 },
    { x: 50.5, z: 3, node: 5 },
    { x: 65.5, z: 3, node: 6 },
    { x: 14, z: 26, node: 9 },
    { x: 54, z: 26, node: 8 }
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
    // Landing Bay
    { id: 'buy-mp40', kind: 'wallbuy', x: 0.4, y: 0, z: 6, facing: Math.PI / 2, region: 0, weapon: 'mp40', needsPower: false },
    { id: 'buy-trench', kind: 'wallbuy', x: 14, y: 0, z: 0.4, facing: 0, region: 0, weapon: 'trench', needsPower: false },
    { id: 'perk-quickrevive', kind: 'perk', x: 2.5, y: 0, z: 19, facing: Math.PI, region: 0, perk: 'quickrevive', needsPower: true },

    // Reactor Hall — the box on the floor, Juggernog up on the catwalk.
    { id: 'buy-ak74', kind: 'wallbuy', x: 34, y: 0, z: 0.4, facing: 0, region: 1, weapon: 'ak74', needsPower: false },
    { id: 'mysterybox', kind: 'mysterybox', x: 35.8, y: 0, z: 13.5, facing: Math.PI, region: 1, needsPower: false },
    { id: 'perk-juggernog', kind: 'perk', x: 34, y: CALL_OF_XENO_CATWALK_Y, z: 2.9, facing: 0, region: 1, perk: 'juggernog', needsPower: true },

    // Power Deck
    { id: 'power', kind: 'power', x: 67.4, y: 0, z: 10, facing: -Math.PI / 2, region: 2, needsPower: false },
    { id: 'buy-rpk', kind: 'wallbuy', x: 56, y: 0, z: 19.6, facing: Math.PI, region: 2, weapon: 'rpk', needsPower: false },
    { id: 'perk-doubletap', kind: 'perk', x: 49.5, y: 0, z: 19, facing: Math.PI, region: 2, perk: 'doubletap', needsPower: true },
    { id: 'papunch', kind: 'papunch', x: 66, y: 0, z: 19, facing: Math.PI, region: 2, needsPower: true },

    // Service Tunnel — Speed Cola is the reward for closing the ring.
    { id: 'perk-speedcola', kind: 'perk', x: 34, y: 0, z: 27.4, facing: Math.PI, region: 7, perk: 'speedcola', needsPower: true }
]

export const CALL_OF_XENO_PLAYER_START = { x: 12, z: 17 }

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
 * slightly above their current feet count, so walking off the catwalk drops
 * you rather than teleporting you along the ceiling.
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

/** Everything solid right now, including whichever doors are still shut. */
export function collisionSolids(openDoors: ReadonlySet<string>): CallOfXenoSolid[] {
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
            .map(d => ({ box: d.box, baseY: 0, height: CALL_OF_XENO_ATRIUM_HEIGHT }))
    ]
}

/**
 * The subset of solids an actor can actually walk into: those whose vertical
 * band overlaps the band their body occupies. This is what lets you stand on a
 * catwalk without the crates underneath it blocking you.
 */
export function solidsInBand(solids: readonly CallOfXenoSolid[], feetY: number, bodyHeight: number): CallOfXenoBox[] {
    const headY = feetY + bodyHeight
    const boxes: CallOfXenoBox[] = []
    for (const solid of solids) {
        const top = solid.baseY + solid.height
        // Anything low enough to step onto is floor, not wall — this is what
        // lets an actor walk off the top of a ramp onto the catwalk deck
        // instead of being stopped by the deck's own collision box.
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
 * and under a catwalk without any special casing.
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
 * catwalk does not latch onto a node three metres above its head.
 */
export function nearestNode(x: number, z: number, y: number): number {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < CALL_OF_XENO_NODES.length; i++) {
        const node = CALL_OF_XENO_NODES[i]!
        const dy = (node.y - y) * 4
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
