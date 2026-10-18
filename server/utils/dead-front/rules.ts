import { DF_POINTS } from '#shared/utils/dead-front/constants'
import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import type { DfEggState } from '#shared/utils/dead-front/protocol'
import { dfBoxWeight } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfEnemyType, DfHitZone, DfPlayerEffects, DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'

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

/** Keeps a head claim only if the ray passed near the head; otherwise it counts as a body hit. */
export function dfVerifyZone(target: DfClaimTarget, origin: Vec3, dir: Vec3, zone: DfHitZone): DfHitZone {
    if (zone !== 'head') return zone === 'limb' ? 'limb' : 'body'
    const def = DF_ENEMIES[target.type]
    const head = { x: target.pos.x, y: target.pos.y + def.headY, z: target.pos.z }
    const near = dfRayPointApproach(origin, dir, head)
    return near.miss <= def.headR + 0.35 + target.speed * 0.25 ? 'head' : 'body'
}

// ---------------------------------------------------------------- damage and points

/** Damage multiplier from distance: full up to `range`, easing to `minDamageMult` at `maxRange`. */
export function dfFalloff(stats: Pick<DfWeaponStats, 'range' | 'maxRange' | 'minDamageMult'>, dist: number): number {
    if (dist <= stats.range) return 1
    if (dist >= stats.maxRange || stats.maxRange <= stats.range) return stats.minDamageMult
    const k = (dist - stats.range) / (stats.maxRange - stats.range)
    return 1 + (stats.minDamageMult - 1) * k
}

/** One bullet's damage against a zone, with perk effects. */
export function dfBulletDamage(stats: DfWeaponStats, effects: DfPlayerEffects, zone: DfHitZone, dist: number, downed: boolean): number {
    const zoneMult = zone === 'head' ? stats.headMult * effects.headshotMult : zone === 'limb' ? stats.limbMult : 1
    const doubleTap = 1 + 0.3 * Math.max(0, effects.doubleTapBullets)
    return stats.damage * zoneMult * dfFalloff(stats, dist) * effects.damageMult * (downed ? effects.lastStandDamageMult : 1) * doubleTap
}

/** Points a lethal hit pays in total (the classic 60 / 100 / 130). */
export function dfKillPoints(zone: DfHitZone, melee: boolean): number {
    if (melee) return DF_POINTS.killMelee
    return zone === 'head' ? DF_POINTS.killHead : DF_POINTS.killBody
}

/** Points after the perk multiplier and double points. */
export function dfScalePoints(base: number, pointsMult: number, doublePoints: boolean): number {
    return Math.round(base * pointsMult * (doublePoints ? 2 : 1))
}

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
        | { kind: 'claim', pid: number }

/**
 * Advances the guided easter egg. Mutates `egg`; `stepChanged` tells the
 * caller to emit an `egg` event, `progressed` that the action counted.
 */
export function dfEggAdvance(egg: DfEggState, action: DfEggAction, fuseIds: readonly string[]): { progressed: boolean, stepChanged: boolean } {
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
                if (egg.charge >= action.needed) egg.step = 'claim'
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

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}
