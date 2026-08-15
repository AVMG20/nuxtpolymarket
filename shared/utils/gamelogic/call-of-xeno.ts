// Call of Xeno — pure game rules.
//
// Everything here is deterministic data and math: weapon stats, perk effects,
// round scaling and the point economy. The three.js scene, input handling and
// rendering live in the client component; keeping the rules in `shared` means
// they can be unit tested without a DOM or a WebGL context.

export type CallOfXenoWeaponId
    = | 'm1911'
      | 'trench'
      | 'mp40'
      | 'ak74'
      | 'rpk'
      | 'xenoray'

export type CallOfXenoPerkId = 'juggernog' | 'speedcola' | 'doubletap' | 'quickrevive'

export interface CallOfXenoWeapon {
    id: CallOfXenoWeaponId
    name: string
    /** Damage applied to a single zombie per pellet/beam hit. */
    damage: number
    /** Pellets fired per trigger pull. Only the shotgun fires more than one. */
    pellets: number
    /** Seconds between shots. */
    fireDelay: number
    /** Rounds in a full magazine. */
    magSize: number
    /** Rounds held in reserve when the weapon is bought fresh. */
    reserveAmmo: number
    /** Seconds a full reload takes. */
    reloadTime: number
    /** Cone half-angle in radians applied to every pellet. */
    spread: number
    /** Maximum hitscan range in world units. */
    range: number
    /** How many zombies a single shot can pass through (1 = no penetration). */
    penetration: number
    /** Automatic weapons keep firing while the trigger is held. */
    automatic: boolean
    /** Wall-buy price. The ammo-only refill costs half of this, rounded down. */
    cost: number
    /** Name the weapon takes once it has been through the Pack-a-Punch. */
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
        cost: 1000,
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
        cost: 1200,
        upgradedName: 'AK-74fu2'
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
        cost: 3000,
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
        cost: 4500,
        upgradedName: 'Porter\'s X2 Xeno Ray'
    }
}

export interface CallOfXenoPerk {
    id: CallOfXenoPerkId
    name: string
    cost: number
    description: string
    /** Colour of the machine in the scene, as a hex literal for three.js. */
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

/** Health the player has with, and without, Juggernog. */
export const CALL_OF_XENO_BASE_HEALTH = 100
export const CALL_OF_XENO_JUGGERNOG_HEALTH = 250

/** Seconds without taking damage before health starts coming back. */
export const CALL_OF_XENO_REGEN_DELAY = 3.5
/** Health per second once regeneration kicks in. */
export const CALL_OF_XENO_REGEN_RATE = 20

/** Points awarded for landing a hit and for finishing a zombie off. */
export const CALL_OF_XENO_HIT_POINTS = 10
export const CALL_OF_XENO_KILL_POINTS = 60

/** Points the player starts a run with. */
export const CALL_OF_XENO_STARTING_POINTS = 500

export const CALL_OF_XENO_PACK_A_PUNCH_COST = 5000
export const CALL_OF_XENO_POWER_COST = 0

/** Damage multiplier a weapon gains from the Pack-a-Punch. */
export const CALL_OF_XENO_PAP_DAMAGE_MULTIPLIER = 2.5
/** Reserve ammo multiplier a weapon gains from the Pack-a-Punch. */
export const CALL_OF_XENO_PAP_AMMO_MULTIPLIER = 2

/**
 * A weapon as it exists in the player's hands: the base stats plus whatever
 * the Pack-a-Punch did to them.
 */
export function packAPunch(weapon: CallOfXenoWeapon): CallOfXenoWeapon {
    return {
        ...weapon,
        name: weapon.upgradedName,
        damage: Math.round(weapon.damage * CALL_OF_XENO_PAP_DAMAGE_MULTIPLIER),
        magSize: Math.round(weapon.magSize * 1.5),
        reserveAmmo: weapon.reserveAmmo * CALL_OF_XENO_PAP_AMMO_MULTIPLIER,
        penetration: weapon.penetration + 1
    }
}

/**
 * Zombie health per round. Flat +100 a round through round 9, then compounding
 * 10% a round after that — the classic curve, which keeps early rounds a two
 * shot affair and makes Pack-a-Punch mandatory past round 20.
 */
export function zombieHealth(round: number): number {
    const r = Math.max(1, Math.floor(round))
    if (r <= 9) return 50 + r * 100
    let health = 950
    for (let i = 10; i <= r; i++) health *= 1.1
    return Math.round(health)
}

/** How many zombies the round spawns in total. */
export function zombieCount(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.min(48, 6 + Math.floor(r * 2.5))
}

/** Zombie movement speed in world units per second. */
export function zombieSpeed(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.min(5.2, 1.6 + r * 0.14)
}

/** Seconds between spawns during a round. */
export function zombieSpawnInterval(round: number): number {
    const r = Math.max(1, Math.floor(round))
    return Math.max(0.45, 2.4 - r * 0.09)
}

/** Damage a zombie deals per swipe. */
export function zombieDamage(round: number): number {
    return Math.max(1, Math.floor(round)) <= 9 ? 25 : 45
}

/** Ammo-refill price at a wall buy — half the weapon's purchase price. */
export function ammoCost(weapon: CallOfXenoWeapon): number {
    return Math.floor(weapon.cost / 2)
}
