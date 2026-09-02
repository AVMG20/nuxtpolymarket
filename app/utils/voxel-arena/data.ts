// Voxel Arena — weapon and enemy definitions plus the wave planner.
// Pure data: no three.js, so it is unit-testable in node.

import type { EliteAffix, EnemyDef, EnemyId, WavePlan, WaveSpawn, WeaponDef, WeaponId, PlayerStats } from './types'

export const WEAPONS: Record<WeaponId, WeaponDef> = {
    pulse: {
        id: 'pulse',
        name: 'Pulse Rifle',
        tagline: 'Reliable automatic cyan bolts. Never lets you down.',
        damage: 13,
        fireRate: 9,
        magazine: 30,
        reloadTime: 1.4,
        spread: 0.025,
        pellets: 1,
        projectileSpeed: 70,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 1.5,
        color: 0x4df2ff,
        tracerLength: 1.6,
        recoil: 0.35,
        rarity: 'common',
        gravity: 0,
        homing: 0,
        adsFov: 56, adsSpread: 0.25, bloom: 0.012,
        burn: 0
    },
    scatter: {
        id: 'scatter',
        name: 'Scatter Cannon',
        tagline: 'Eight molten pellets. Turns crowds into confetti.',
        damage: 11,
        fireRate: 1.7,
        magazine: 6,
        reloadTime: 1.9,
        spread: 0.14,
        pellets: 8,
        projectileSpeed: 60,
        kind: 'bullet',
        auto: false,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 6,
        color: 0xffa23a,
        tracerLength: 1.1,
        recoil: 1.4,
        rarity: 'common',
        gravity: 0,
        homing: 0,
        adsFov: 60, adsSpread: 0.65, bloom: 0.02,
        burn: 0
    },
    needler: {
        id: 'needler',
        name: 'Needler',
        tagline: 'Hyper-fast magenta needles that curve toward prey.',
        damage: 6,
        fireRate: 19,
        magazine: 48,
        reloadTime: 1.2,
        spread: 0.06,
        pellets: 1,
        projectileSpeed: 55,
        kind: 'bullet',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 0.6,
        color: 0xff4dd8,
        tracerLength: 1.2,
        recoil: 0.18,
        rarity: 'rare',
        gravity: 0,
        homing: 2.5,
        adsFov: 56, adsSpread: 0.35, bloom: 0.006,
        burn: 0
    },
    rail: {
        id: 'rail',
        name: 'Voltrail',
        tagline: 'A white-hot lance that pierces everything in a line.',
        damage: 95,
        fireRate: 1.2,
        magazine: 4,
        reloadTime: 2.0,
        spread: 0,
        pellets: 1,
        projectileSpeed: 0,
        kind: 'rail',
        auto: false,
        explosionRadius: 0,
        pierce: 8,
        chain: 0,
        ricochet: 0,
        knockback: 9,
        color: 0xd8f4ff,
        tracerLength: 0,
        recoil: 2.2,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        adsFov: 34, adsSpread: 0, bloom: 0,
        burn: 0
    },
    plasma: {
        id: 'plasma',
        name: 'Plasma Mortar',
        tagline: 'Lobs green suns. Everything near the crater ceases to exist.',
        damage: 60,
        fireRate: 1.5,
        magazine: 5,
        reloadTime: 2.2,
        spread: 0.01,
        pellets: 1,
        projectileSpeed: 32,
        kind: 'plasma',
        auto: false,
        explosionRadius: 4,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 8,
        color: 0x7dff5a,
        tracerLength: 0,
        recoil: 1.6,
        rarity: 'epic',
        gravity: 14,
        homing: 0,
        adsFov: 58, adsSpread: 0.5, bloom: 0,
        burn: 0
    },
    arc: {
        id: 'arc',
        name: 'Arc Caster',
        tagline: 'Violet lightning that jumps between up to four enemies.',
        damage: 22,
        fireRate: 4.5,
        magazine: 22,
        reloadTime: 1.6,
        spread: 0,
        pellets: 1,
        projectileSpeed: 0,
        kind: 'arc',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 3,
        ricochet: 0,
        knockback: 2,
        color: 0xb56bff,
        tracerLength: 0,
        recoil: 0.5,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        adsFov: 54, adsSpread: 0, bloom: 0,
        burn: 0
    },
    ember: {
        id: 'ember',
        name: 'Ember Thrower',
        tagline: 'A cone of voxel fire. Everything it touches keeps burning.',
        damage: 4,
        fireRate: 16,
        magazine: 90,
        reloadTime: 2.1,
        spread: 0.2,
        pellets: 1,
        projectileSpeed: 0,
        kind: 'flame',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 0,
        knockback: 0.4,
        color: 0xff7a2a,
        tracerLength: 0,
        recoil: 0.1,
        rarity: 'rare',
        gravity: 0,
        homing: 0,
        adsFov: 62,
        adsSpread: 0.8,
        bloom: 0,
        burn: 3
    },
    shredder: {
        id: 'shredder',
        name: 'Shredder',
        tagline: 'Spinning saw discs that ricochet from skull to skull.',
        damage: 38,
        fireRate: 3.2,
        magazine: 8,
        reloadTime: 1.7,
        spread: 0.02,
        pellets: 1,
        projectileSpeed: 42,
        kind: 'disc',
        auto: true,
        explosionRadius: 0,
        pierce: 0,
        chain: 0,
        ricochet: 3,
        knockback: 3,
        color: 0xffe14d,
        tracerLength: 0,
        recoil: 0.8,
        rarity: 'epic',
        gravity: 0,
        homing: 0,
        adsFov: 54, adsSpread: 0.3, bloom: 0.01,
        burn: 0
    }
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]

/** Weapons the player can pick from before deploying. */
export const STARTER_WEAPONS: WeaponId[] = ['pulse', 'scatter', 'needler']

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

export const MELEE = {
    slamDamage: 90,
    slamRadius: 4.5,
    damage: 48,
    range: 3.4,
    arc: Math.PI * 0.7,
    comboWindow: 0.9,
    swingTime: 0.22,
    lunge: 9,
    finisherMult: 2.4,
    knockback: 7
}

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

export function waveEnemyCount(wave: number): number {
    return Math.round(10 + wave * 4 + Math.pow(wave, 1.4))
}

export function waveHpMult(wave: number): number {
    const w = wave - 1
    return 1 + 0.15 * w + 0.012 * w * w
}

export function waveDamageMult(wave: number): number {
    return 1 + 0.08 * (wave - 1)
}

export function eliteChance(wave: number): number {
    if (wave < 6) return 0
    return Math.min(0.38, 0.06 + 0.025 * (wave - 5))
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
        // from wave 15 the titans come in pairs
        if (wave >= 15) spawns.splice(Math.floor(spawns.length * 0.6), 0, { enemy: 'titan', affix: null })
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
        turretCost: TURRET.cost
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
    return Math.min(0.5, 0.075 * luck)
}
