// Voxel Arena — shared types for the pure data modules and the engine.

export type WeaponId = 'pistol' | 'magnum' | 'smg' | 'rifle' | 'burst' | 'dmr' | 'shotgun' | 'lmg' | 'saw' | 'sniper' | 'flamer' | 'launcher' | 'raygun' | 'arc'

export type EnemyId = 'grunt' | 'runner' | 'brute' | 'spitter' | 'drone' | 'charger' | 'warden' | 'bomber' | 'mender' | 'titan'

export type EnemyBehavior = 'melee' | 'ranged' | 'flyer' | 'charger' | 'boss' | 'bomber' | 'mender'

export type EliteAffix = 'swift' | 'armored' | 'volatile' | 'gilded'

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export type SightKind = 'reddot' | 'holo' | 'scope' | 'iron' | 'ring'

export type MeleeId = 'sword' | 'dagger' | 'spear' | 'katana' | 'axe' | 'scythe'

export interface MeleeDef {
    id: MeleeId
    name: string
    tagline: string
    damage: number
    range: number
    /** Full sweep angle in radians of the normal slashes. */
    arc: number
    /** Length of the swing animation in seconds. */
    swingTime: number
    /** Attacks per second; the swing animation always fits inside one attack. */
    rate: number
    /** Damage multiplier of the third hit. */
    finisherMult: number
    /** How the finisher lands: a wide slash, a full spin, an overhead slam, or a long thrust. */
    finisher: 'slash' | 'spin' | 'slam' | 'thrust'
    knockback: number
    lunge: number
    rarity: Rarity
    color: number
}

export type AbilityId = 'nova' | 'sentry' | 'blink' | 'chrono'

export interface AbilityDef {
    id: AbilityId
    name: string
    description: string
    /** Energy per cast. */
    energy: number
    icon: string
    color: string
}

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
    kind: 'bullet' | 'plasma' | 'rail' | 'arc' | 'disc' | 'flame'
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
    /** Aim-down-sights reticle style. */
    sight: SightKind
    /** Camera field of view while aiming (zoom). */
    adsFov: number
    /** Spread multiplier while aiming. */
    adsSpread: number
    /** Extra spread added per shot from the hip, decaying over time. */
    bloom: number
    /** Seconds of burn applied on hit (0 = none). */
    burn: number
    /** Rounds carried outside the magazine. */
    reserve: number
    /** Credit price in the arsenal; stronger guns cost more waves of saving. */
    price: number
    /** Rounds fired per trigger pull (1 = single shot). */
    burst: number
    /** Seconds between bursts, only used when burst > 1. */
    burstGap: number
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
    event: 'none' | 'meteors' | 'frenzy' | 'blackout' | 'bounty'
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
    incendiary: number
    shrapnel: number
    adrenaline: number
    bulwark: number
    sentry: number
    turretCost: number
    // Boons added with the arsenal rework.
    /** Kills may tear open a void rift that drags enemies in and detonates. */
    rift: number
    /** Periodic lightning strikes on random enemies. */
    storm: number
    /** Every few seconds the next shot becomes a piercing sun lance. */
    lance: number
    /** Bullet hits slow enemies. */
    frost: number
    /** Enemies below a health fraction are executed outright. */
    execute: number
    /** Every fifth kill fires a ring of bullets from the player. */
    bulletStorm: number
    /** Dashes arc lightning into nearby enemies. */
    thunderStep: number
    /** Finishing a reload releases a shockwave. */
    reloadBlast: number
    /** Health restored per kill. */
    bloodlust: number
    /** Headshots refund the round to the magazine. */
    headhunter: number
    /** Multiplier on reserve ammo for every gun. */
    reserveMult: number
    /** Multiplier on the ammo drop chance. */
    ammoLuck: number
    /** Extra fraction of wave income. */
    income: number
    /** Friendly meteors fall on the pack every few seconds. */
    meteorCall: number
}

export interface UpgradeCard {
    id: string
    name: string
    description: string
    rarity: Rarity
    kind: 'stat' | 'crazy'
    icon: string
    /** Only offered once this ability is owned. */
    requiresAbility?: AbilityId
    maxStacks?: number
    apply: (stats: PlayerStats) => void
}

export interface DraftCard extends UpgradeCard {
    /** Unique per draft so the same upgrade can appear in two drafts. */
    draftKey: string
    /** Credit price. */
    cost: number
    /** How many copies the player already holds. */
    owned: number
}

// ── Between-wave shop ───────────────────────────────────────────────────

export interface ShopWeapon {
    id: WeaponId
    name: string
    tagline: string
    rarity: Rarity
    price: number
    owned: boolean
    /** Loadout slot when owned, otherwise -1. */
    slot: number
    magazine: number
    reserve: number
    reserveMax: number
    /** Price to fill the reserve, 0 when already full. */
    refillPrice: number
}

export interface ShopMelee {
    id: MeleeId
    name: string
    tagline: string
    rarity: Rarity
    price: number
    owned: boolean
}

export interface ShopAbility {
    id: AbilityId
    name: string
    description: string
    energy: number
    price: number
    owned: boolean
    icon: string
    color: string
}

export interface ShopState {
    credits: number
    wave: number
    /** Credits granted for clearing the wave just finished. */
    income: number
    boons: DraftCard[]
    rerollCost: number
    weapons: ShopWeapon[]
    melee: ShopMelee[]
    abilities: ShopAbility[]
    /** Weapon ids per loadout slot. */
    slots: (WeaponId | null)[]
    maxWeapons: number
    refillAllPrice: number
}
