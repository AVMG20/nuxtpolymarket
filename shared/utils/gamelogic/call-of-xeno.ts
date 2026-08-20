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
      | 'm60'
      | 'fnmag'
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
    /** Rounds detonate: splash damage around every impact. */
    explosive?: boolean
    /** Fires a physical round that flies and detonates on any impact. */
    projectile?: boolean
    /** Splash radius in metres for explosive rounds. */
    blastRadius?: number
    /**
     * Walking and sprint speed multiplier while held. Defaults to 1; heavier
     * weapons pay a tax — pistol and SMGs fastest, belt-feds slowest.
     */
    mobility?: number
    /**
     * How quickly the sight settles when aiming, in blend-units per second.
     * Light weapons snap in, belt-feds lug the gun up. Defaults to 9.
     */
    aimSpeed?: number
    /** Seconds the draw animation locks firing after a swap. Defaults to 0.22. */
    swapTime?: number
    /**
     * Cone half-angle in radians once fully aimed. No gun is a laser —
     * distant targets stay a real shot. Defaults to a third of hip spread.
     */
    adsSpread?: number
    /**
     * Radians the muzzle climbs per shot, plus a little random side wobble
     * of the same order. Heavier calibres kick harder; rapid guns kick
     * small but often. Aiming soaks up a quarter of it.
     */
    recoilKick?: number
    /** Metres out to which a round deals full damage. Undefined = no falloff. */
    falloffStart?: number
    /** Damage multiplier left at the weapon's maximum range. */
    falloffMin?: number
}

/** The wonder weapon's bolt pops with a very small blast. */
export const CALL_OF_XENO_RAY_BLAST_RADIUS = 1.5

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
        upgradedName: 'Sally',
        aimSpeed: 13,
        swapTime: 0.16,
        adsSpread: 0.010,
        recoilKick: 0.02,
        falloffStart: 22,
        falloffMin: 0.65
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
        upgradedName: 'Czech Bounce',
        mobility: 1,
        aimSpeed: 13,
        swapTime: 0.18,
        adsSpread: 0.014,
        recoilKick: 0.006,
        falloffStart: 13,
        falloffMin: 0.5
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
        upgradedName: '.44 Anaconda',
        mobility: 0.995,
        aimSpeed: 10,
        swapTime: 0.22,
        adsSpread: 0.007,
        recoilKick: 0.055,
        falloffStart: 32,
        falloffMin: 0.75
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
        upgradedName: 'Gut Shot',
        mobility: 0.955,
        aimSpeed: 11,
        swapTime: 0.26,
        adsSpread: 0.028,
        recoilKick: 0.065,
        falloffStart: 8,
        falloffMin: 0.35
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
        upgradedName: 'The Afterburner',
        mobility: 0.99,
        aimSpeed: 12.5,
        swapTime: 0.2,
        adsSpread: 0.012,
        recoilKick: 0.009,
        falloffStart: 18,
        falloffMin: 0.6
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
        upgradedName: 'AK-74fu2',
        mobility: 0.97,
        aimSpeed: 10,
        swapTime: 0.24,
        adsSpread: 0.007,
        recoilKick: 0.013,
        falloffStart: 38,
        falloffMin: 0.8
    },
    bar: {
        id: 'bar',
        name: 'BAR',
        damage: 160,
        pellets: 1,
        fireDelay: 0.16,
        magSize: 24,
        reserveAmmo: 192,
        reloadTime: 3.3,
        spread: 0.028,
        range: 65,
        penetration: 2,
        automatic: true,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: 'Browning M1918',
        mobility: 0.94,
        aimSpeed: 7.5,
        swapTime: 0.34,
        adsSpread: 0.008,
        recoilKick: 0.02,
        falloffStart: 42,
        falloffMin: 0.82
    },
    rpk: {
        id: 'rpk',
        name: 'RPK',
        damage: 130,
        pellets: 1,
        fireDelay: 0.1,
        magSize: 75,
        reserveAmmo: 300,
        reloadTime: 4.4,
        spread: 0.035,
        range: 70,
        penetration: 3,
        automatic: true,
        // Box only — this one is not sold on any wall.
        cost: 0,
        upgradedName: 'R115 Resonator',
        mobility: 0.91,
        aimSpeed: 5.5,
        swapTime: 0.42,
        adsSpread: 0.012,
        recoilKick: 0.014,
        falloffStart: 40,
        falloffMin: 0.8
    },
    m60: {
        id: 'm60',
        name: 'M60',
        damage: 150,
        pellets: 1,
        fireDelay: 0.095,
        magSize: 100,
        reserveAmmo: 400,
        reloadTime: 6,
        spread: 0.042,
        range: 70,
        penetration: 3,
        automatic: true,
        // Box only — the belt-fed pig: the biggest magazine in the game and
        // the slowest reload, the heaviest legs and the slug-slow sights.
        // The trade for all that sustained damage.
        cost: 0,
        mobility: 0.88,
        aimSpeed: 4.5,
        swapTime: 0.5,
        adsSpread: 0.014,
        recoilKick: 0.016,
        falloffStart: 40,
        falloffMin: 0.78,
        upgradedName: 'The Chopper'
    },
    fnmag: {
        id: 'fnmag',
        name: 'FNMAG',
        damage: 175,
        pellets: 1,
        fireDelay: 0.115,
        magSize: 55,
        reserveAmmo: 300,
        reloadTime: 5.6,
        spread: 0.036,
        range: 72,
        penetration: 3,
        automatic: true,
        // Box only — the other belt-fed: slower cadence, harder hits, and
        // the same heavy-weapon handling tax as the M60.
        cost: 0,
        mobility: 0.89,
        aimSpeed: 5,
        swapTime: 0.46,
        adsSpread: 0.011,
        recoilKick: 0.021,
        falloffStart: 42,
        falloffMin: 0.8,
        upgradedName: 'Magnetron'
    },
    xenoray: {
        id: 'xenoray',
        name: 'Xeno Ray',
        damage: 1860,
        pellets: 1,
        fireDelay: 0.55,
        magSize: 10,
        reserveAmmo: 40,
        reloadTime: 3.2,
        spread: 0,
        range: 90,
        penetration: 12,
        automatic: false,
        // Fires a slow energy bolt that pops with a very small blast.
        explosive: true,
        projectile: true,
        blastRadius: CALL_OF_XENO_RAY_BLAST_RADIUS,
        // Mystery box only — there is no wall that sells the wonder weapon.
        cost: 0,
        mobility: 0.97,
        aimSpeed: 8,
        swapTime: 0.3,
        // Pinpoint sights are the wonder weapon's privilege; its damage
        // already softens with the beam's own distance falloff.
        adsSpread: 0,
        recoilKick: 0.015,
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
        cost: 2500,
        description: 'Reloads take half as long.',
        color: 0x22cc55
    },
    doubletap: {
        id: 'doubletap',
        name: 'Double Tap',
        cost: 2500,
        description: 'Fires 33% faster and deals 1.5x damage.',
        color: 0xdd8800
    },
    quickrevive: {
        id: 'quickrevive',
        name: 'Quick Revive',
        cost: 500,
        description: '3 per run. On death, get back up.',
        color: 0x33aadd
    }
}

/**
 * Every perk starts at the same base price and climbs a step for each perk
 * already carried. Quick Revive is the exception: cheap once, then full
 * price, and only three purchases survive in a single run.
 */
export const CALL_OF_XENO_PERK_BASE_COST = 2500
export const CALL_OF_XENO_PERK_COST_STEP = 500
export const CALL_OF_XENO_QUICK_REVIVE_FIRST_COST = 500
export const CALL_OF_XENO_QUICK_REVIVE_COST = 2500
export const CALL_OF_XENO_QUICK_REVIVE_MAX_BUYS = 3

/** Price of a perk given what the player already carries. */
export function perkPrice(perkId: CallOfXenoPerkId, perksOwned: number, quickReviveBuys: number): number {
    if (perkId === 'quickrevive') {
        return quickReviveBuys <= 0 ? CALL_OF_XENO_QUICK_REVIVE_FIRST_COST : CALL_OF_XENO_QUICK_REVIVE_COST
    }
    return CALL_OF_XENO_PERK_BASE_COST + CALL_OF_XENO_PERK_COST_STEP * perksOwned
}

export const CALL_OF_XENO_BASE_HEALTH = 100
export const CALL_OF_XENO_JUGGERNOG_HEALTH = 250
export const CALL_OF_XENO_REGEN_DELAY = 3.5
export const CALL_OF_XENO_REGEN_RATE = 20

export const CALL_OF_XENO_HIT_POINTS = 10
export const CALL_OF_XENO_KILL_POINTS = 100
export const CALL_OF_XENO_HEADSHOT_POINTS = 120
export const CALL_OF_XENO_KNIFE_KILL_POINTS = 130
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

/**
 * The Xeno Ray fires a wide beam: brutal inside a room, but the beam diffuses
 * so the damage falls off with distance. Un-upgraded it drops to a sliver at
 * long range; each Pack-a-Punch tier tightens the beam and pushes the falloff
 * out, so the wonder weapon stays good but never stays a one-shot forever —
 * by the deep rounds even a maxed ray needs follow-up shots.
 */
export const CALL_OF_XENO_RAY_FALLOFF_START = 14
export const CALL_OF_XENO_RAY_FALLOFF_END = 46
/** Fraction of base damage left at the falloff end, per PaP tier (0-3). */
export const CALL_OF_XENO_RAY_FALLOFF_FLOOR = [0.12, 0.2, 0.3, 0.42]

/**
 * Sally — the Pack-a-Punched M1911 — trades nearly all of its ammo for the
 * biggest damage jump on the ladder. It is a grenade-launcher pistol: one
 * loud round, a wide blast, and a pocket of spare shots you can count.
 */
export const CALL_OF_XENO_SALLY_DAMAGE = [820, 1300, 2000]
export const CALL_OF_XENO_SALLY_MAG = 8
export const CALL_OF_XENO_SALLY_RESERVE = 50
export const CALL_OF_XENO_SALLY_BLAST_RADIUS = 3.2

/**
 * Standing inside your own blast hurts. The fraction is taken of the blast
 * damage at the player's distance from the centre, then capped so a close
 * quarters detonation stings instead of ending the run outright.
 */
export const CALL_OF_XENO_BLAST_SELF_FRACTION = 0.2
export const CALL_OF_XENO_BLAST_SELF_CAP = 35

/** Blast radius of a fuel barrel going up. */
export const CALL_OF_XENO_BARREL_BLAST_RADIUS = 3.8

/**
 * Damage the player takes for standing `distance` from the centre of a
 * blast — their own launcher round, or a fuel barrel they set off. Zero
 * once they are clear of it. The cap is what keeps a close detonation a
 * hard lesson rather than the end of the run.
 */
export function blastSelfDamage(distance: number, damage: number, blastRadius: number): number {
    const reach = blastRadius + 0.4
    if (distance >= reach) return 0
    const falloff = Math.max(0.25, 1 - distance / reach)
    return Math.round(Math.min(CALL_OF_XENO_BLAST_SELF_CAP, damage * CALL_OF_XENO_BLAST_SELF_FRACTION * falloff))
}

/** Damage multiplier for a ray hit at `distance` for a weapon at `papTier`. */
export function xenoRayFalloff(distance: number, papTier: number): number {
    const start = CALL_OF_XENO_RAY_FALLOFF_START + papTier * 6
    const end = CALL_OF_XENO_RAY_FALLOFF_END + papTier * 8
    if (distance <= start) return 1
    if (distance >= end) return CALL_OF_XENO_RAY_FALLOFF_FLOOR[Math.min(papTier, 3)]!
    const t = (distance - start) / (end - start)
    const floor = CALL_OF_XENO_RAY_FALLOFF_FLOOR[Math.min(papTier, 3)]!
    return 1 - (1 - floor) * t
}

/**
 * Damage multiplier for a conventional hitscan round at `distance` metres:
 * full damage out to the weapon's falloffStart, then a linear slide down to
 * falloffMin at maximum range. Room fights never notice it; cross-map spray
 * does. Short-range guns (SMGs, the shotgun) fall hardest, rifles least.
 */
export function xenoDamageFalloff(weapon: CallOfXenoWeapon, distance: number): number {
    if (weapon.falloffStart === undefined || weapon.falloffMin === undefined) return 1
    if (distance <= weapon.falloffStart) return 1
    const span = Math.max(1, weapon.range - weapon.falloffStart)
    const t = Math.min(1, (distance - weapon.falloffStart) / span)
    return 1 - (1 - weapon.falloffMin) * t
}

/** Price to go from `tier` to `tier + 1`, or null when the weapon is maxed. */
export function packAPunchCost(tier: number): number | null {
    if (tier >= CALL_OF_XENO_MAX_PAP_TIER) return null
    return CALL_OF_XENO_PAP_TIERS[tier]!.cost
}

/** The weapon as it exists at a given upgrade tier. Tier 0 is untouched. */
export function packAPunch(weapon: CallOfXenoWeapon, tier: number): CallOfXenoWeapon {
    if (tier <= 0) return weapon
    const step = CALL_OF_XENO_PAP_TIERS[Math.min(tier, CALL_OF_XENO_MAX_PAP_TIER) - 1]!
    const upgraded: CallOfXenoWeapon = {
        ...weapon,
        name: weapon.upgradedName + step.suffix,
        damage: Math.round(weapon.damage * step.damage),
        magSize: Math.round(weapon.magSize * step.mag),
        reserveAmmo: Math.round(weapon.reserveAmmo * step.reserve),
        penetration: weapon.penetration + step.penetration
    }
    // Pack-a-Punching the starting M1911 forges Sally: a single explosive
    // hand cannon that lobs a detonating round. The biggest damage step on
    // the ladder, paid for with a tiny ammo pool.
    if (weapon.id === 'm1911') {
        const t = Math.min(tier, CALL_OF_XENO_MAX_PAP_TIER)
        upgraded.name = 'Sally' + step.suffix
        upgraded.damage = CALL_OF_XENO_SALLY_DAMAGE[t - 1]!
        upgraded.magSize = CALL_OF_XENO_SALLY_MAG
        upgraded.reserveAmmo = CALL_OF_XENO_SALLY_RESERVE
        upgraded.fireDelay = 0.5
        upgraded.reloadTime = 2.6
        upgraded.explosive = true
        upgraded.projectile = true
        upgraded.blastRadius = CALL_OF_XENO_SALLY_BLAST_RADIUS
        upgraded.spread = 0.015
        upgraded.range = Math.max(weapon.range, 40)
    }
    // The belt-feds trade the ladder's magazine growth for one set step:
    // 100 to 150 on the M60, 55 to 75 on the FNMAG, at every tier.
    if (weapon.id === 'm60') upgraded.magSize = 150
    if (weapon.id === 'fnmag') upgraded.magSize = 75
    return upgraded
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
    { weapon: 'm60', weight: 4 },
    { weapon: 'fnmag', weight: 4 },
    { weapon: 'trench', weight: 4 },
    { weapon: 'ak74', weight: 4 },
    { weapon: 'skorpion', weight: 3 },
    { weapon: 'xenoray', weight: 2 }
]

// ---------------------------------------------------------------------------
// Enemy roster
// ---------------------------------------------------------------------------

export type CallOfXenoEnemyId = 'shambler' | 'husk' | 'drone' | 'brute'

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
        minRound: 1,
        weight: 10
    },
    husk: {
        id: 'husk',
        name: 'Husk',
        healthMultiplier: 0.7,
        speedMultiplier: 1.45,
        damageMultiplier: 0.9,
        scale: 0.98,
        color: 0x2e2622,
        minRound: 4,
        weight: 6
    },
    drone: {
        id: 'drone',
        name: 'Xeno Drone',
        healthMultiplier: 0.55,
        speedMultiplier: 0.85,
        damageMultiplier: 1,
        scale: 0.85,
        color: 0x4f7d8c,
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

const SPECIAL_CYCLE: CallOfXenoEnemyId[] = ['husk', 'drone', 'brute']

export function specialRoundEnemy(round: number): CallOfXenoEnemyId {
    const index = Math.floor(Math.floor(round) / 5) - 1
    return SPECIAL_CYCLE[Math.min(index, SPECIAL_CYCLE.length - 1)] ?? 'husk'
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

/**
 * Whether the grid is actually delivering: the switch has been thrown and
 * the round is not blacking it out.
 *
 * The machines gate on this, not on the switch alone. Blackout used to be
 * wired to the lighting and nothing else, so through the whole round the
 * perk machines and the Pack-a-Punch stood dark and still sold — the one
 * round that is supposed to take them away left them working.
 */
export function callOfXenoPowerLive(powered: boolean, modifier: CallOfXenoModifier): boolean {
    return powered && modifier !== 'blackout'
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

/** Bonus points for dropping several enemies with a single shot. */
export function multiKillBonus(count: number): number {
    if (count < 3) return 0
    return 50 * (count - 2)
}

// ---------------------------------------------------------------------------
// Workbench equipment
// ---------------------------------------------------------------------------

export type CallOfXenoEquipmentId = 'sentry' | 'drone' | 'blackhole'

export interface CallOfXenoEquipment {
    id: CallOfXenoEquipmentId
    name: string
    cost: number
    /** Seconds a deployment lasts before the unit packs itself away. */
    duration: number
    /**
     * Fraction of an enemy's max health dealt per shot — per second for the
     * black hole, which ticks continuously. Percentage damage is what keeps
     * the equipment honest on every round and every difficulty.
     */
    damagePct: number
    /** Seconds between shots. Zero for the black hole (it ticks instead). */
    fireDelay: number
    /** Furthest away it will engage, in world units. */
    range: number
    /** Per-enemy-type damage multiplier — beefier types shrug more of it off. */
    resistance: Partial<Record<CallOfXenoEnemyId, number>>
    color: number
    description: string
}

/** How far the singularity reaches out to grab enemies. */
export const CALL_OF_XENO_BLACKHOLE_RADIUS = 13
/** Seconds between the singularity's damage ticks. */
export const CALL_OF_XENO_BLACKHOLE_TICK = 0.25
/** Chance a kill leaves a random workbench unit on the floor. */
export const CALL_OF_XENO_EQUIPMENT_DROP_CHANCE = 0.005
/** Seconds a dropped unit waits on the floor before it fades. */
export const CALL_OF_XENO_EQUIPMENT_DROP_LIFETIME = 30

export const CALL_OF_XENO_EQUIPMENT: Record<CallOfXenoEquipmentId, CallOfXenoEquipment> = {
    sentry: {
        id: 'sentry',
        name: 'Sentry Gun',
        cost: 10000,
        duration: 60,
        damagePct: 0.2,
        fireDelay: 0.16,
        range: 26,
        resistance: { brute: 0.45, drone: 0.9 },
        color: 0xf59e0b,
        description: 'Auto-turret. Holds the ground it is dropped on for 60 seconds.'
    },
    drone: {
        id: 'drone',
        name: 'Escort Drone',
        cost: 12500,
        duration: 90,
        damagePct: 0.25,
        fireDelay: 0.3,
        range: 20,
        resistance: { brute: 0.45, drone: 0.9 },
        color: 0x38bdf8,
        description: 'Follows you and fires on the horde. Slower cadence than the sentry.'
    },
    blackhole: {
        id: 'blackhole',
        name: 'Singularity',
        cost: 15000,
        duration: 8,
        damagePct: 0.6,
        fireDelay: 0,
        range: CALL_OF_XENO_BLACKHOLE_RADIUS,
        resistance: { brute: 0.12, drone: 0.8 },
        color: 0xa855f7,
        description: 'Drags everything nearby into one spot and grinds it down. Giants barely bleed but still get pulled.'
    }
}

/**
 * Fraction of an enemy's max health one equipment hit (or tick) deals, after
 * the type's resistance. Giants are giants: less damage, same pull.
 */
export function equipmentDamage(equipment: CallOfXenoEquipment, enemyId: CallOfXenoEnemyId): number {
    return equipment.damagePct * (equipment.resistance[enemyId] ?? 1)
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
