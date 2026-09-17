// Voxel Arena — weapon and enemy definitions plus the wave planner.
// Pure data: no three.js, so it is unit-testable in node.

import type { AbilityDef, AbilityId, EliteAffix, EnemyDef, EnemyId, MeleeDef, MeleeId, Rarity, WavePlan, WaveSpawn, WeaponDef, WeaponId, PlayerStats } from './types'

export const WEAPONS: Record<WeaponId, WeaponDef> = {
    pistol: {
        id: 'pistol',
        name: 'M9 Sidearm',
        tagline: 'Semi-automatic pistol. Snappy, accurate, always there.',
        damage: 22,
        fireRate: 5,
        magazine: 8,
        reloadTime: 1.2,
        spread: 0.018,
        pellets: 1,
        projectileSpeed: 150,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 1.5,
        color: 0xffd9a0,
        tracerLength: 2.2,
        recoil: 0.5,
        rarity: 'common',
        gravity: 0,
        homing: 0,
        sight: 'iron',
        adsFov: 60,
        adsSpread: 0.3,
        bloom: 0.012,
        burn: 0,
        reserve: 120,
        price: 80,
        burst: 1,
        burstGap: 0
    },
    magnum: {
        id: 'magnum',
        name: '.44 Magnum',
        tagline: 'Six rounds of hand cannon. One clean headshot ends most arguments.',
        damage: 72,
        fireRate: 2.2,
        magazine: 6,
        reloadTime: 1.9,
        spread: 0.012,
        pellets: 1,
        projectileSpeed: 160,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 5,
        color: 0xffe0b0,
        tracerLength: 2.6,
        recoil: 1.9,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        sight: 'iron',
        adsFov: 56,
        adsSpread: 0.25,
        bloom: 0.02,
        burn: 0,
        reserve: 48,
        price: 170,
        burst: 1,
        burstGap: 0
    },
    smg: {
        id: 'smg',
        name: 'Vector SMG',
        tagline: 'Absurd fire rate, controllable kick. Chews through packs up close.',
        damage: 12,
        fireRate: 15,
        magazine: 32,
        reloadTime: 1.4,
        spread: 0.05,
        pellets: 1,
        projectileSpeed: 130,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 0.8,
        color: 0xffe6a8,
        tracerLength: 1.8,
        recoil: 0.3,
        rarity: 'common',
        gravity: 0,
        homing: 0,
        sight: 'reddot',
        adsFov: 58,
        adsSpread: 0.3,
        bloom: 0.007,
        burn: 0,
        reserve: 320,
        price: 120,
        burst: 1,
        burstGap: 0
    },
    rifle: {
        id: 'rifle',
        name: 'AK-74 Rifle',
        tagline: 'Full-auto assault rifle. Hits hard, kicks harder.',
        damage: 30,
        fireRate: 10,
        magazine: 30,
        reloadTime: 1.7,
        spread: 0.022,
        pellets: 1,
        projectileSpeed: 170,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 2,
        color: 0xffd08a,
        tracerLength: 2.4,
        recoil: 0.55,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        sight: 'reddot',
        adsFov: 54,
        adsSpread: 0.22,
        bloom: 0.009,
        burn: 0,
        reserve: 210,
        price: 220,
        burst: 1,
        burstGap: 0
    },
    dmr: {
        id: 'dmr',
        name: 'Marksman Rifle',
        tagline: 'Semi-automatic and surgical. Two body shots or one to the head.',
        damage: 56,
        fireRate: 3.5,
        magazine: 15,
        reloadTime: 1.9,
        spread: 0.008,
        pellets: 1,
        projectileSpeed: 170,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 1,
        chain: 0,
        ricochet: 0,
        knockback: 3,
        color: 0xfff0c8,
        tracerLength: 3,
        recoil: 1.1,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        sight: 'holo',
        adsFov: 44,
        adsSpread: 0.2,
        bloom: 0.014,
        burn: 0,
        reserve: 90,
        price: 260,
        burst: 1,
        burstGap: 0
    },
    shotgun: {
        id: 'shotgun',
        name: 'Pump Shotgun',
        tagline: 'Nine pellets of buckshot that punch through the first body. Reduces whatever is in front of you to blocks.',
        damage: 16,
        fireRate: 1.9,
        magazine: 8,
        reloadTime: 2.0,
        spread: 0.085,
        pellets: 9,
        projectileSpeed: 135,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 1,
        chain: 0,
        ricochet: 0,
        knockback: 7,
        color: 0xffb060,
        tracerLength: 1.6,
        recoil: 1.7,
        rarity: 'common',
        gravity: 0,
        homing: 0,
        sight: 'iron',
        adsFov: 62,
        adsSpread: 0.65,
        bloom: 0.02,
        burn: 0,
        reserve: 56,
        price: 130,
        burst: 1,
        burstGap: 0
    },
    lmg: {
        id: 'lmg',
        name: 'HK21 LMG',
        tagline: 'One hundred rounds of sustained fire. Reloads like a sofa.',
        damage: 30,
        fireRate: 8,
        magazine: 100,
        reloadTime: 3.8,
        spread: 0.04,
        pellets: 1,
        projectileSpeed: 150,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 2,
        color: 0xffc880,
        tracerLength: 2.6,
        recoil: 0.7,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        sight: 'holo',
        adsFov: 56,
        adsSpread: 0.3,
        bloom: 0.008,
        burn: 0,
        reserve: 300,
        price: 480,
        burst: 1,
        burstGap: 0
    },
    saw: {
        id: 'saw',
        name: 'RPK LMG',
        tagline: 'Lighter machine gun with a faster cyclic rate and a 75-round drum.',
        damage: 19,
        fireRate: 12.5,
        magazine: 75,
        reloadTime: 3.1,
        spread: 0.05,
        pellets: 1,
        projectileSpeed: 140,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 1.2,
        color: 0xffd090,
        tracerLength: 2.2,
        recoil: 0.5,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        sight: 'reddot',
        adsFov: 58,
        adsSpread: 0.3,
        bloom: 0.008,
        burn: 0,
        reserve: 300,
        price: 420,
        burst: 1,
        burstGap: 0
    },
    sniper: {
        id: 'sniper',
        name: 'Bolt Sniper',
        tagline: 'Bolt-action. Punches through a whole line of enemies.',
        damage: 165,
        fireRate: 1,
        magazine: 5,
        reloadTime: 2.7,
        spread: 0,
        pellets: 1,
        projectileSpeed: 0,
        kind: 'rail',
        auto: false,
        explosionRadius: 0,
        pierce: 6,
        chain: 0,
        ricochet: 0,
        knockback: 10,
        color: 0xf0f6ff,
        tracerLength: 0,
        recoil: 2.5,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        sight: 'scope',
        adsFov: 24,
        adsSpread: 0,
        bloom: 0,
        burn: 0,
        reserve: 30,
        price: 400,
        burst: 1,
        burstGap: 0
    },
    burst: {
        id: 'burst',
        name: 'Burst Carbine',
        tagline: 'Three-round bursts, laser accurate. Tap the trigger, drop the target.',
        damage: 34,
        fireRate: 16,
        magazine: 27,
        reloadTime: 1.6,
        spread: 0.014,
        pellets: 1,
        projectileSpeed: 170,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 1.6,
        color: 0xa8e6ff,
        tracerLength: 2.3,
        recoil: 0.5,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        sight: 'holo',
        adsFov: 52,
        adsSpread: 0.2,
        bloom: 0.006,
        burn: 0,
        reserve: 180,
        price: 240,
        burst: 3,
        burstGap: 0.22
    },
    flamer: {
        id: 'flamer',
        name: 'Flamethrower',
        tagline: 'A cone of fire that passes through the pack and keeps burning after you let go.',
        damage: 6,
        fireRate: 14,
        magazine: 80,
        reloadTime: 2.6,
        spread: 0.06,
        pellets: 1,
        projectileSpeed: 26,
        kind: 'flame',
        auto: true,
        explosionRadius: 0,
        pierce: 3,
        chain: 0,
        ricochet: 0,
        knockback: 0.3,
        color: 0xff7a2a,
        tracerLength: 0,
        recoil: 0.15,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        sight: 'ring',
        adsFov: 66,
        adsSpread: 0.8,
        bloom: 0,
        burn: 3,
        reserve: 400,
        price: 380,
        burst: 1,
        burstGap: 0
    },
    launcher: {
        id: 'launcher',
        name: 'Grenade Launcher',
        tagline: 'Lobs grenades that turn a crowd into a crater. Mind the arc.',
        damage: 130,
        fireRate: 1.2,
        magazine: 6,
        reloadTime: 2.8,
        spread: 0.01,
        pellets: 1,
        projectileSpeed: 38,
        kind: 'plasma',
        auto: false,
        explosionRadius: 4.2,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 8,
        color: 0xd9a63c,
        tracerLength: 0,
        recoil: 1.6,
        rarity: 'epic',
        gravity: 18,
        homing: 0,
        sight: 'iron',
        adsFov: 58,
        adsSpread: 0.4,
        bloom: 0,
        burn: 0,
        reserve: 24,
        price: 380,
        burst: 1,
        burstGap: 0
    },
    raygun: {
        id: 'raygun',
        name: 'Ray Cannon',
        tagline: 'The wonder weapon. Green energy bolts that splash on impact.',
        damage: 95,
        fireRate: 2.6,
        magazine: 20,
        reloadTime: 2.4,
        spread: 0.01,
        pellets: 1,
        projectileSpeed: 65,
        kind: 'plasma',
        auto: false,
        explosionRadius: 3.5,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 7,
        color: 0x7dff5a,
        tracerLength: 0,
        recoil: 0.9,
        rarity: 'legendary',
        gravity: 0,
        homing: 0,
        sight: 'ring',
        adsFov: 58,
        adsSpread: 0.4,
        bloom: 0,
        burn: 0,
        reserve: 60,
        price: 650,
        burst: 1,
        burstGap: 0
    },
    arc: {
        id: 'arc',
        name: 'Wunder Arc',
        tagline: 'Tesla chamber that chains lightning through up to six enemies.',
        damage: 48,
        fireRate: 2.4,
        magazine: 6,
        reloadTime: 2.5,
        spread: 0,
        pellets: 1,
        projectileSpeed: 0,
        kind: 'arc',
        auto: false,
        explosionRadius: 0,
        pierce: 0,
        chain: 5,
        ricochet: 0,
        knockback: 3,
        color: 0xb56bff,
        tracerLength: 0,
        recoil: 1.2,
        rarity: 'legendary',
        gravity: 0,
        homing: 0,
        sight: 'holo',
        adsFov: 52,
        adsSpread: 0,
        bloom: 0,
        burn: 0,
        reserve: 60,
        price: 650,
        burst: 1,
        burstGap: 0
    }
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]

/** Every run starts with the sidearm; everything else is bought in the arsenal. */
export const STARTER_WEAPON: WeaponId = 'pistol'

export const ABILITIES: Record<AbilityId, AbilityDef> = {
    nova: { id: 'nova', name: 'Nova Burst', description: 'Detonate a shockwave that damages, stuns and hurls back everything around you.', energy: 50, icon: 'i-lucide-sun', color: '#3ff0ff' },
    sentry: { id: 'sentry', name: 'Sentry Turret', description: 'Drop an automated turret that shoots the nearest enemy for 14 seconds. Two can stand at once.', energy: 60, icon: 'i-lucide-radar', color: '#d9a63c' },
    blink: { id: 'blink', name: 'Void Blink', description: 'Teleport 9 metres forward, slicing everything you pass through. Invulnerable during the jump.', energy: 35, icon: 'i-lucide-zap', color: '#b56bff' },
    chrono: { id: 'chrono', name: 'Chrono Field', description: 'Freeze time for every enemy for 3 seconds. You keep moving at full speed.', energy: 70, icon: 'i-lucide-hourglass', color: '#7dd3fc' }
}

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[]
export const ABILITY_SLOTS = 2

/**
 * Credit economy: a fixed payout per cleared wave, spent in the arsenal between
 * waves. Income covers one to three boons a wave; guns carry their own price
 * (see WEAPONS[id].price) so the strong ones take a few waves of saving.
 * Power only comes from boons — guns are never upgraded directly.
 */
export const ECONOMY = {
    boonPrice: { common: 60, rare: 90, epic: 140, legendary: 200 } as Record<Rarity, number>,
    rerollPrice: 30,
    meleePrice: { common: 80, rare: 150, epic: 260, legendary: 420 } as Record<Rarity, number>,
    abilityPrice: 160,
    /** Price of a full reserve refill; partial refills cost proportionally less. */
    refillPrice: { common: 10, rare: 15, epic: 20, legendary: 30 } as Record<Rarity, number>
}

/** Credits paid out for clearing a wave. Boss waves pay a bonus. */
export function waveIncome(wave: number): number {
    return Math.round((120 + wave * 22 + (isBossWave(wave) ? 120 : 0)) / 5) * 5
}

/** Boons creep up in price so late income buys about the same number of picks. */
function priceRamp(wave: number): number {
    return 1 + Math.max(0, wave - 1) * 0.05
}

export function boonPrice(rarity: Rarity, wave: number): number {
    return Math.round(ECONOMY.boonPrice[rarity] * priceRamp(wave) / 5) * 5
}

export function rerollPrice(wave: number): number {
    return Math.round(ECONOMY.rerollPrice * priceRamp(wave) / 5) * 5
}

/** Rounds a gun can carry outside the magazine with the player's reserve boons applied. */
export function reserveMax(def: WeaponDef, stats: PlayerStats): number {
    return Math.round(def.reserve * stats.reserveMult)
}

/** Price to top a reserve up to full, at least 5 credits, 0 when already full. */
export function refillPrice(def: WeaponDef, reserve: number, max: number): number {
    if (reserve >= max) return 0
    const missing = 1 - reserve / Math.max(1, max)
    return Math.max(5, Math.round(ECONOMY.refillPrice[def.rarity] * missing / 5) * 5)
}

export const TURRET = {
    cost: 60,
    duration: 14,
    fireRate: 6,
    damage: 11,
    range: 22,
    maxActive: 2
}

export const BURN = {
    dps: 9,
    tick: 0.5
}

/** Shared melee rules; the blade itself comes from MELEE_WEAPONS. */
export const MELEE = {
    slamDamage: 90,
    slamRadius: 4.5,
    comboWindow: 0.9,
    comboLength: 3
}

export const MELEE_WEAPONS: Record<MeleeId, MeleeDef> = {
    sword: { id: 'sword', name: 'Iron Sword', tagline: 'Dependable steel. Left, right, then a heavy cleave.', damage: 40, range: 3.2, arc: Math.PI * 0.7, swingTime: 0.24, rate: 2.8, finisherMult: 2.2, finisher: 'slash', knockback: 6, lunge: 8, rarity: 'common', color: 0xd8dde6 },
    dagger: { id: 'dagger', name: 'Twin Daggers', tagline: 'Blindingly fast cuts and a lunging double stab to finish.', damage: 22, range: 2.4, arc: Math.PI * 0.5, swingTime: 0.12, rate: 5, finisherMult: 2.6, finisher: 'thrust', knockback: 2, lunge: 14, rarity: 'common', color: 0xb8c4d6 },
    spear: { id: 'spear', name: 'Voxel Pike', tagline: 'Long reach. Sweeps the line, then a piercing thrust through everything ahead.', damage: 52, range: 5.6, arc: Math.PI * 0.45, swingTime: 0.3, rate: 2, finisherMult: 2.0, finisher: 'thrust', knockback: 8, lunge: 6, rarity: 'rare', color: 0xc9a86a },
    katana: { id: 'katana', name: 'Storm Katana', tagline: 'Quick, wide draws. The third cut is a full spin that hits everything around you.', damage: 46, range: 3.6, arc: Math.PI * 0.8, swingTime: 0.17, rate: 3.5, finisherMult: 2.2, finisher: 'spin', knockback: 7, lunge: 11, rarity: 'rare', color: 0x3ff0ff },
    axe: { id: 'axe', name: 'Great Axe', tagline: 'Slow, brutal arcs. The overhead slam craters the floor.', damage: 95, range: 3.6, arc: Math.PI * 0.85, swingTime: 0.42, rate: 1.4, finisherMult: 2.6, finisher: 'slam', knockback: 12, lunge: 5, rarity: 'epic', color: 0xff8a3a },
    scythe: { id: 'scythe', name: 'Void Scythe', tagline: 'Huge reaping sweeps that heal you, ending in a spin that clears the room.', damage: 70, range: 4.6, arc: Math.PI * 0.95, swingTime: 0.32, rate: 1.8, finisherMult: 2.4, finisher: 'spin', knockback: 9, lunge: 7, rarity: 'legendary', color: 0xb56bff }
}

export const MELEE_IDS = Object.keys(MELEE_WEAPONS) as MeleeId[]
export const STARTER_MELEE: MeleeId = 'sword'

export const ENEMIES: Record<EnemyId, EnemyDef> = {
    grunt: {
        id: 'grunt',
        name: 'Grunt',
        hp: 42,
        speed: 5.6,
        damage: 8,
        attackRange: 1.9,
        attackCooldown: 1.1,
        scale: 1,
        radius: 0.6,
        height: 1.9,
        score: 10,
        behavior: 'melee',
        minWave: 1,
        weight: wave => Math.max(2, 10 - wave * 0.4),
        energy: 6,
        headY: 1.7, headRadius: 0.3
    },
    runner: {
        id: 'runner',
        name: 'Runner',
        hp: 24,
        speed: 9.8,
        damage: 6,
        attackRange: 1.6,
        attackCooldown: 0.8,
        scale: 0.8,
        radius: 0.5,
        height: 1.6,
        score: 12,
        behavior: 'melee',
        minWave: 2,
        weight: wave => 4 + wave * 0.6,
        energy: 5,
        headY: 1.42, headRadius: 0.26
    },
    spitter: {
        id: 'spitter',
        name: 'Spitter',
        hp: 55,
        speed: 4.6,
        damage: 9,
        attackRange: 16,
        attackCooldown: 1.7,
        scale: 1,
        radius: 0.6,
        height: 2,
        score: 18,
        behavior: 'ranged',
        minWave: 3,
        weight: wave => 3 + wave * 0.35,
        projectileSpeed: 16,
        energy: 8,
        headY: 1.7, headRadius: 0.32
    },
    brute: {
        id: 'brute',
        name: 'Brute',
        hp: 240,
        speed: 3.7,
        damage: 28,
        attackRange: 2.8,
        attackCooldown: 1.6,
        scale: 1.8,
        radius: 0.75,
        height: 2.2,
        score: 40,
        behavior: 'melee',
        minWave: 4,
        weight: wave => 1.5 + wave * 0.3,
        energy: 14,
        headY: 1.9, headRadius: 0.3
    },
    drone: {
        id: 'drone',
        name: 'Drone',
        hp: 32,
        speed: 7.5,
        damage: 8,
        attackRange: 1.4,
        attackCooldown: 2.4,
        scale: 0.9,
        radius: 0.55,
        height: 1,
        score: 15,
        behavior: 'flyer',
        minWave: 5,
        weight: wave => 2 + wave * 0.4,
        energy: 6,
        headY: 0, headRadius: 0
    },
    charger: {
        id: 'charger',
        name: 'Charger',
        hp: 130,
        speed: 4.2,
        damage: 22,
        attackRange: 2.2,
        attackCooldown: 3.2,
        scale: 1.3,
        radius: 0.7,
        height: 1.8,
        score: 30,
        behavior: 'charger',
        minWave: 7,
        weight: wave => 1 + wave * 0.3,
        energy: 12,
        headY: 1.1, headRadius: 0.4
    },
    warden: {
        id: 'warden',
        name: 'Warden',
        hp: 170,
        speed: 4.3,
        damage: 16,
        attackRange: 2.2,
        attackCooldown: 1.4,
        scale: 1.25,
        radius: 0.7,
        height: 2,
        score: 35,
        behavior: 'melee',
        minWave: 6,
        weight: wave => 1 + wave * 0.25,
        energy: 12,
        shieldArc: Math.PI * 0.36,
        headY: 1.7,
        headRadius: 0.3
    },
    bomber: {
        id: 'bomber',
        name: 'Bomber',
        hp: 30,
        speed: 7.4,
        damage: 30,
        attackRange: 2.4,
        attackCooldown: 1,
        scale: 0.9,
        radius: 0.55,
        height: 1.4,
        score: 20,
        behavior: 'bomber',
        minWave: 4,
        weight: wave => 2 + wave * 0.5,
        energy: 6,
        headY: 0,
        headRadius: 0
    },
    mender: {
        id: 'mender',
        name: 'Mender',
        hp: 70,
        speed: 4.4,
        damage: 6,
        attackRange: 9,
        attackCooldown: 2.6,
        scale: 1,
        radius: 0.6,
        height: 2,
        score: 40,
        behavior: 'mender',
        minWave: 6,
        weight: wave => 1 + wave * 0.2,
        energy: 14,
        headY: 1.72,
        headRadius: 0.3
    },
    titan: {
        id: 'titan',
        name: 'Titan',
        hp: 1900,
        speed: 3.4,
        damage: 42,
        attackRange: 4.5,
        attackCooldown: 3.4,
        scale: 3.2,
        radius: 0.8,
        height: 2.4,
        score: 500,
        behavior: 'boss',
        minWave: 5,
        weight: () => 0,
        energy: 100,
        headY: 1.95, headRadius: 0.32
    }
}

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[]

export const AFFIXES: Record<EliteAffix, { name: string, color: number }> = {
    swift: { name: 'Swift', color: 0xffe14d },
    armored: { name: 'Armored', color: 0x8fa3b8 },
    volatile: { name: 'Volatile', color: 0xff6a2a },
    gilded: { name: 'Gilded', color: 0xffd166 }
}

export function isBossWave(wave: number): boolean {
    return wave > 0 && wave % 5 === 0
}

export type WaveEvent = 'none' | 'meteors' | 'frenzy' | 'blackout' | 'bounty'

/** Arena events spice up non-boss waves from wave 3 on, cycling through the list. */
export function waveEvent(wave: number): WaveEvent {
    if (isBossWave(wave) || wave < 3) return 'none'
    const order: WaveEvent[] = ['none', 'meteors', 'bounty', 'frenzy', 'none', 'blackout']
    return order[(wave - 3) % order.length]!
}

/**
 * Difficulty curve. Waves 5-10 should push a decent build, 15-20 should need a
 * tuned one and 25-30 should be close to unwinnable, so a run stays short.
 */
export function waveEnemyCount(wave: number): number {
    return Math.round(10 + wave * 4 + Math.pow(wave, 1.35))
}

export function waveHpMult(wave: number): number {
    const w = wave - 1
    return 1 + 0.16 * w + 0.017 * w * w
}

export function waveDamageMult(wave: number): number {
    return 1 + 0.1 * (wave - 1)
}

export function eliteChance(wave: number): number {
    if (wave < 6) return 0
    return Math.min(0.5, 0.06 + 0.03 * (wave - 5))
}

/**
 * Builds the spawn list for a wave. `rng` must return a uniform [0, 1)
 * float — injected so tests can drive it deterministically.
 */
export function planWave(wave: number, rng: () => number): WavePlan {
    const boss = isBossWave(wave)
    const pool = ENEMY_IDS.map(id => ENEMIES[id]).filter(def => def.behavior !== 'boss' && def.minWave <= wave)
    const count = waveEnemyCount(wave) - (boss ? 6 : 0)
    const spawns: WaveSpawn[] = []
    const elite = eliteChance(wave)
    const affixes: EliteAffix[] = ['swift', 'armored', 'volatile']

    for (let i = 0; i < count; i++) {
        const total = pool.reduce((sum, def) => sum + def.weight(wave), 0)
        let roll = rng() * total
        let chosen = pool[pool.length - 1]!
        for (const def of pool) {
            roll -= def.weight(wave)
            if (roll < 0) {
                chosen = def
                break
            }
        }
        const affix = rng() < elite ? affixes[Math.floor(rng() * affixes.length)]! : null
        spawns.push({ enemy: chosen.id, affix })
    }

    if (boss) {
        // The titan arrives after a third of the wave so the arena is busy when it lands.
        const at = Math.floor(spawns.length / 3)
        spawns.splice(at, 0, { enemy: 'titan', affix: null })
        // from wave 15 the titans come in pairs, from 25 in threes
        if (wave >= 15) spawns.splice(Math.floor(spawns.length * 0.6), 0, { enemy: 'titan', affix: null })
        if (wave >= 25) spawns.splice(Math.floor(spawns.length * 0.8), 0, { enemy: 'titan', affix: 'armored' })
    }
    if (waveEvent(wave) === 'bounty') {
        // a gilded brute worth a haul of pickups
        spawns.splice(Math.floor(spawns.length / 2), 0, { enemy: 'brute', affix: 'gilded' })
    }

    return {
        wave,
        boss,
        event: waveEvent(wave),
        spawns,
        hpMult: waveHpMult(wave),
        damageMult: waveDamageMult(wave),
        maxAlive: Math.min(64, 16 + Math.round(wave * 2.4)),
        spawnInterval: Math.max(0.4, 1.1 - wave * 0.05),
        batchSize: Math.min(8, 3 + Math.floor(wave / 2))
    }
}

export function affixHpMult(affix: EliteAffix | null): number {
    if (affix === 'armored') return 2.2
    if (affix === 'gilded') return 3
    return affix ? 1.3 : 1
}

export function affixSpeedMult(affix: EliteAffix | null): number {
    return affix === 'swift' ? 1.55 : 1
}

export function defaultStats(): PlayerStats {
    return {
        maxHealth: 100,
        healthRegen: 0,
        moveSpeed: 9,
        damageMult: 1,
        fireRateMult: 1,
        reloadMult: 1,
        critChance: 0.05,
        critMult: 2,
        lifesteal: 0,
        meleeDamageMult: 1,
        meleeRangeMult: 1,
        dashCharges: 2,
        dashCooldown: 2.4,
        jumpCharges: 2,
        projectileSpeedMult: 1,
        magazineMult: 1,
        pickupRange: 2.2,
        energyMax: 100,
        energyPerKill: 8,
        abilityMult: 1,
        abilityCost: 50,
        armor: 0,
        luck: 1,
        scale: 1,
        ricochet: 0,
        pierce: 0,
        explosiveRounds: 0,
        chainLightning: 0,
        splitShot: 0,
        orbitBlades: 0,
        killBlast: 0,
        chronoKill: 0,
        fireTrail: 0,
        frenzy: 0,
        vampireAura: 0,
        homing: 0,
        bulletSize: 0,
        thorns: 0,
        secondWind: 0,
        incendiary: 0,
        shrapnel: 0,
        adrenaline: 0,
        bulwark: 0,
        sentry: 0,
        turretCost: TURRET.cost,
        rift: 0,
        storm: 0,
        lance: 0,
        frost: 0,
        execute: 0,
        bulletStorm: 0,
        thunderStep: 0,
        reloadBlast: 0,
        bloodlust: 0,
        headhunter: 0,
        reserveMult: 1,
        ammoLuck: 1,
        income: 0,
        meteorCall: 0
    }
}

/** Effective magazine size for a weapon with the player's stats applied. */
export function magazineSize(def: WeaponDef, stats: PlayerStats): number {
    return Math.max(1, Math.round(def.magazine * stats.magazineMult))
}

/** Score for a kill: base × wave, boosted by the current combo tier. */
export function killScore(def: EnemyDef, wave: number, combo: number, affix: EliteAffix | null): number {
    const tier = Math.floor(combo / 5)
    const mult = 1 + tier * 0.25
    const eliteBonus = affix ? 1.5 : 1
    return Math.round(def.score * wave * mult * eliteBonus)
}

/** Chance that a kill drops a pickup, scaled by luck. Boss kills always drop. */
export function dropChance(def: EnemyDef, luck: number): number {
    if (def.behavior === 'boss') return 1
    return Math.min(0.35, 0.05 * luck)
}

/** Small chance that a kill drops an ammo crate, scaled by the ammo luck stat. */
export function ammoDropChance(def: EnemyDef, ammoLuck: number): number {
    if (def.behavior === 'boss') return 1
    return Math.min(0.3, 0.06 * ammoLuck)
}
