import type { DfPerkId, DfWeaponId, Vec3 } from './types'
import { DF_WALK_Y, dfMapWorld } from './map-world'
import { dfMapTraps } from './map-traps'
import type { Rect } from './map-world'
import type { DfTrap } from './specials'
import { dfBodyFits, dfBuildCollision, dfGroundHeight } from './physics'
import type { DfCollisionWorld } from './physics'

// The map contract (DfMapDef) and the compiled map "Sainte-Croix". The layout
// is authored on a voxel grid in map-world.ts; this file turns it into the
// solids, zones and spots the server and client use, and builds the zombie
// nav graph over the collision world.
//
// Axes: x east, y up, z south (metres). Ground level is y = 0, the raised
// level (the rampart walk) is y = 3. Stairs use 0.5 m steps of 1 m.


export interface DfAabb {
    min: Vec3
    max: Vec3
}

/** A solid axis-aligned box. Everything players and zombies collide with is one of these. */
export interface DfSolid extends DfAabb {
    /**
     * Physical material, used for rendering and impact effects: 'mud', 'stone'
     * (rubble masonry), 'ashlar' (dressed limestone), 'brick', 'plaster',
     * 'wood', 'planks', 'beam', 'concrete', 'sandbag', 'metal', 'crate',
     * 'rubble'. See dfMaterialSurface.
     */
    mat: string
    /** Removed from collision (and the door mesh opens) once this door is bought. */
    door?: string
    /** Collision-only (invisible walls, map edges). */
    hidden?: boolean
    /** Blocks players but lets zombies path through (barricade window frames use this). */
    playerOnly?: boolean
    /** Collision proxy of a prop the world view draws itself (e.g. 'pew', 'cart'); not drawn as a box. */
    prop?: string
    /** The window (barricade id) this sill / opening belongs to. */
    barricade?: string
}

export interface DfZone {
    id: string
    name: string
}

export interface DfDoor {
    id: string
    label: string // "Chapel Nave"
    cost: number
    zones: [string, string] // connects these zones
    pos: Vec3 // interaction point (centre of the doorway)
    /** A hinged door that swings open, or a pile of debris that collapses. */
    style?: 'door' | 'debris'
}

export interface DfBarricade {
    id: string
    zone: string
    pos: Vec3 // centre of the window, at floor level of the inside
    /** Unit vector pointing from outside into the play area. */
    inward: Vec3
    /** Where zombies queue outside before tearing boards. */
    outside: Vec3
    width: number
}

export interface DfWallBuy {
    id: string
    weapon: DfWeaponId
    pos: Vec3 // centre of the chalk outline, on the wall surface
    normal: Vec3 // wall facing direction
    zone: string
}

export interface DfPerkMachine {
    id: string
    perk: DfPerkId
    pos: Vec3 // floor position in front of the machine
    yaw: number // machine faces +z rotated by yaw
    zone: string
}

/**
 * A placed object. `pos` is the object's footprint centre at the height of the
 * floor it stands on (fuses: where the fuse lies), `yaw` rotates +z to the side
 * the player uses it from: forward = (sin yaw, 0, cos yaw).
 */
export interface DfSpot {
    id: string
    pos: Vec3
    yaw: number
    zone: string
}

export interface DfNavNode {
    id: number
    pos: Vec3
    zone: string
    /** Outside the play area: a window approach node zombies queue at. */
    outside?: boolean
}

/** Link between two nav nodes, optionally closed until a door opens. */
export interface DfNavLink {
    a: number
    b: number
    door?: string
    /** Passes through this window: blocked while boards remain (zombies tear them first). */
    barricade?: string
}

export interface DfLight {
    pos: Vec3
    color: string
    intensity: number
    distance: number
    /** Only lit once the power is on. */
    power?: boolean
    flicker?: boolean
}

export interface DfMapDef {
    id: string
    name: string
    bounds: DfAabb
    startZone: string
    playerSpawns: Vec3[]
    solids: DfSolid[]
    zones: DfZone[]
    doors: DfDoor[]
    barricades: DfBarricade[]
    wallBuys: DfWallBuy[]
    perks: DfPerkMachine[]
    boxSpots: DfSpot[]
    pap: DfSpot
    power: DfSpot
    egg: {
        fuses: DfSpot[] // exactly 3
        /** Lightning-rod masts (ids rod-0..2) thrown during the 'rods' step; one on the raised level. */
        rods: DfSpot[]
        generator: DfSpot
        pedestal: DfSpot
        /** Kills within this radius of the generator count toward the charge. */
        chargeRadius: number
    }
    /** Zombies that spawn without a window (rising from the ground) use these. */
    riserSpawns: DfSpot[]
    nav: { nodes: DfNavNode[], links: DfNavLink[] }
    lights: DfLight[]
    /** Buyable electric traps across passages (shared/utils/dead-front/map-traps.ts). */
    traps?: DfTrap[]
}

/** Floor height of the raised level. */
export const DF_UPPER_Y = DF_WALK_Y
/** Height of one stair step (one voxel). */
export const DF_STEP = 0.5

/** Coarse surface class of a solid material, for impact effects and footsteps. */
export function dfMaterialSurface(mat: string): 'wood' | 'metal' | 'stone' | 'dirt' | 'cloth' {
    switch (mat) {
        case 'wood':
        case 'planks':
        case 'beam':
        case 'crate':
            return 'wood'
        case 'metal':
            return 'metal'
        case 'mud':
            return 'dirt'
        case 'sandbag':
            return 'cloth'
        default:
            return 'stone'
    }
}

// ---------------------------------------------------------------- nav graph

const NUDGES: [number, number][] = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]
const NAV_CLEAR = 0.42 // node clearance radius
const LINK_CLEAR = 0.3 // corridor half-width a link needs
const LINK_MAX = 3.0
const BAND_LO = 0.56 // obstacles up to one voxel step are stepped over
const BAND_HI = 1.7
/** Floor heights the grid fill looks for (ground, the chancel step, the rampart walk). */
const NAV_FLOORS = [0, 0.5, DF_UPPER_Y]

interface NavInput {
    solids: DfSolid[]
    doors: DfDoor[]
    barricades: DfBarricade[]
    zoneRects: { zone: string, rect: Rect }[]
    pockets: { rect: Rect, zone: string }[]
    stairs: { bottom: Vec3, top: Vec3, steps: number, zone: string }[]
    start: Vec3
}

function inRect(r: Rect, x: number, z: number): boolean {
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1
}

function buildNav(m: NavInput): { nodes: DfNavNode[], links: DfNavLink[] } {
    // All doors open: links through doorways are generated and then tagged.
    const open = dfBuildCollision({ solids: m.solids } as DfMapDef, new Set(m.doors.map(d => d.id)))
    const raw: { pos: Vec3, zone: string, outside?: boolean }[] = []
    const zoneAt = (x: number, z: number) => m.zoneRects.find(r => inRect(r.rect, x, z))?.zone

    // Hand-placed nodes: both sides of every doorway, both sides of every window, the stairs.
    for (const d of m.doors) {
        raw.push({ pos: d.pos, zone: d.zones[0] })
        for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]] as const) {
            const p = v(d.pos.x + dx, d.pos.y, d.pos.z + dz)
            const zone = zoneAt(p.x, p.z)
            if (zone && nodeOk(open, p)) raw.push({ pos: p, zone })
        }
    }
    for (const b of m.barricades) {
        raw.push({ pos: b.outside, zone: b.zone, outside: true })
        raw.push({ pos: v(b.pos.x + b.inward.x * 0.9, 0, b.pos.z + b.inward.z * 0.9), zone: b.zone })
    }
    for (const s of m.stairs) {
        const dx = s.top.x - s.bottom.x
        const dz = s.top.z - s.bottom.z
        const run = Math.hypot(dx, dz)
        // Bottom landing, one node on each tread, top landing.
        raw.push({ pos: s.bottom, zone: s.zone })
        const first = 0.8 // the first riser sits this far from the bottom node
        const tread = (run - 2 * first) / s.steps
        for (let i = 0; i < s.steps; i++) {
            const t = (first + tread * (i + 0.5)) / run
            raw.push({ pos: v(s.bottom.x + dx * t, (s.top.y - s.bottom.y) * (i + 1) / s.steps + s.bottom.y, s.bottom.z + dz * t), zone: s.zone })
        }
        raw.push({ pos: s.top, zone: s.zone })
    }
    const near = (p: Vec3, d: number) => raw.some(n => Math.abs(n.pos.y - p.y) < 0.3 && Math.hypot(n.pos.x - p.x, n.pos.z - p.z) < d)

    // Grid fill on odd-metre points, on every floor height, in the zones and the window pockets.
    const fillRect = (r: Rect, zone: string, outside: boolean, floors: readonly number[]) => {
        for (let x = Math.ceil((r.x0 - 1) / 2) * 2 + 1; x < r.x1; x += 2) {
            for (let z = Math.ceil((r.z0 - 1) / 2) * 2 + 1; z < r.z1; z += 2) {
                for (const y of floors) {
                    // Nudge points that land in a wall or a prop into the free space next to it.
                    for (const [ox, oz] of NUDGES) {
                        const p = v(x + ox, y, z + oz)
                        if (!inRect(r, p.x, p.z)) continue
                        if (near(p, 1.0)) break
                        if (!nodeOk(open, p)) continue
                        raw.push({ pos: p, zone, ...(outside ? { outside: true } : {}) })
                        break
                    }
                }
            }
        }
    }
    for (const zr of m.zoneRects) fillRect(zr.rect, zr.zone, false, NAV_FLOORS)
    for (const pk of m.pockets) fillRect(pk.rect, pk.zone, true, [0])

    let nodes: DfNavNode[] = raw.map((n, i) => ({ id: i, pos: n.pos, zone: n.zone, ...(n.outside ? { outside: true } : {}) }))

    // Links between nearby nodes whose corridor is walkable (bucketed by 3 m cells).
    const doorSolids = m.solids.filter(s => s.door)
    const windowSolids = m.solids.filter(s => s.barricade && s.hidden)
    const buckets = new Map<string, number[]>()
    const key = (x: number, z: number) => `${Math.floor(x / LINK_MAX)},${Math.floor(z / LINK_MAX)}`
    nodes.forEach((n, i) => {
        const k = key(n.pos.x, n.pos.z)
        let b = buckets.get(k)
        if (!b) buckets.set(k, b = [])
        b.push(i)
    })
    let links: DfNavLink[] = []
    for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!.pos
        const bx = Math.floor(a.x / LINK_MAX)
        const bz = Math.floor(a.z / LINK_MAX)
        for (let ox = -1; ox <= 1; ox++) {
            for (let oz = -1; oz <= 1; oz++) {
                for (const j of buckets.get(`${bx + ox},${bz + oz}`) ?? []) {
                    if (j <= i) continue
                    const b = nodes[j]!.pos
                    const d = Math.hypot(b.x - a.x, b.z - a.z)
                    if (d > LINK_MAX || d < 1e-3 || Math.abs(b.y - a.y) > 1.0) continue
                    if (!corridorOk(open, a, b)) continue
                    const link: DfNavLink = { a: i, b: j }
                    const door = doorSolids.find(s => segmentHits(s, a, b, LINK_CLEAR))
                    if (door) link.door = door.door
                    const win = windowSolids.find(s => segmentHits(s, a, b, 0))
                    if (win) link.barricade = win.barricade
                    // An outside node only connects to the inside through its window.
                    if (!!nodes[i]!.outside !== !!nodes[j]!.outside && !link.barricade) continue
                    links.push(link)
                }
            }
        }
    }

    // Drop inside nodes nothing can walk to (fountain basin, tops of props), then renumber.
    const startIdx = nodes.reduce((best, n, i) => (!n.outside && Math.hypot(n.pos.x - m.start.x, n.pos.z - m.start.z) < Math.hypot(nodes[best]!.pos.x - m.start.x, nodes[best]!.pos.z - m.start.z) ? i : best), 0)
    const adj = nodes.map(() => [] as number[])
    for (const l of links) {
        if (l.barricade) continue
        adj[l.a]!.push(l.b)
        adj[l.b]!.push(l.a)
    }
    const keep = new Uint8Array(nodes.length)
    const queue = [startIdx]
    keep[startIdx] = 1
    while (queue.length) {
        const c = queue.pop()!
        for (const n of adj[c]!) {
            if (!keep[n] && !nodes[n]!.outside) {
                keep[n] = 1
                queue.push(n)
            }
        }
    }
    nodes.forEach((n, i) => {
        if (n.outside) keep[i] = 1
    })
    const remap = new Int32Array(nodes.length).fill(-1)
    const kept: DfNavNode[] = []
    nodes.forEach((n, i) => {
        if (!keep[i]) return
        remap[i] = kept.length
        kept.push({ ...n, id: kept.length })
    })
    links = links.filter(l => keep[l.a] && keep[l.b]).map(l => ({ ...l, a: remap[l.a]!, b: remap[l.b]! }))
    nodes = kept
    return { nodes, links }
}

function nodeOk(world: DfCollisionWorld, p: Vec3): boolean {
    const g = dfGroundHeight(world, p.x, p.z, p.y + 0.3, true)
    if (Math.abs(g - p.y) > 0.05) return false
    return dfBodyFits(world, v(p.x, p.y + BAND_LO, p.z), { radius: NAV_CLEAR, height: BAND_HI - BAND_LO, zombie: true })
}

function corridorOk(world: DfCollisionWorld, a: Vec3, b: Vec3): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(2, Math.ceil(d / 0.25))
    let prev = a.y
    for (let k = 0; k <= n; k++) {
        const t = k / n
        const x = a.x + (b.x - a.x) * t
        const z = a.z + (b.z - a.z) * t
        const y = a.y + (b.y - a.y) * t
        const g = dfGroundHeight(world, x, z, Math.max(y, prev) + 0.56, true)
        if (Math.abs(g - y) > 0.6) return false
        // No climbing onto a stair from its side: each sample may only rise or drop one step.
        if (Math.abs(g - prev) > 0.56) return false
        prev = g
        if (!dfBodyFits(world, v(x, g + BAND_LO, z), { radius: LINK_CLEAR, height: BAND_HI - BAND_LO, zombie: true })) return false
    }
    return true
}

/** Does the xz segment a-b (thickened by r) cross the solid within the walking band? */
function segmentHits(s: DfSolid, a: Vec3, b: Vec3, r: number): boolean {
    const yLo = Math.min(a.y, b.y) + BAND_LO
    const yHi = Math.max(a.y, b.y) + BAND_HI
    if (s.max.y <= yLo || s.min.y >= yHi) return false
    const x0 = s.min.x - r
    const x1 = s.max.x + r
    const z0 = s.min.z - r
    const z1 = s.max.z + r
    let t0 = 0
    let t1 = 1
    const dx = b.x - a.x
    const dz = b.z - a.z
    for (const [o, d, lo, hi] of [[a.x, dx, x0, x1], [a.z, dz, z0, z1]] as const) {
        if (Math.abs(d) < 1e-9) {
            if (o < lo || o > hi) return false
            continue
        }
        let ta = (lo - o) / d
        let tb = (hi - o) / d
        if (ta > tb) [ta, tb] = [tb, ta]
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
        if (t0 > t1) return false
    }
    return true
}

function v(x: number, y: number, z: number): Vec3 {
    return { x, y, z }
}

function compile(): DfMapDef {
    const w = dfMapWorld()
    return {
        id: 'sainte-croix',
        name: 'Sainte-Croix',
        bounds: { min: { x: -48, y: -1, z: -48 }, max: { x: 48, y: 17, z: 48 } },
        startZone: 'square',
        playerSpawns: w.playerSpawns,
        solids: w.solids,
        zones: w.zones,
        doors: w.doors,
        barricades: w.barricades,
        wallBuys: w.wallBuys,
        perks: w.perks,
        boxSpots: w.boxSpots,
        pap: w.pap,
        power: w.power,
        egg: {
            fuses: w.fuses,
            rods: w.rods,
            generator: w.generator,
            pedestal: w.pedestal,
            chargeRadius: 9
        },
        riserSpawns: w.riserSpawns,
        nav: buildNav({ solids: w.solids, doors: w.doors, barricades: w.barricades, zoneRects: w.zoneRects, pockets: w.pockets, stairs: w.stairs, start: w.playerSpawns[0]! }),
        lights: w.lights,
        traps: dfMapTraps()
    }
}

export const DF_MAP: DfMapDef = compile()

/** Interactable ids used in `{ t: 'use', id }`. Built from the map so client prompts and server checks agree. */
export type DfInteractKind = 'door' | 'wallbuy' | 'perk' | 'box' | 'pap' | 'power' | 'fuse' | 'rod' | 'generator' | 'pedestal' | 'barricade' | 'trap'

export interface DfInteractable {
    id: string
    kind: DfInteractKind
    pos: Vec3
    zone: string
    /** door id / weapon id / perk id / fuse id / barricade id */
    ref?: string
}

export function dfInteractables(map: DfMapDef): DfInteractable[] {
    const out: DfInteractable[] = []
    for (const d of map.doors) out.push({ id: d.id, kind: 'door', pos: d.pos, zone: d.zones[0], ref: d.id })
    for (const w of map.wallBuys) out.push({ id: w.id, kind: 'wallbuy', pos: w.pos, zone: w.zone, ref: w.weapon })
    for (const p of map.perks) out.push({ id: p.id, kind: 'perk', pos: p.pos, zone: p.zone, ref: p.perk })
    for (const b of map.boxSpots) out.push({ id: b.id, kind: 'box', pos: b.pos, zone: b.zone })
    for (const b of map.barricades) out.push({ id: b.id, kind: 'barricade', pos: b.pos, zone: b.zone, ref: b.id })
    for (const f of map.egg.fuses) out.push({ id: f.id, kind: 'fuse', pos: f.pos, zone: f.zone, ref: f.id })
    // (Test maps written before the rods step may leave them out.)
    for (const r of map.egg.rods ?? []) out.push({ id: r.id, kind: 'rod', pos: r.pos, zone: r.zone, ref: r.id })
    out.push({ id: map.pap.id, kind: 'pap', pos: map.pap.pos, zone: map.pap.zone })
    out.push({ id: map.power.id, kind: 'power', pos: map.power.pos, zone: map.power.zone })
    out.push({ id: map.egg.generator.id, kind: 'generator', pos: map.egg.generator.pos, zone: map.egg.generator.zone })
    out.push({ id: map.egg.pedestal.id, kind: 'pedestal', pos: map.egg.pedestal.pos, zone: map.egg.pedestal.zone })
    for (const t of map.traps ?? []) out.push({ id: t.id, kind: 'trap', pos: t.lever.pos, zone: t.zone, ref: t.id })
    return out
}

/** Planks a fully repaired barricade holds. */
export const DF_BARRICADE_PLANKS = 6
