// Voxel Arena — shared types for the pure data modules and the engine.

export type WeaponId = 'pulse' | 'scatter' | 'needler' | 'rail' | 'plasma' | 'arc' | 'shredder'

export type EnemyId = 'grunt' | 'runner' | 'brute' | 'spitter' | 'drone' | 'charger' | 'warden' | 'titan'

export type EnemyBehavior = 'melee' | 'ranged' | 'flyer' | 'charger' | 'boss'

export type EliteAffix = 'swift' | 'armored' | 'volatile'

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface WeaponDef {
    id: WeaponId
    name: string
    tagline: string
    /** Damage per projectile (before player multipliers). */
    damage: number
    /** Shots per second. */
    fireRate: number
    magazine: number
    reloadTime: number
    /** Cone half-angle in radians applied to every projectile. */
    spread: number
    pellets: number
    projectileSpeed: number
    /** How the projectile is simulated and drawn. */
    kind: 'bullet' | 'plasma' | 'rail' | 'arc' | 'disc'
    auto: boolean
    explosionRadius: number
    pierce: number
    chain: number
    ricochet: number
    knockback: number
    color: number
    tracerLength: number
    recoil: number
    rarity: Rarity
    /** Gravity applied to the projectile (plasma mortar lobs). */
    gravity: number
    homing: number
    /** Camera field of view while aiming (zoom). */
    adsFov: number
    /** Spread multiplier while aiming. */
    adsSpread: number
    /** Extra spread added per shot from the hip, decaying over time. */
    bloom: number
}


export interface EnemyDef {
    id: EnemyId
    name: string
    hp: number
    speed: number
    damage: number
    attackRange: number
    attackCooldown: number
    /** Visual and collision scale multiplier. */
    scale: number
    /** Collision sphere radius at scale 1. */
    radius: number
    /** Height of the model at scale 1 (feet to crown). */
    height: number
    score: number
    behavior: EnemyBehavior
    minWave: number
    /** Relative spawn weight for a given wave. */
    weight: (wave: number) => number
    projectileSpeed?: number
    energy: number
    /** Blocks bullets arriving from within this half-angle (radians) of its facing. */
    shieldArc?: number
    /** Height of the head hit-sphere centre at scale 1 (0 = no headshots). */
    headY: number
    headRadius: number
}

export interface WaveSpawn {
    enemy: EnemyId
    affix: EliteAffix | null
}

export interface WavePlan {
    wave: number
    boss: boolean
    event: 'none' | 'meteors' | 'frenzy' | 'blackout'
    spawns: WaveSpawn[]
    hpMult: number
    damageMult: number
    /** Enemies alive at the same time before the spawner waits. */
    maxAlive: number
    /** Seconds between spawn batches. */
    spawnInterval: number
    batchSize: number
}

export interface PlayerStats {
    maxHealth: number
    healthRegen: number
    moveSpeed: number
    damageMult: number
    fireRateMult: number
    reloadMult: number
    critChance: number
    critMult: number
    lifesteal: number
    meleeDamageMult: number
    meleeRangeMult: number
    dashCharges: number
    dashCooldown: number
    jumpCharges: number
    projectileSpeedMult: number
    magazineMult: number
    pickupRange: number
    energyMax: number
    energyPerKill: number
    abilityMult: number
    abilityCost: number
    armor: number
    luck: number
    scale: number
    // "Crazy" build-defining modifiers — each is a stack count.
    ricochet: number
    pierce: number
    explosiveRounds: number
    chainLightning: number
    splitShot: number
    orbitBlades: number
    killBlast: number
    chronoKill: number
    fireTrail: number
    frenzy: number
    vampireAura: number
    homing: number
    bulletSize: number
    thorns: number
    secondWind: number
}

export interface UpgradeCard {
    id: string
    name: string
    description: string
    rarity: Rarity
    kind: 'stat' | 'crazy' | 'weapon'
    icon: string
    weaponId?: WeaponId
    maxStacks?: number
    apply: (stats: PlayerStats) => void
}

export interface DraftCard extends UpgradeCard {
    /** Unique per draft so the same upgrade can appear in two drafts. */
    draftKey: string
}
