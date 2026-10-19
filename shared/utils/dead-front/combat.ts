import { DF_POINTS } from './constants'
import type { DfWeaponStats } from './weapons'
import type { DfHitZone, DfPlayerEffects } from './types'

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
