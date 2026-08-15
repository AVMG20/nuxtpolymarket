// Call of Xeno — pure game rules.
//
// Deterministic data and maths: weapon stats, the Pack-a-Punch ladder, the
// enemy roster, round scaling, power-ups and the point economy. The three.js
// scene, input and rendering live in the client component; keeping the rules in
// `shared` means they can be unit tested without a DOM or a WebGL context.
//
// Everything that will eventually need to scale with a difficulty setting or a
// permanent upgrade is a function of its inputs, never a branch on global
// state, so those can be threaded through later without reshaping the sim.

export type CallOfXenoWeaponId
    = | 'm1911'
      | 'skorpion'
      | 'magnum'
      | 'trench'
      | 'mp40'
      | 'ak74'
      | 'bar'
      | 'rpk'
      | 'xenoray'

export type CallOfXenoPerkId = 'juggernog' | 'speedcola' | 'doubletap' | 'quickrevive'

export interface CallOfXenoWeapon {
    id: CallOfXenoWeaponId
    name: string
    damage: number
    /** Pellets fired per trigger pull. Only the shotgun fires more than one. */
    pellets: number
    fireDelay: number
    magSize: number
    reserveAmmo: number
    reloadTime: number
    /** Cone half-angle in radians applied to every pellet. */
    spread: number
    range: number
    /** How many enemies a single shot passes through (1 = no penetration). */
    penetration: number
    automatic: boolean
    /** Wall-buy price. Zero means it is not sold on a wall. */
    cost: number
    /** Base name the Pack-a-Punch ladder builds on. */
    upgradedName: string
}

export const CALL_OF_XENO_WEAPONS: Record<CallOfXenoWeaponId, CallOfXenoWeapon> = {
    m1911: {
        id: 'm1911',
        name: 'M1911',
        damage: 40,
        pellets: 1,
        fireDelay: 0.22,
        magSize: 8,
        reserveAmmo: 80,
        reloadTime: 1.5,
        spread: 0.012,
        range: 60,
        penetration: 1,
        automatic: false,
        cost: 0,
        upgradedName: 'Mustang & Sally'
    },
    skorpion: {
        id: 'skorpion',
        name: 'Skorpion',
        damage: 32,
        pellets: 1,
        fireDelay: 0.055,
        magSize: 20,
        reserveAmmo: 220,
        reloadTime: 1.9,
        spread: 0.05,
        range: 35,
        penetration: 1,
        automatic: true,
        cost: 1000,
        upgradedName: 'Czech Bounce'
    },
    magnum: {
        id: 'magnum',
        name: '.44 Magnum',
        damage: 165,
        pellets: 1,
        fireDelay: 0.42,
        magSize: 6,
        reserveAmmo: 66,
        reloadTime: 2.7,
        spread: 0.015,
        range: 55,
        penetration: 2,
        automatic: false,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: '.44 Anaconda'
    },
    trench: {
        id: 'trench',
        name: 'Trench Gun',
        damage: 60,
        pellets: 8,
        fireDelay: 0.85,
        magSize: 6,
        reserveAmmo: 48,
        reloadTime: 2.6,
        spread: 0.09,
        range: 18,
        penetration: 2,
        automatic: false,
        cost: 1500,
        upgradedName: 'Gut Shot'
    },
    mp40: {
        id: 'mp40',
        name: 'MP-40',
        damage: 55,
        pellets: 1,
        fireDelay: 0.09,
        magSize: 32,
        reserveAmmo: 256,
        reloadTime: 2.2,
        spread: 0.03,
        range: 45,
        penetration: 1,
        automatic: true,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: 'The Afterburner'
    },
    ak74: {
        id: 'ak74',
        name: 'AK-74',
        damage: 95,
        pellets: 1,
        fireDelay: 0.11,
        magSize: 30,
        reserveAmmo: 240,
        reloadTime: 2.4,
        spread: 0.022,
        range: 70,
        penetration: 2,
        automatic: true,
        cost: 1800,
        upgradedName: 'AK-74fu2'
    },
    bar: {
        id: 'bar',
        name: 'BAR',
        damage: 160,
        pellets: 1,
        fireDelay: 0.16,
        magSize: 24,
        reserveAmmo: 192,
        reloadTime: 3.1,
        spread: 0.028,
        range: 65,
        penetration: 2,
        automatic: true,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: 'Browning M1918'
    },
    rpk: {
        id: 'rpk',
        name: 'RPK',
        damage: 130,
        pellets: 1,
        fireDelay: 0.1,
        magSize: 75,
        reserveAmmo: 300,
        reloadTime: 4,
        spread: 0.035,
        range: 70,
        penetration: 3,
        automatic: true,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: 'R115 Resonator'
    },
    xenoray: {
        id: 'xenoray',
        name: 'Xeno Ray',
        damage: 900,
        pellets: 1,
        fireDelay: 0.55,
        magSize: 10,
        reserveAmmo: 40,
        reloadTime: 3.2,
        spread: 0,
        range: 90,
        penetration: 12,
        automatic: false,
        // Mystery box only — there is no wall that sells the wonder weapon.
        cost: 0,
        upgradedName: 'Porter\'s X2 Xeno Ray'
    }
}

/**
 * Weapons sold on a wall, in the order they appear across the map. Kept to
 * three on purpose: the wall is the reliable floor, everything else has to
 * come out of the box, so a spin is always worth taking.
 */
export const CALL_OF_XENO_WALL_WEAPONS: CallOfXenoWeaponId[] = ['skorpion', 'trench', 'ak74']

export interface CallOfXenoPerk {
    id: CallOfXenoPerkId
    name: string
    cost: number
    description: string
    color: number
}

export const CALL_OF_XENO_PERKS: Record<CallOfXenoPerkId, CallOfXenoPerk> = {
    juggernog: {
        id: 'juggernog',
        name: 'Juggernog',
        cost: 2500,
        description: 'Raises max health from 100 to 250.',
        color: 0xcc2222
    },
    speedcola: {
        id: 'speedcola',
        name: 'Speed Cola',
        cost: 3000,
        description: 'Reloads take half as long.',
        color: 0x22cc55
    },
    doubletap: {
        id: 'doubletap',
        name: 'Double Tap',
        cost: 2000,
        description: 'Fires 33% faster and deals 1.5x damage.',
        color: 0xdd8800
    },
    quickrevive: {
        id: 'quickrevive',
        name: 'Quick Revive',
        cost: 500,
        description: 'Health starts regenerating twice as fast.',
        color: 0x33aadd
    }
}

export const CALL_OF_XENO_BASE_HEALTH = 100
export const CALL_OF_XENO_JUGGERNOG_HEALTH = 250
export const CALL_OF_XENO_REGEN_DELAY = 3.5
export const CALL_OF_XENO_REGEN_RATE = 20

export const CALL_OF_XENO_HIT_POINTS = 10
export const CALL_OF_XENO_KILL_POINTS = 60
export const CALL_OF_XENO_HEADSHOT_POINTS = 100
export const CALL_OF_XENO_STARTING_POINTS = 500

// ---------------------------------------------------------------------------
// Pack-a-Punch ladder
// ---------------------------------------------------------------------------

export interface CallOfXenoPapTier {
    /** Price to move up to this tier. */
    cost: number
    damage: number
    mag: number
    reserve: number
    penetration: number
    /** Appended to the weapon's upgraded name. */
    suffix: string
}

/**
 * Three upgrades deep. Each one is a real step up and a much bigger bill, so
 * the machine stays a points sink all the way into the late rounds instead of
 * going quiet the moment you first use it.
 */
export const CALL_OF_XENO_PAP_TIERS: CallOfXenoPapTier[] = [
    { cost: 5000, damage: 2.5, mag: 1.5, reserve: 2, penetration: 1, suffix: '' },
    { cost: 15000, damage: 4.5, mag: 1.75, reserve: 2.75, penetration: 2, suffix: ' II' },
    { cost: 30000, damage: 7.5, mag: 2, reserve: 3.5, penetration: 3, suffix: ' III' }
]

export const CALL_OF_XENO_MAX_PAP_TIER = CALL_OF_XENO_PAP_TIERS.length

/** Price to go from `tier` to `tier + 1`, or null when the weapon is maxed. */
export function packAPunchCost(tier: number): number | null {
    if (tier >= CALL_OF_XENO_MAX_PAP_TIER) return null
    return CALL_OF_XENO_PAP_TIERS[tier]!.cost
}

/** The weapon as it exists at a given upgrade tier. Tier 0 is untouched. */
export function packAPunch(weapon: CallOfXenoWeapon, tier: number): CallOfXenoWeapon {
    if (tier <= 0) return weapon
    const step = CALL_OF_XENO_PAP_TIERS[Math.min(tier, CALL_OF_XENO_MAX_PAP_TIER) - 1]!
    return {
        ...weapon,
        name: weapon.upgradedName + step.suffix,
        damage: Math.round(weapon.damage * step.damage),
        magSize: Math.round(weapon.magSize * step.mag),
        reserveAmmo: Math.round(weapon.reserveAmmo * step.reserve),
        penetration: weapon.penetration + step.penetration
    }
}

/** Ammo-refill price at a wall buy — half the weapon's purchase price. */
export function ammoCost(weapon: CallOfXenoWeapon): number {
    return Math.floor(weapon.cost / 2)
}

// ---------------------------------------------------------------------------
// Mystery box
// ---------------------------------------------------------------------------

export const CALL_OF_XENO_BOX_COST = 950

/**
 * Every weapon that is not on a wall lives here, and so do the three that are
 * — the box stays worth spinning at every stage of a run, and it is the only
 * source of the Magnum, the MP-40, the BAR, the RPK and the wonder weapon.
 */
export const CALL_OF_XENO_BOX_POOL: { weapon: CallOfXenoWeaponId, weight: number }[] = [
    { weapon: 'mp40', weight: 7 },
    { weapon: 'magnum', weight: 6 },
    { weapon: 'bar', weight: 5 },
    { weapon: 'rpk', weight: 5 },
    { weapon: 'trench', weight: 4 },
    { weapon: 'ak74', weight: 4 },
    { weapon: 'skorpion', weight: 3 },
    { weapon: 'xenoray', weight: 2 }
]

// ---------------------------------------------------------------------------
// Enemy roster
// ---------------------------------------------------------------------------

export type CallOfXenoEnemyId = 'shambler' | 'crawler' | 'husk' | 'drone' | 'brute'

export interface CallOfXenoRangedAttack {
    /** Distance the enemy tries to hold, in world units. */
    standoff: number
    /** Furthest it will open fire from. */
    range: number
    cooldown: number
    projectileSpeed: number
    damage: number
}

export interface CallOfXenoEnemy {
    id: CallOfXenoEnemyId
    name: string
    healthMultiplier: number
    speedMultiplier: number
    damageMultiplier: number
    /** Model scale, and the collision/hit radius scales with it. */
    scale: number
    color: number
    /** Points multiplier on hits and kills. */
    reward: number
    /** First round this type can appear. */
    minRound: number
    /** Relative spawn weight once unlocked. */
    weight: number
    ranged?: CallOfXenoRangedAttack
    /** Extra damage multiplier on the glowing weak point, if it has one. */
    weakPoint?: number
    /** Floats above the floor rather than walking. */
    flies?: boolean
}

export const CALL_OF_XENO_ENEMIES: Record<CallOfXenoEnemyId, CallOfXenoEnemy> = {
    shambler: {
        id: 'shambler',
        name: 'Shambler',
        healthMultiplier: 1,
        speedMultiplier: 1,
        damageMultiplier: 1,
        scale: 1,
        color: 0x6f8a52,
        reward: 1,
        minRound: 1,
        weight: 10
    },
    crawler: {
        id: 'crawler',
        name: 'Crawler',
        healthMultiplier: 0.35,
        speedMultiplier: 1.45,
        damageMultiplier: 0.5,
        scale: 0.58,
        color: 0x8a9c3a,
        reward: 0.6,
        minRound: 4,
        weight: 6
    },
    husk: {
        id: 'husk',
        name: 'Husk',
        healthMultiplier: 0.7,
        speedMultiplier: 1.75,
        damageMultiplier: 0.9,
        scale: 0.95,
        color: 0xb35c3a,
        reward: 1.3,
        minRound: 6,
        weight: 5
    },
    drone: {
        id: 'drone',
        name: 'Xeno Drone',
        healthMultiplier: 0.55,
        speedMultiplier: 0.85,
        damageMultiplier: 1,
        scale: 0.85,
        color: 0x3fb9c9,
        reward: 1.8,
        minRound: 8,
        weight: 4,
        flies: true,
        ranged: {
            standoff: 9,
            range: 26,
            cooldown: 2.4,
            projectileSpeed: 13,
            damage: 18
        }
    },
    brute: {
        id: 'brute',
        name: 'Brute',
        healthMultiplier: 6,
        speedMultiplier: 0.62,
        damageMultiplier: 2.2,
        scale: 1.5,
        color: 0x7a4a6a,
        reward: 4,
        minRound: 10,
        weight: 2,
        weakPoint: 3
    }
}

/** Types that can spawn on a normal round, with their weights. */
export function roundComposition(round: number): { enemy: CallOfXenoEnemyId, weight: number }[] {
    const r = Math.max(1, Math.floor(round))
    return (Object.keys(CALL_OF_XENO_ENEMIES) as CallOfXenoEnemyId[])
        .map(id => CALL_OF_XENO_ENEMIES[id])
        .filter(enemy => r >= enemy.minRound)
        .map(enemy => ({
            enemy: enemy.id,
            // Shamblers thin out as the specials arrive rather than vanishing.
            weight: enemy.id === 'shambler' ? Math.max(3, enemy.weight - Math.floor(r / 5)) : enemy.weight
        }))
}

/** Every fifth round is a single-type round with a fat payout. */
export function isSpecialRound(round: number): boolean {
    return Math.floor(round) >= 5 && Math.floor(round) % 5 === 0
}

const SPECIAL_CYCLE: CallOfXenoEnemyId[] = ['crawler', 'husk', 'drone', 'brute']

export function specialRoundEnemy(round: number): CallOfXenoEnemyId {
    const index = Math.floor(Math.floor(round) / 5) - 1
    return SPECIAL_CYCLE[Math.min(index, SPECIAL_CYCLE.length - 1)] ?? 'crawler'
}

/** Points multiplier applied to everything killed during a special round. */
export const CALL_OF_XENO_SPECIAL_ROUND_BONUS = 2

// ---------------------------------------------------------------------------
// Round modifiers
// ---------------------------------------------------------------------------

export type CallOfXenoModifier = 'none' | 'blackout' | 'fog' | 'frenzy'

export interface CallOfXenoModifierSpec {
    id: CallOfXenoModifier
    name: string
    description: string
}

export const CALL_OF_XENO_MODIFIERS: Record<CallOfXenoModifier, CallOfXenoModifierSpec> = {
    none: { id: 'none', name: '', description: '' },
    blackout: { id: 'blackout', name: 'Blackout', description: 'Power cuts out. Perks and Pack-a-Punch go dark.' },
    fog: { id: 'fog', name: 'Fog', description: 'Coolant vents. You cannot see them coming.' },
    frenzy: { id: 'frenzy', name: 'Frenzy', description: 'Everything moves faster.' }
}

const MODIFIER_CYCLE: CallOfXenoModifier[] = ['fog', 'frenzy', 'blackout']

/**
 * From round 8, every third round gets a modifier. Special rounds are already
 * their own event, so they stay clean.
 */
export function roundModifier(round: number): CallOfXenoModifier {
    const r = Math.floor(round)
    if (r < 8 || isSpecialRound(r)) return 'none'
    if (r % 3 !== 2) return 'none'
    return MODIFIER_CYCLE[Math.floor((r - 8) / 3) % MODIFIER_CYCLE.length]!
}

export const CALL_OF_XENO_FRENZY_SPEED = 1.35

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------

export type CallOfXenoPowerUpId = 'instakill' | 'doublepoints' | 'maxammo' | 'nuke'

export interface CallOfXenoPowerUp {
    id: CallOfXenoPowerUpId
    name: string
    /** Seconds it stays active. Zero means it fires once and is gone. */
    duration: number
    color: number
    weight: number
}

export const CALL_OF_XENO_POWERUPS: Record<CallOfXenoPowerUpId, CallOfXenoPowerUp> = {
    instakill: { id: 'instakill', name: 'Insta-Kill', duration: 30, color: 0xff4444, weight: 3 },
    doublepoints: { id: 'doublepoints', name: 'Double Points', duration: 30, color: 0xffd23f, weight: 3 },
    maxammo: { id: 'maxammo', name: 'Max Ammo', duration: 0, color: 0x4fc3f7, weight: 3 },
    nuke: { id: 'nuke', name: 'Nuke', duration: 0, color: 0x9ae66e, weight: 2 }
}

/** Chance a kill leaves a power-up behind. */
export const CALL_OF_XENO_POWERUP_CHANCE = 0.04
/** Seconds a dropped power-up waits on the floor before it fades. */
export const CALL_OF_XENO_POWERUP_LIFETIME = 22
/** Points the Nuke pays for wiping the field. */
export const CALL_OF_XENO_NUKE_POINTS = 400

// ---------------------------------------------------------------------------
// Point economy
// ---------------------------------------------------------------------------

/** Seconds a kill keeps the streak alive. */
export const CALL_OF_XENO_STREAK_WINDOW = 3

/**
 * Chained kills ramp the payout. Capped at 3x so a good push feels great
 * without making the late rounds trivial to bank.
 */
export function streakMultiplier(streak: number): number {
    if (streak < 3) return 1
    if (streak < 6) return 1.25
    if (streak < 10) return 1.5
    if (streak < 15) return 2
    if (streak < 25) return 2.5
    return 3
}

/** Bonus points for dropping several enemies with a single shot. */
export function multiKillBonus(count: number): number {
    if (count < 3) return 0
    return 50 * (count - 2)
}

// ---------------------------------------------------------------------------
// Round scaling
// ---------------------------------------------------------------------------

/**
 * Base enemy health per round, before the type multiplier. Flat +100 a round
 * through round 9, then compounding 10% — the classic curve, which keeps early
 * rounds a two-shot affair and makes Pack-a-Punch mandatory past round 20.
 */
export function zombieHealth(round: number): number {
    const r = Math.max(1, Math.floor(round))
    if (r <= 9) return 50 + r * 100
    let health = 950
    for (let i = 10; i <= r; i++) health *= 1.1
    return Math.round(health)
}

/** How many enemies the round spawns in total. */
export function zombieCount(round: number): number {
    const r = Math.max(1, Math.floor(round))
    if (isSpecialRound(r)) return Math.min(64, 12 + Math.floor(r * 3))
    return Math.min(56, 6 + Math.floor(r * 3))
}

/** Base movement speed in world units per second, before the type multiplier. */
export function zombieSpeed(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.min(5.2, 1.6 + r * 0.14)
}

/** Seconds between spawns during a round. */
export function zombieSpawnInterval(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.max(0.22, 2.2 - r * 0.11)
}

/** Base contact damage, before the type multiplier. */
export function zombieDamage(round: number): number {
    return Math.max(1, Math.floor(round)) <= 9 ? 25 : 45
}

/**
 * How many can be on the field at once. Ramps hard: the difference between
 * round 6 and round 16 should be the wall of bodies, not just their health.
 */
export function maxAlive(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.min(34, 10 + Math.floor(r * 1.6))
}

/** Seconds of breathing room between rounds. */
export const CALL_OF_XENO_ROUND_BREAK = 4
