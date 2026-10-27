import { DF_POINTS } from './constants'
import { DF_ENEMIES } from './enemies'
import type { DfWeaponStats } from './weapons'
import type { DfEnemyType, DfHitZone, DfPlayerEffects, Vec3 } from './types'

// Damage and points rules shared by the server (authoritative) and the client
// (instant hit / kill / points prediction). Pure and unit tested.

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

/**
 * Seconds between the +10s a flamethrower pays for burning one zombie. A jet
 * hits every zombie in it ~30 times a second, which would otherwise pay far
 * more than the kill.
 */
export const DF_FLAME_POINT_INTERVAL = 0.5

/**
 * Does a flame hit on zombie `zid` at `now` (seconds) pay its hit points?
 * Records the payment in `paid` (zombie id -> last paid time) and prunes it.
 */
export function dfFlameHitPays(paid: Map<number, number>, zid: number, now: number): boolean {
    const last = paid.get(zid)
    if (last !== undefined && now - last >= 0 && now - last < DF_FLAME_POINT_INTERVAL) return false
    paid.set(zid, now)
    if (paid.size > 64) {
        for (const [id, at] of paid) if (now - at > DF_FLAME_POINT_INTERVAL * 4) paid.delete(id)
    }
    return true
}

/** Points after the perk multiplier and double points. */
export function dfScalePoints(base: number, pointsMult: number, doublePoints: boolean): number {
    return Math.round(base * pointsMult * (doublePoints ? 2 : 1))
}

/**
 * Should the server take a client's kill claim? The client predicts from the
 * health fraction in its last snapshot (rounded, and a round trip old), so a
 * claim is honoured when the zombie is left with a sliver: up to most of one
 * more bullet, or 8% of its health. A zombie with clearly more left keeps it.
 */
export function dfKillClaimHonoured(hpAfter: number, dmg: number, maxHp: number): boolean {
    if (hpAfter <= 0) return true
    return hpAfter <= Math.max(dmg * 0.75, maxHp * 0.08)
}

// ---------------------------------------------------------------- wunderweapon aim

/** Metres from the eye to a zombie's body within which the wunderweapon's arc always takes it, if it is in front. */
export const DF_ARC_POINT_BLANK = 1.2
/** Half-width of the arc's aim cone per metre along the ray (about 13 degrees). */
const ARC_CONE = 0.225

/** A zombie's body for the arc: a vertical capsule from its feet up `height`. */
export interface DfArcBody {
    pos: Vec3
    radius: number
    height: number
}

/** The arc body of a zombie (a crawler lies low and long). */
export function dfArcBody(type: DfEnemyType, pos: Vec3, crawl = false): DfArcBody {
    const def = DF_ENEMIES[type]
    return crawl ? { pos, radius: def.radius + 0.3, height: 0.6 } : { pos, radius: def.radius, height: def.height }
}

/**
 * How the wunderweapon's ray takes a zombie as its first target. It aims at
 * the closest point of the body's axis (feet to crown), not a fixed chest
 * point: a zombie in your face has its chest well below the eye line, which
 * failed an angle check against the chest. Point blank (the eye within
 * `DF_ARC_POINT_BLANK` of the body, inside it, or past its axis) any zombie in
 * front is taken. Returns a score (lower is better), the point to arc to and
 * the distance along the ray, or null when the ray doesn't take it.
 */
export function dfArcAim(body: DfArcBody, origin: Vec3, dir: Vec3, range: number): { score: number, point: Vec3, dist: number } | null {
    const lo = body.pos.y + 0.1
    const hi = body.pos.y + Math.max(0.2, body.height)
    const dx = body.pos.x - origin.x
    const dz = body.pos.z - origin.z
    const h = Math.sqrt(dx * dx + dz * dz)
    const surface = h - body.radius
    if (surface <= DF_ARC_POINT_BLANK) {
        const dl = Math.sqrt(dir.x * dir.x + dir.z * dir.z)
        // looking nearly straight down or up: only what is right at your feet
        const front = h <= body.radius || (dl < 0.2 ? surface <= 0.6 : (dx * dir.x + dz * dir.z) / (h * dl) >= 0.5)
        if (front) {
            const y = clamp(origin.y + dir.y * Math.max(0.3, h), Math.min(hi, lo + 0.2), Math.max(lo, hi - 0.15))
            const d = Math.max(0, surface)
            return { score: d * 0.5, point: { x: body.pos.x, y, z: body.pos.z }, dist: d }
        }
    }
    // closest approach between the ray (s in [0, range]) and the axis (y in [lo, hi])
    const ry = origin.y - lo
    const b = dir.y
    const c = -dx * dir.x + ry * dir.y - dz * dir.z
    const denom = 1 - b * b
    let s = denom > 1e-9 ? (b * ry - c) / denom : 0
    s = clamp(s, 0, range)
    let u = b * s + ry
    const top = hi - lo
    if (u < 0 || u > top) {
        u = clamp(u, 0, top)
        s = clamp(b * u - c, 0, range)
    }
    const px = origin.x + dir.x * s - body.pos.x
    const py = origin.y + dir.y * s - (lo + u)
    const pz = origin.z + dir.z * s - body.pos.z
    const miss = Math.sqrt(px * px + py * py + pz * pz)
    if (s <= 0 || miss > body.radius + 0.1 + s * ARC_CONE) return null
    return { score: s + 4 * Math.max(0, miss - body.radius), point: { x: body.pos.x, y: lo + u, z: body.pos.z }, dist: s }
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}
