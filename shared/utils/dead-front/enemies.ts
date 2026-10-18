import type { DfZombieAnim } from './protocol'
import { DF_MAX_ALIVE_ZOMBIES } from './constants'
import type { DfEnemyType, DfHitZone, Vec3 } from './types'

// Enemy definitions, round scaling and the hit test shared by the client
// (hit claims) and the server (validation). Owned by the server agent.

export interface DfEnemyDef {
    type: DfEnemyType
    name: string
    /** First round this type can appear. */
    minRound: number
    healthMult: number // on top of the round's base zombie health
    damage: number // per swipe
    attackRange: number
    attackCooldown: number
    radius: number
    height: number
    /** Head sphere centre height above the feet and radius. */
    headY: number
    headR: number
    /** Ground speeds in m/s for each locomotion anim. */
    speeds: { walk: number, run: number, sprint: number }
    /** Seconds between the swing starting (anim `attack`) and the hit landing. */
    windup: number
    /** Seconds per board torn from a barricade. */
    tearTime: number
    /** Iron helmet hit points as a fraction of the zombie's max health (brute only). */
    helmet?: number
}

export const DF_ENEMIES: Record<DfEnemyType, DfEnemyDef> = {
    shambler: {
        type: 'shambler', name: 'Shambler', minRound: 1, healthMult: 1, damage: 50, attackRange: 1.15, attackCooldown: 1.1,
        radius: 0.35, height: 1.8, headY: 1.62, headR: 0.17,
        speeds: { walk: 1.15, run: 3.0, sprint: 4.7 }, windup: 0.5, tearTime: 1.15
    },
    ghoul: {
        type: 'ghoul', name: 'Ghoul', minRound: 5, healthMult: 0.7, damage: 40, attackRange: 1.25, attackCooldown: 0.75,
        radius: 0.32, height: 1.7, headY: 1.5, headR: 0.16,
        speeds: { walk: 2.2, run: 4.4, sprint: 5.4 }, windup: 0.32, tearTime: 0.8
    },
    brute: {
        type: 'brute', name: 'Ironclad Brute', minRound: 8, healthMult: 4, damage: 90, attackRange: 1.6, attackCooldown: 1.8,
        radius: 0.55, height: 2.3, headY: 2.05, headR: 0.22,
        speeds: { walk: 1.35, run: 2.5, sprint: 3.4 }, windup: 0.75, tearTime: 0.7, helmet: 0.6
    },
    bloater: {
        type: 'bloater', name: 'Bloater', minRound: 12, healthMult: 1.8, damage: 40, attackRange: 1.25, attackCooldown: 1.4,
        radius: 0.5, height: 1.9, headY: 1.65, headR: 0.18,
        speeds: { walk: 1.25, run: 1.9, sprint: 2.4 }, windup: 0.5, tearTime: 1.2
    }
}

/** Bloater ranged attack and death cloud. */
export const DF_BLOATER = {
    spitMin: 4.5, // metres: closer than this it backs off or swipes
    spitMax: 15,
    spitCooldown: 3.8,
    spitWindup: 0.75, // the rear-back before the lob: long enough to read
    spitSpeed: 10.5, // horizontal m/s of the lob, aimed where you stood at release (no leading)
    spitRadius: 1.5,
    spitDamage: 30,
    gasRadius: 3,
    gasSeconds: 8,
    gasDps: 16
} as const

/**
 * Ghoul leap: from a few metres out it crouches (`windup`, the tell), then
 * leaps along a locked line. Side-step or back off during the crouch and it
 * lands short or wide.
 */
export const DF_GHOUL_LUNGE = {
    minRange: 2.6,
    maxRange: 5.5,
    windup: 0.38,
    speed: 8.5, // m/s along the leap
    overshoot: 0.6, // metres past where you stood
    cooldown: 4.5,
    recover: 0.6 // seconds before it can swipe after landing
} as const

/**
 * Brute charge: it stops and roars (`windup`, the tell), then runs a straight
 * line at the spot you stood on. Get out of the line and it thunders past,
 * then stands winded for `recover` seconds.
 */
export const DF_BRUTE_CHARGE = {
    minRange: 5,
    maxRange: 16,
    windup: 0.9,
    speed: 7.5,
    maxTime: 1.8,
    damage: 80,
    cooldown: 8,
    recover: 1.3
} as const

/** Base zombie health for a round: +100 per round up to 9, then +10% per round. */
export function dfZombieBaseHealth(round: number): number {
    if (round <= 9) return 150 + (round - 1) * 100
    return Math.round(950 * Math.pow(1.1, round - 9))
}

const EARLY_COUNTS = [6, 8, 13, 18, 24]

/**
 * Zombies in a round: 6 on round 1 solo, 24 by round 5, then classic growth.
 * Each extra player adds 70% of a solo horde early and 8 per "squad" later,
 * so a full squad faces about twice the solo count: each player still has
 * half a horde to themselves.
 */
export function dfRoundZombieCount(round: number, players: number): number {
    const r = Math.max(1, Math.floor(round))
    const extra = Math.max(0, Math.min(3, players - 1))
    if (r <= EARLY_COUNTS.length) return Math.round(EARLY_COUNTS[r - 1]! * (1 + 0.7 * extra))
    let mult = r / 5
    if (r >= 10) mult *= 1 + (r - 9) * 0.06
    return Math.round((24 + 8 * extra) * mult)
}

/** Most zombies alive at once: the solo cap plus a couple per extra player. */
export function dfMaxAlive(players: number): number {
    return DF_MAX_ALIVE_ZOMBIES + 2 * Math.max(0, Math.min(3, players - 1))
}

/** Seconds between spawns: unhurried early, a flood later. */
export function dfSpawnInterval(round: number, players: number): number {
    const base = 2.1 * Math.pow(0.93, Math.max(0, round - 1))
    const crowd = 1 / (1 + 0.25 * Math.max(0, players - 1))
    return Math.max(0.35, base * crowd)
}

/** Brutes that join a round. */
export function dfBrutesInRound(round: number): number {
    if (round < DF_ENEMIES.brute.minRound) return 0
    return round >= 14 ? 2 : 1
}

/** Chance that a regular spawn is a ghoul / bloater on this round. */
export function dfSpecialChances(round: number): { ghoul: number, bloater: number } {
    const ghoul = round >= DF_ENEMIES.ghoul.minRound ? Math.min(0.35, 0.1 + (round - DF_ENEMIES.ghoul.minRound) * 0.025) : 0
    const bloater = round >= DF_ENEMIES.bloater.minRound ? Math.min(0.14, 0.06 + (round - DF_ENEMIES.bloater.minRound) * 0.01) : 0
    return { ghoul, bloater }
}

/** Shambler locomotion odds: walkers until round 3, runners from 4, some sprinters from 8. */
export function dfShamblerGait(round: number, roll: number): 'walk' | 'run' | 'sprint' {
    const sprint = round >= 8 ? Math.min(0.6, (round - 7) * 0.1) : 0
    const run = round >= 4 ? Math.min(1, (round - 3) * 0.3) : 0
    if (roll < sprint) return 'sprint'
    if (roll < Math.max(sprint, run)) return 'run'
    return 'walk'
}

export interface DfHitTestTarget {
    type: DfEnemyType
    pos: Vec3
    yaw: number
    anim: DfZombieAnim
}

/**
 * Ray against one zombie's hitboxes: head sphere, torso capsule and a legs
 * capsule (limb). Returns the zone and distance of the nearest hit, or null.
 * `dir` is normalised.
 */
export function dfZombieHitTest(target: DfHitTestTarget, origin: Vec3, dir: Vec3, maxDist: number): { zone: DfHitZone, dist: number } | null {
    const def = DF_ENEMIES[target.type]
    const p = target.pos
    let best: { zone: DfHitZone, dist: number } | null = null
    const head = { x: p.x, y: p.y + def.headY, z: p.z }
    const th = raySphere(origin, dir, head, def.headR)
    if (th !== null && th <= maxDist) best = { zone: 'head', dist: th }
    const hip = def.height * 0.47
    const torsoTop = def.headY - def.headR - def.radius * 0.35
    const tt = rayVerticalCapsule(origin, dir, p.x, p.z, p.y + hip, p.y + torsoTop, def.radius)
    if (tt !== null && tt <= maxDist && (!best || tt + 0.04 < best.dist)) best = { zone: 'body', dist: tt }
    const tl = rayVerticalCapsule(origin, dir, p.x, p.z, p.y + 0.12, p.y + hip, def.radius * 0.8)
    if (tl !== null && tl <= maxDist && (!best || tl + 0.04 < best.dist)) best = { zone: 'limb', dist: tl }
    return best
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
    const ox = o.x - c.x
    const oy = o.y - c.y
    const oz = o.z - c.z
    const b = ox * d.x + oy * d.y + oz * d.z
    const cc = ox * ox + oy * oy + oz * oz - r * r
    const disc = b * b - cc
    if (disc < 0) return null
    const t = -b - Math.sqrt(disc)
    if (t >= 0) return t
    return cc <= 0 ? 0 : null
}

/** Ray against a capsule whose axis is vertical from (x, y0, z) to (x, y1, z). */
function rayVerticalCapsule(o: Vec3, d: Vec3, x: number, z: number, y0: number, y1: number, r: number): number | null {
    // Infinite cylinder in xz first.
    const ox = o.x - x
    const oz = o.z - z
    const a = d.x * d.x + d.z * d.z
    let best: number | null = null
    if (a > 1e-9) {
        const b = ox * d.x + oz * d.z
        const c = ox * ox + oz * oz - r * r
        const disc = b * b - a * c
        if (disc >= 0) {
            const t = (-b - Math.sqrt(disc)) / a
            const tt = t >= 0 ? t : (c <= 0 ? 0 : -1)
            if (tt >= 0) {
                const y = o.y + d.y * tt
                if (y >= y0 && y <= y1) best = tt
            }
        }
    }
    const caps = [raySphere(o, d, { x, y: y0, z }, r), raySphere(o, d, { x, y: y1, z }, r)]
    for (const t of caps) if (t !== null && (best === null || t < best)) best = t
    return best
}
