import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import type { DfEggState } from '#shared/utils/dead-front/protocol'
import { dfBoxWeight } from '#shared/utils/dead-front/weapons'
import type { DfEnemyType, DfHitZone, DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'

// Pure rules of the Dead Front simulation: shot validation geometry, damage
// and points, the mystery box pool and the easter egg state machine. No
// sockets, no state: everything here is unit tested.

// ---------------------------------------------------------------- shot validation

/** Extra metres a claimed ray may miss the server's zombie by: latency of ~0.25 s at the zombie's speed. */
export function dfShotTolerance(speed: number): number {
    return 1 + Math.max(0, speed) * 0.25
}

/**
 * Closest approach between a ray segment (origin + dir * t, t in [0, maxT])
 * and the vertical axis of a body standing at `base` (from feet to `height`).
 * Returns the ray parameter and the miss distance.
 */
export function dfRayAxisApproach(origin: Vec3, dir: Vec3, base: Vec3, height: number, maxT: number): { t: number, miss: number } {
    // Closest points between segments P(s) = origin + dir * s (s in [0, maxT])
    // and Q(u) = base + (0, u, 0) (u in [0, height]).
    const rx = origin.x - base.x
    const ry = origin.y - base.y
    const rz = origin.z - base.z
    const a = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z // ~1
    const e = 1 // |up|^2 per unit of u
    const b = dir.y // dir . up
    const c = rx * dir.x + ry * dir.y + rz * dir.z // dir . r
    const f = ry // up . r
    const denom = a * e - b * b
    let s = denom > 1e-9 ? (b * f - c * e) / denom : 0
    s = clamp(s, 0, maxT)
    let u = (b * s + f) / e
    if (u < 0 || u > height) {
        u = clamp(u, 0, height)
        s = clamp((b * u - c) / a, 0, maxT)
    }
    const px = origin.x + dir.x * s - base.x
    const py = origin.y + dir.y * s - (base.y + u)
    const pz = origin.z + dir.z * s - base.z
    return { t: s, miss: Math.sqrt(px * px + py * py + pz * pz) }
}

/** Distance from a ray (t >= 0) to a point, and the ray parameter of the closest point. */
export function dfRayPointApproach(origin: Vec3, dir: Vec3, p: Vec3): { t: number, miss: number } {
    const t = Math.max(0, (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y + (p.z - origin.z) * dir.z)
    const x = origin.x + dir.x * t - p.x
    const y = origin.y + dir.y * t - p.y
    const z = origin.z + dir.z * t - p.z
    return { t, miss: Math.sqrt(x * x + y * y + z * z) }
}

export interface DfClaimTarget {
    type: DfEnemyType
    pos: Vec3
    /** Current ground speed, m/s. */
    speed: number
}

/** Is a claimed hit on `target` plausible along this ray? Null when it misses beyond the tolerance or range. */
export function dfClaimPlausible(target: DfClaimTarget, origin: Vec3, dir: Vec3, maxRange: number): { t: number, miss: number } | null {
    const def = DF_ENEMIES[target.type]
    const hit = dfRayAxisApproach(origin, dir, target.pos, def.height, maxRange + 3)
    if (hit.miss > def.radius + dfShotTolerance(target.speed)) return null
    return hit
}

/**
 * Sanity bound for a client-authoritative hit claim (players are trusted
 * friends): the ray only has to pass within a few metres of the server's
 * zombie and inside the weapon's range, which rejects garbage (a zombie
 * across the map, a ray pointing away) but never a real shot under lag.
 */
export function dfClaimSane(target: DfClaimTarget, origin: Vec3, dir: Vec3, maxRange: number): { t: number, miss: number } | null {
    const def = DF_ENEMIES[target.type]
    const hit = dfRayAxisApproach(origin, dir, target.pos, def.height, maxRange + 4)
    if (hit.miss > def.radius + 2.5 + Math.max(0, target.speed) * 0.35) return null
    return hit
}

/** Keeps a head claim only if the ray passed near the head; otherwise it counts as a body hit. */
export function dfVerifyZone(target: DfClaimTarget, origin: Vec3, dir: Vec3, zone: DfHitZone): DfHitZone {
    if (zone !== 'head') return zone === 'limb' ? 'limb' : 'body'
    const def = DF_ENEMIES[target.type]
    const head = { x: target.pos.x, y: target.pos.y + def.headY, z: target.pos.z }
    const near = dfRayPointApproach(origin, dir, head)
    return near.miss <= def.headR + 0.35 + target.speed * 0.25 ? 'head' : 'body'
}

// ---------------------------------------------------------------- damage and points

// Shared with the client's prediction (shared/utils/dead-front/combat.ts).
export { dfBulletDamage, dfFalloff, dfKillClaimHonoured, dfKillPoints, dfScalePoints } from '#shared/utils/dead-front/combat'

// ---------------------------------------------------------------- mystery box

/** Weapons the box may hand this player: the pool minus anything they hold and the wunderweapon. */
export function dfBoxChoices(pool: readonly DfWeaponId[], held: readonly DfWeaponId[]): DfWeaponId[] {
    const choices = pool.filter(id => id !== 'wunder' && !held.includes(id))
    return choices.length ? choices : pool.filter(id => id !== 'wunder')
}

/** Weighted pick from the box choices (`dfBoxWeight`); `roll` is uniform in [0, 1). */
export function dfBoxRoll(choices: readonly DfWeaponId[], roll: number): DfWeaponId {
    let total = 0
    for (const id of choices) total += dfBoxWeight(id)
    let r = roll * total
    for (const id of choices) {
        r -= dfBoxWeight(id)
        if (r < 0) return id
    }
    return choices[choices.length - 1]!
}

// ---------------------------------------------------------------- easter egg

export type DfEggAction
    = | { kind: 'power' }
        | { kind: 'fuse', id: string }
        | { kind: 'install' }
        | { kind: 'soul', needed: number }
        /** A lightning-rod switch thrown; the first one starts the clock (`time` seconds). */
        | { kind: 'rod', id: string, time: number }
        /** The rod clock ran out: every rod resets. */
        | { kind: 'rodsReset' }
        | { kind: 'claim', pid: number }

/**
 * Advances the guided easter egg. Mutates `egg`; `stepChanged` tells the
 * caller to emit an `egg` event, `progressed` that the action counted.
 */
export function dfEggAdvance(egg: DfEggState, action: DfEggAction, fuseIds: readonly string[], rodIds: readonly string[] = []): { progressed: boolean, stepChanged: boolean } {
    const before = egg.step
    let progressed = false
    const allFuses = () => fuseIds.every(id => egg.fusesFound.includes(id))
    switch (action.kind) {
        case 'power':
            if (egg.step === 'power') {
                egg.step = allFuses() ? 'install' : 'fuses'
                progressed = true
            }
            break
        case 'fuse':
            if (egg.step === 'fuses' && fuseIds.includes(action.id) && !egg.fusesFound.includes(action.id)) {
                egg.fusesFound.push(action.id)
                progressed = true
                if (allFuses()) egg.step = 'install'
            }
            break
        case 'install':
            if (egg.step === 'install' && allFuses()) {
                egg.step = 'charge'
                egg.charge = 0
                progressed = true
            }
            break
        case 'soul':
            if (egg.step === 'charge') {
                egg.chargeNeeded = action.needed
                egg.charge = Math.min(action.needed, egg.charge + 1)
                progressed = true
                // a map without lightning rods goes straight to the pedestal
                if (egg.charge >= action.needed) egg.step = rodIds.length ? 'rods' : 'claim'
            }
            break
        case 'rod':
            if (egg.step === 'rods' && rodIds.includes(action.id) && !egg.rodsOn.includes(action.id)) {
                egg.rodsOn.push(action.id)
                if (egg.rodsOn.length === 1) egg.rodTimer = action.time
                progressed = true
                if (rodIds.every(id => egg.rodsOn.includes(id))) {
                    egg.step = 'claim'
                    egg.rodTimer = 0
                }
            }
            break
        case 'rodsReset':
            if (egg.step === 'rods' && egg.rodsOn.length) {
                egg.rodsOn.length = 0
                egg.rodTimer = 0
                progressed = true
            }
            break
        case 'claim':
            if (egg.step === 'claim' && egg.claimedBy === undefined) {
                egg.claimedBy = action.pid
                egg.step = 'done'
                progressed = true
            }
            break
    }
    return { progressed, stepChanged: egg.step !== before }
}

/**
 * Runs the lightning-rod clock for `dt` seconds. Returns the rods that reset
 * when it ran out (the step stays `rods`, so the squad can try again).
 */
export function dfEggTick(egg: DfEggState, dt: number, fuseIds: readonly string[], rodIds: readonly string[]): string[] {
    if (egg.step !== 'rods' || egg.rodTimer <= 0) return []
    egg.rodTimer = Math.max(0, egg.rodTimer - dt)
    if (egg.rodTimer > 0) return []
    const reset = [...egg.rodsOn]
    dfEggAdvance(egg, { kind: 'rodsReset' }, fuseIds, rodIds)
    return reset
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}
