import { randomFloat } from '../random'

export const SHAPEZZ_CHECKPOINT_MS = 45_000
// SHAPEZZ used to pay its raw arcade-score values as coins, leaving a clean
// six-minute run far behind a completed Pirate voyage. Keep score tuning
// readable in the engine and convert it into the shared game economy here.
export const SHAPEZZ_COIN_PAYOUT_SCALE = 31.25
export const SHAPEZZ_MAX_PERMANENT_LEVEL = 20
export const SHAPEZZ_MAX_KILL_HEAL_LEVEL = 4
export const SHAPEZZ_WEAPON_REFUND_RATE = 0.25
export const SHAPEZZ_LAUNCHER_CORE_RADIUS_RATIO = 0.45
export const SHAPEZZ_LAUNCHER_EDGE_DAMAGE_MULTIPLIER = 0.2
/**
 * Companion turrets (orbitals, afterimage turrets, drones) hit for this much of the player's damage.
 * Deliberately a plain multiple of `stats.damage` rather than a share of enemy max health: health-relative
 * turret damage ignored the player's build entirely and scaled without any ceiling. The ceiling battery is
 * exempt — it already mirrors the player's weapon and upgrades at its own fire rate.
 */
export const SHAPEZZ_TURRET_DAMAGE_MULTIPLIER = 2.5

/**
 * Pool sizes. Player and hostile projectiles have separate budgets so a screen
 * full of boss bullets can never starve the player's own gun, and within the
 * player's budget the main weapon outranks companions, which outrank on-kill
 * spawns (see `SHAPEZZ_BULLET_PRIORITY`).
 */
export const SHAPEZZ_COMBAT_LIMITS = {
    enemies: 120,
    playerBullets: 1100,
    enemyBullets: 480,
    particles: 1800,
    debris: 260,
    damageTexts: 150,
    shockwaves: 150,
    beams: 200,
    pickups: 320,
    turrets: 12,
    singularities: 4,
    lasers: 16
} as const

/** Higher numbers survive eviction when the player's projectile pool is full. */
export const SHAPEZZ_BULLET_PRIORITY = {
    /** Novas, splitstorm shards: plentiful, the first to go. */
    spawned: 0,
    /** Orbitals, drones, afterimage turrets. */
    companion: 1,
    /** The player's gun and the ceiling battery that copies it. */
    weapon: 2
} as const
export type ShapezzBulletPriority = typeof SHAPEZZ_BULLET_PRIORITY[keyof typeof SHAPEZZ_BULLET_PRIORITY]

export const SHAPEZZ_ENEMY_TYPES = ['melee', 'shooter', 'tank', 'dasher', 'splitter', 'shard', 'sniper', 'bomber', 'warden', 'boss'] as const
export type ShapezzEnemyType = typeof SHAPEZZ_ENEMY_TYPES[number]

export interface ShapezzEnemyConfig {
    radius: number
    hp: number
    damage: number
    speed: number
    /** Arcade score, converted to coins by `shapezzEnemyCoinValue`. */
    reward: number
    color: string
    /** Relative spawn weight once unlocked; 0 never spawns on its own. */
    weight: number
    /** First checkpoint this shape joins the random mix. */
    unlock: number
}

export const SHAPEZZ_ENEMIES: Record<ShapezzEnemyType, ShapezzEnemyConfig> = {
    melee: { radius: 18, hp: 38, damage: 13, speed: 150, reward: 15, color: '#fb7185', weight: 44, unlock: 0 },
    shooter: { radius: 21, hp: 52, damage: 10, speed: 92, reward: 22, color: '#fbbf24', weight: 24, unlock: 0 },
    dasher: { radius: 16, hp: 62, damage: 18, speed: 205, reward: 30, color: '#34d399', weight: 16, unlock: 0 },
    tank: { radius: 31, hp: 155, damage: 22, speed: 62, reward: 50, color: '#a78bfa', weight: 11, unlock: 0 },
    splitter: { radius: 24, hp: 78, damage: 14, speed: 112, reward: 24, color: '#f472b6', weight: 12, unlock: 1 },
    /** Only born from a splitter. */
    shard: { radius: 11, hp: 14, damage: 8, speed: 235, reward: 5, color: '#f9a8d4', weight: 0, unlock: 0 },
    bomber: { radius: 19, hp: 30, damage: 34, speed: 128, reward: 28, color: '#ef4444', weight: 9, unlock: 2 },
    sniper: { radius: 17, hp: 44, damage: 24, speed: 86, reward: 34, color: '#f97316', weight: 8, unlock: 3 },
    warden: { radius: 27, hp: 130, damage: 16, speed: 70, reward: 48, color: '#60a5fa', weight: 5, unlock: 3 },
    boss: { radius: 74, hp: 2200, damage: 28, speed: 68, reward: 250, color: '#e879f9', weight: 0, unlock: 0 }
}

/** Enemies inside a warden's aura take this share of incoming damage. */
export const SHAPEZZ_WARDEN_DAMAGE_TAKEN = 0.5
export const SHAPEZZ_WARDEN_AURA_RADIUS = 175
export const SHAPEZZ_BOMBER_BLAST_RADIUS = 125
export const SHAPEZZ_SPLITTER_SHARDS = 3

/** The random spawn mix at a checkpoint: every unlocked shape by weight. */
export function shapezzEnemyMix(checkpoint: number) {
    const unlocked = SHAPEZZ_ENEMY_TYPES
        .filter(type => SHAPEZZ_ENEMIES[type].weight > 0 && SHAPEZZ_ENEMIES[type].unlock <= checkpoint)
    const total = unlocked.reduce((sum, type) => sum + SHAPEZZ_ENEMIES[type].weight, 0)
    return unlocked.map(type => ({ type, share: SHAPEZZ_ENEMIES[type].weight / total }))
}

/** Elites: three times the health, four times the loot, a crown. From checkpoint 2. */
export const SHAPEZZ_ELITE = { hp: 3.2, damage: 1.3, reward: 4, radius: 1.35 } as const
export function shapezzEliteChance(checkpoint: number) {
    if (checkpoint < 2) return 0
    return Math.min(0.12, 0.03 + (checkpoint - 2) * 0.012)
}

export const SHAPEZZ_BOSS_KINDS = ['overseer', 'prism', 'hive', 'polygon'] as const
export type ShapezzBossKind = typeof SHAPEZZ_BOSS_KINDS[number]

export const SHAPEZZ_BOSSES: Record<ShapezzBossKind, { name: string, title: string, color: string, accent: string, hp: number, radius: number, speed: number }> = {
    overseer: { name: 'THE OVERSEER', title: 'It watches. Then it fills the sky.', color: '#e879f9', accent: '#f5d0fe', hp: 1, radius: 74, speed: 68 },
    prism: { name: 'THE PRISM', title: 'Refracts everything, including you.', color: '#93c5fd', accent: '#e0f2fe', hp: 1.1, radius: 70, speed: 60 },
    hive: { name: 'THE HIVE QUEEN', title: 'Never arrives alone.', color: '#facc15', accent: '#fef9c3', hp: 1.25, radius: 80, speed: 52 },
    polygon: { name: 'THE IMPOSSIBLE POLYGON', title: 'Geometry that should not exist.', color: '#f43f5e', accent: '#ffe4e6', hp: 1.45, radius: 78, speed: 74 }
}

/** Bosses arrive every second checkpoint and rotate through the roster. */
export function shapezzBossForCheckpoint(checkpoint: number): ShapezzBossKind | null {
    if (checkpoint < 2 || checkpoint % 2 !== 0) return null
    return SHAPEZZ_BOSS_KINDS[(checkpoint / 2 - 1) % SHAPEZZ_BOSS_KINDS.length]!
}

/** "Bosses stop taking turns": from checkpoint 10 on Mayhem and above, a second boss escorts the first. */
export function shapezzBossEscort(checkpoint: number, difficultyId: ShapezzDifficultyId): ShapezzBossKind | null {
    const tier = SHAPEZZ_DIFFICULTY_IDS.indexOf(difficultyId)
    if (tier < 3 || checkpoint < 10) return null
    const main = shapezzBossForCheckpoint(checkpoint)
    if (!main) return null
    return SHAPEZZ_BOSS_KINDS[(SHAPEZZ_BOSS_KINDS.indexOf(main) + 2) % SHAPEZZ_BOSS_KINDS.length]!
}

/**
 * Boss health multiplier on top of the arena's own ramp. Bosses follow the arena's base
 * 1.28x-per-mutation curve, not the late wall stacked on top of it (see
 * `shapezzCheckpointPressure`): the boss at checkpoint 8 should be a hard fight, not a sponge
 * that outlives the run.
 */
export function shapezzBossHealthScale(checkpoint: number, kind: ShapezzBossKind) {
    const wall = shapezzCheckpointPressure(checkpoint).health / Math.pow(1.28, Math.max(0, Math.floor(checkpoint)))
    return (0.55 + checkpoint * 0.14) * SHAPEZZ_BOSSES[kind].hp / wall
}

export const SHAPEZZ_DIFFICULTY_IDS = ['spark', 'surge', 'overdrive', 'mayhem', 'annihilation'] as const
export type ShapezzDifficultyId = typeof SHAPEZZ_DIFFICULTY_IDS[number]

export interface ShapezzDifficulty {
    id: ShapezzDifficultyId
    name: string
    tagline: string
    enemyHealth: number
    enemyDamage: number
    enemySpeed: number
    spawnRate: number
    reward: number
    color: string
}

export const SHAPEZZ_DIFFICULTIES: ShapezzDifficulty[] = [
    { id: 'spark', name: 'Spark', tagline: 'A warm-up with teeth', enemyHealth: 0.78, enemyDamage: 0.65, enemySpeed: 0.88, spawnRate: 0.82, reward: 0.75, color: '#22d3ee' },
    { id: 'surge', name: 'Surge', tagline: 'The intended first run', enemyHealth: 1, enemyDamage: 1, enemySpeed: 1, spawnRate: 0.9, reward: 1, color: '#a3e635' },
    { id: 'overdrive', name: 'Overdrive', tagline: 'Crowds become a flood', enemyHealth: 2.15, enemyDamage: 1.45, enemySpeed: 1.12, spawnRate: 1.2, reward: 2.2, color: '#fbbf24' },
    { id: 'mayhem', name: 'Mayhem', tagline: 'Bosses stop taking turns', enemyHealth: 3.7, enemyDamage: 1.85, enemySpeed: 1.25, spawnRate: 1.42, reward: 3.6, color: '#fb7185' },
    { id: 'annihilation', name: 'Annihilation', tagline: 'The screen is the enemy', enemyHealth: 6.2, enemyDamage: 2.5, enemySpeed: 1.4, spawnRate: 1.62, reward: 5.5, color: '#e879f9' }
]

export function shapezzDifficulty(id: unknown): ShapezzDifficulty {
    return SHAPEZZ_DIFFICULTIES.find(difficulty => difficulty.id === id) ?? SHAPEZZ_DIFFICULTIES[1]!
}

export const SHAPEZZ_PERMANENT_UPGRADE_IDS = ['core', 'overclock', 'armor', 'thrusters', 'magnet', 'killHeal'] as const
export type ShapezzPermanentUpgradeId = typeof SHAPEZZ_PERMANENT_UPGRADE_IDS[number]

export interface ShapezzPermanentLevels {
    core: number
    overclock: number
    armor: number
    thrusters: number
    magnet: number
    killHeal: number
}

export const SHAPEZZ_WEAPON_TYPES = ['blaster', 'launcher', 'shotgun', 'arcCoil', 'railgun'] as const
export type ShapezzWeaponType = typeof SHAPEZZ_WEAPON_TYPES[number]
export const SHAPEZZ_WEAPON_RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const
export type ShapezzWeaponRarity = typeof SHAPEZZ_WEAPON_RARITIES[number]

export interface ShapezzWeapon {
    id: string
    type: ShapezzWeaponType
    rarity: ShapezzWeaponRarity
    rarityName: string
    name: string
    description: string
    icon: string
    cost: number
    power: number
    damageMultiplier: number
    fireRateMultiplier: number
    projectileSpeedMultiplier: number
    projectileSizeMultiplier: number
    pellets: number
    spread: number
    explosionRadius: number
    falloffStart: number
    falloffEnd: number
    minFalloffDamage: number
    chainRange: number
    chainCount: number
    primaryColor: string
    accentColor: string
    visualIntensity: number
}

const WEAPON_RARITY_META: Record<ShapezzWeaponRarity, {
    name: string
    rank: number
    damage: number
    fireRate: number
    speed: number
    size: number
    primaryColor: string
    accentColor: string
}> = {
    common: { name: 'Common', rank: 0, damage: 1, fireRate: 1, speed: 1, size: 1, primaryColor: '#67e8f9', accentColor: '#ecfeff' },
    rare: { name: 'Rare', rank: 1, damage: 1.2, fireRate: 1.04, speed: 1.07, size: 1.07, primaryColor: '#60a5fa', accentColor: '#dbeafe' },
    epic: { name: 'Epic', rank: 2, damage: 1.5, fireRate: 1.08, speed: 1.14, size: 1.15, primaryColor: '#c084fc', accentColor: '#f3e8ff' },
    legendary: { name: 'Legendary', rank: 3, damage: 1.9, fireRate: 1.12, speed: 1.22, size: 1.25, primaryColor: '#fbbf24', accentColor: '#fef3c7' },
    mythic: { name: 'Mythic', rank: 4, damage: 2.45, fireRate: 1.16, speed: 1.32, size: 1.38, primaryColor: '#fb7185', accentColor: '#f0abfc' }
}

const WEAPON_TYPE_META: Record<ShapezzWeaponType, {
    name: string
    description: string
    icon: string
    damage: number
    fireRate: number
    speed: number
    size: number
    pellets: number
    spread: number
    explosionRadius: number
    falloffStart: number
    falloffEnd: number
    minFalloffDamage: number
    chainRange: number
    chainCount: number
    prices: Record<ShapezzWeaponRarity, number>
}> = {
    blaster: {
        name: 'Pulse Carbine', description: 'Fast, precise and dependable. One shot goes exactly where you point it.', icon: 'i-lucide-crosshair',
        damage: 1, fireRate: 1, speed: 1, size: 1, pellets: 1, spread: 0, explosionRadius: 0, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1, chainRange: 0, chainCount: 0,
        prices: { common: 0, rare: 20_000, epic: 300_000, legendary: 4_000_000, mythic: 36_000_000 }
    },
    launcher: {
        name: 'Nova Mortar', description: 'Slow plasma shells with a devastating core and a wide, weakening blast.', icon: 'i-lucide-bomb',
        damage: 2.2, fireRate: 0.24, speed: 0.72, size: 1.65, pellets: 1, spread: 0, explosionRadius: 125, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1, chainRange: 0, chainCount: 0,
        prices: { common: 12_000, rare: 75_000, epic: 800_000, legendary: 8_000_000, mythic: 50_000_000 }
    },
    shotgun: {
        name: 'Scatter Array', description: 'Tight volleys of micro-missiles that curve onto shapes near your aim and pop in small blasts. Forgiving, never hits hard.', icon: 'i-lucide-rocket',
        damage: 0.42, fireRate: 0.5, speed: 0.8, size: 0.8, pellets: 3, spread: 0.22, explosionRadius: 50, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1, chainRange: 0, chainCount: 0,
        prices: { common: 8_000, rare: 50_000, epic: 600_000, legendary: 6_000_000, mythic: 45_000_000 }
    },
    arcCoil: {
        name: 'Arc Coil', description: 'A close-range lightning weapon. Each discharge leaps between nearby shapes within the same short range.', icon: 'i-lucide-git-branch',
        damage: 0.82, fireRate: 0.7, speed: 1, size: 1, pellets: 1, spread: 0, explosionRadius: 0, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1, chainRange: 235, chainCount: 1,
        prices: { common: 10_000, rare: 65_000, epic: 700_000, legendary: 7_000_000, mythic: 48_000_000 }
    },
    railgun: {
        name: 'Rail Driver', description: 'A slow, hitscan slug that punches through every shape on the line. Each body it passes through takes a little less.', icon: 'i-lucide-move-right',
        damage: 2.6, fireRate: 0.3, speed: 1, size: 1, pellets: 1, spread: 0, explosionRadius: 0, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1, chainRange: 0, chainCount: 0,
        prices: { common: 14_000, rare: 85_000, epic: 900_000, legendary: 9_000_000, mythic: 50_000_000 }
    }
}

const WEAPON_POWER_BONUS: Record<ShapezzWeaponType, number> = { blaster: 0, launcher: 8, shotgun: 5, arcCoil: 6, railgun: 8 }

export function shapezzWeapon(type: unknown, rarity: unknown): ShapezzWeapon {
    const weaponType: ShapezzWeaponType = SHAPEZZ_WEAPON_TYPES.includes(type as ShapezzWeaponType) ? type as ShapezzWeaponType : 'blaster'
    const weaponRarity: ShapezzWeaponRarity = SHAPEZZ_WEAPON_RARITIES.includes(rarity as ShapezzWeaponRarity) ? rarity as ShapezzWeaponRarity : 'common'
    const typeMeta = WEAPON_TYPE_META[weaponType]
    const rarityMeta = WEAPON_RARITY_META[weaponRarity]
    const rank = rarityMeta.rank
    return {
        id: `${weaponType}:${weaponRarity}`,
        type: weaponType,
        rarity: weaponRarity,
        rarityName: rarityMeta.name,
        name: `${rarityMeta.name} ${typeMeta.name}`,
        description: typeMeta.description,
        icon: typeMeta.icon,
        cost: typeMeta.prices[weaponRarity],
        power: rank * 18 + WEAPON_POWER_BONUS[weaponType],
        damageMultiplier: typeMeta.damage * rarityMeta.damage,
        fireRateMultiplier: typeMeta.fireRate * rarityMeta.fireRate,
        projectileSpeedMultiplier: typeMeta.speed * rarityMeta.speed,
        projectileSizeMultiplier: typeMeta.size * rarityMeta.size,
        pellets: typeMeta.pellets + (weaponType === 'shotgun' ? Math.floor(rank / 2) : 0),
        spread: typeMeta.spread,
        explosionRadius: typeMeta.explosionRadius > 0 ? typeMeta.explosionRadius + rank * (weaponType === 'shotgun' ? 5 : 8) : 0,
        falloffStart: typeMeta.falloffStart,
        falloffEnd: typeMeta.falloffEnd,
        minFalloffDamage: typeMeta.minFalloffDamage,
        chainRange: typeMeta.chainRange,
        chainCount: typeMeta.chainCount + (weaponType === 'arcCoil' ? rank : 0),
        primaryColor: rarityMeta.primaryColor,
        accentColor: rarityMeta.accentColor,
        visualIntensity: rank + 1
    }
}

/** Maximum volleys per second, kept below the particle budget for each weapon class. */
export function shapezzWeaponFireRateCap(type: ShapezzWeaponType) {
    if (type === 'shotgun') return 5
    if (type === 'launcher') return 3
    if (type === 'arcCoil') return 7
    if (type === 'railgun') return 3
    return 18
}

/**
 * Full-hit sustained DPS before upgrades, pierce, explosions, or misses.
 * Scatter Array's real combat DPS is lower at range because its spread causes
 * pellets to miss; this is deliberately its close-range ceiling.
 */
export function shapezzWeaponPointBlankDps(weapon: ShapezzWeapon, baseFireRate: number) {
    const volleysPerSecond = Math.min(shapezzWeaponFireRateCap(weapon.type), Math.max(0, baseFireRate) * weapon.fireRateMultiplier)
    return volleysPerSecond * weapon.damageMultiplier * weapon.pellets
}

/** Launcher splash is full strength in the inner blast, then falls to chip damage at its edge. */
export function shapezzExplosionDamageMultiplier(distanceFromImpact: number, radius: number) {
    const distance = Math.max(0, distanceFromImpact)
    const safeRadius = Math.max(1, radius)
    const coreRadius = safeRadius * SHAPEZZ_LAUNCHER_CORE_RADIUS_RATIO
    if (distance <= coreRadius) return 1
    if (distance >= safeRadius) return SHAPEZZ_LAUNCHER_EDGE_DAMAGE_MULTIPLIER

    const outerProgress = (distance - coreRadius) / (safeRadius - coreRadius)
    return 1 - outerProgress * (1 - SHAPEZZ_LAUNCHER_EDGE_DAMAGE_MULTIPLIER)
}

export const SHAPEZZ_WEAPONS = SHAPEZZ_WEAPON_TYPES.flatMap(type => SHAPEZZ_WEAPON_RARITIES.map(rarity => shapezzWeapon(type, rarity)))

export function shapezzWeaponRefund(purchasePrice: number) {
    return Math.floor(Math.max(0, purchasePrice) * SHAPEZZ_WEAPON_REFUND_RATE)
}

export function shapezzWeaponReplacement(purchasePrice: number, nextWeaponCost: number) {
    const refund = shapezzWeaponRefund(purchasePrice)
    return { refund, netCost: Math.max(0, nextWeaponCost) - refund }
}

export const SHAPEZZ_PERMANENT_UPGRADES: Record<ShapezzPermanentUpgradeId, {
    name: string
    description: string
    icon: string
    color: string
    maxLevel: number
}> = {
    core: { name: 'Rage Core', description: 'Harder hits and nastier explosions', icon: 'i-lucide-sun', color: 'error', maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL },
    overclock: { name: 'Gun Overclock', description: 'Faster fire from every weapon', icon: 'i-lucide-gauge', color: 'warning', maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL },
    armor: { name: 'Reactive Armor', description: 'More health at the start of every run', icon: 'i-lucide-shield-plus', color: 'success', maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL },
    thrusters: { name: 'Violent Thrusters', description: 'More speed, stronger jumps and tighter air control', icon: 'i-lucide-rocket', color: 'info', maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL },
    magnet: { name: 'Loot Singularity', description: 'Vacuum coins and health from farther away', icon: 'i-lucide-orbit', color: 'secondary', maxLevel: SHAPEZZ_MAX_PERMANENT_LEVEL },
    killHeal: { name: 'Blood Battery', description: 'Restore health instantly whenever any enemy dies', icon: 'i-lucide-heart-pulse', color: 'success', maxLevel: SHAPEZZ_MAX_KILL_HEAL_LEVEL }
}

/**
 * A single exponential across all twenty levels.
 *
 * The old curve doubled to level ten and then multiplied by seven hundred,
 * which put the workshop at 5.3 billion — about eighteen thousand maxed runs.
 * These games were priced as coin sinks before prestige existed; prestige owns
 * that job now, and the back half of a tree nobody reaches is not a sink, it is
 * a wall. The whole workshop is now a few hundred million, in the same bracket
 * as the Pirate Raid armoury and the FIREWALL Mainframe.
 */
export const SHAPEZZ_UPGRADE_GROWTH = 1.55

export function shapezzPermanentUpgradeCost(id: ShapezzPermanentUpgradeId, level: number) {
    if (level >= SHAPEZZ_PERMANENT_UPGRADES[id].maxLevel) return null
    if (id === 'killHeal') return [200_000, 1_000_000, 5_000_000, 20_000_000][level] ?? null
    const base = { core: 8_000, overclock: 8_500, armor: 6_500, thrusters: 7_500, magnet: 5_500 }[id]
    return Math.round(base * Math.pow(SHAPEZZ_UPGRADE_GROWTH, level))
}

/** Gem-bought pre-run bonus: each level grants one free upgrade pick before the run starts. Consumed on start. */
export const SHAPEZZ_HEAD_START_MAX_LEVEL = 1
export const SHAPEZZ_HEAD_START_COSTS = [2, 10, 50]

export function shapezzHeadStartCost(level: number) {
    if (level >= SHAPEZZ_HEAD_START_MAX_LEVEL) return null
    return SHAPEZZ_HEAD_START_COSTS[level] ?? null
}

/**
 * Permanent stats. The spread between a bare account and a maxed one has to be
 * wide enough that the top difficulties are a different game rather than a
 * shorter one: at twenty levels this is 7x damage and 2.3x fire rate on 6x the
 * health, against arena curves that ramp roughly as fast.
 */
export function shapezzPlayerStats(levels: ShapezzPermanentLevels) {
    return {
        maxHp: 120 + levels.armor * 30,
        damage: 18 + levels.core * 5.5,
        fireRate: 5.5 + levels.overclock * 0.35,
        moveSpeed: 330 + levels.thrusters * 14,
        jumpSpeed: 930 + levels.thrusters * 20,
        magnetRange: 115 + levels.magnet * 22,
        healthPerKill: Math.min(5, 1 + levels.killHeal)
    }
}

export function shapezzPower(levels: ShapezzPermanentLevels, weapon: ShapezzWeapon = shapezzWeapon('blaster', 'common')) {
    return 10
        + levels.core * 5
        + levels.overclock * 5
        + levels.armor * 4
        + levels.thrusters * 3
        + levels.magnet * 2
        + levels.killHeal * 8
        + weapon.power
}

export const SHAPEZZ_RUN_UPGRADE_IDS = [
    'twinFang', 'splitstorm', 'railPierce', 'ricochet', 'explosive', 'chainLightning',
    'orbitals', 'droneSwarm', 'blackHole', 'bulletTime', 'giantRounds', 'vampireBurst',
    'afterimage', 'deathNova', 'frenzy', 'hyperVelocity', 'killShockwave', 'executioner',
    'overkillDividend', 'ceilingBattery', 'aegisPlating', 'overcharge', 'prismLance'
] as const
export type ShapezzRunUpgradeId = typeof SHAPEZZ_RUN_UPGRADE_IDS[number]

export interface ShapezzRunUpgrade {
    id: ShapezzRunUpgradeId
    name: string
    description: string
    stackText: string
    icon: string
    rarity: 'wild' | 'unstable' | 'cataclysmic'
    accent: string
}

export const SHAPEZZ_RUN_UPGRADES: ShapezzRunUpgrade[] = [
    { id: 'twinFang', name: 'TWIN FANG', description: 'Fire 2 extra projectiles in a tight spread.', stackText: '+2 projectiles per stack', icon: 'i-lucide-git-fork', rarity: 'wild', accent: '#22d3ee' },
    { id: 'splitstorm', name: 'SPLITSTORM', description: 'Every kill launches 5 seeking shards.', stackText: '+3 shards per stack', icon: 'i-lucide-sparkles', rarity: 'unstable', accent: '#a78bfa' },
    { id: 'railPierce', name: 'INFINITE RAIL', description: 'Shots punch through 2 additional enemies.', stackText: '+2 pierce per stack', icon: 'i-lucide-move-right', rarity: 'wild', accent: '#67e8f9' },
    { id: 'ricochet', name: 'PINBALL MURDER', description: 'Shots bounce twice and retarget nearby shapes.', stackText: '+2 bounces per stack', icon: 'i-lucide-zap', rarity: 'unstable', accent: '#fde047' },
    { id: 'explosive', name: 'EVERYTHING EXPLODES', description: 'Bullet impacts detonate an area blast.', stackText: 'Larger, harder blasts', icon: 'i-lucide-bomb', rarity: 'cataclysmic', accent: '#fb7185' },
    { id: 'chainLightning', name: 'CHAIN REACTION', description: 'Hits arc lightning through 3 nearby enemies.', stackText: '+2 chain targets', icon: 'i-lucide-radio-tower', rarity: 'cataclysmic', accent: '#c4b5fd' },
    { id: 'orbitals', name: 'ORBITAL ARMORY', description: 'Gain 2 orbiting guns that fire for 250% of your damage and swat enemy shots out of the air.', stackText: '+2 orbital guns', icon: 'i-lucide-orbit', rarity: 'cataclysmic', accent: '#f0abfc' },
    { id: 'droneSwarm', name: 'DRONE SWARM', description: 'Deploy 2 hunter drones with rapid lasers that hit for 250% of your damage.', stackText: '+2 drones', icon: 'i-lucide-bot', rarity: 'unstable', accent: '#34d399' },
    { id: 'blackHole', name: 'POCKET SINGULARITY', description: 'Every 4.5 seconds, tear open a crushing black hole where you aim.', stackText: 'Opens 0.9s sooner and pulls wider', icon: 'i-lucide-circle-dot', rarity: 'cataclysmic', accent: '#e879f9' },
    { id: 'bulletTime', name: 'PANIC FIELD', description: 'Enemy projectiles crawl when they get close.', stackText: 'Slower hostile bullets', icon: 'i-lucide-clock-3', rarity: 'wild', accent: '#60a5fa' },
    { id: 'giantRounds', name: 'ABSURD CALIBER', description: 'Projectiles become 70% larger and hit much harder.', stackText: '+70% size, +35% damage', icon: 'i-lucide-maximize-2', rarity: 'unstable', accent: '#fb923c' },
    { id: 'vampireBurst', name: 'BLOOD CIRCUIT', description: 'Every 16 kills, regenerate 22% max health over 2.5s. 7s cooldown.', stackText: '+4% healing, 2 kills sooner, -0.8s cooldown', icon: 'i-lucide-heart-pulse', rarity: 'wild', accent: '#f43f5e' },
    { id: 'afterimage', name: 'AFTERIMAGE TURRETS', description: 'Jumping leaves a temporary auto-firing turret that hits for 250% of your damage.', stackText: '+1 turret per jump', icon: 'i-lucide-copy', rarity: 'unstable', accent: '#2dd4bf' },
    { id: 'deathNova', name: 'CORPSE NOVA', description: 'Dead enemies fire a 12-shot radial burst for you.', stackText: '+6 nova shots', icon: 'i-lucide-sun', rarity: 'cataclysmic', accent: '#facc15' },
    { id: 'frenzy', name: 'NO BRAKES', description: 'Fire rate doubles while your combo is alive.', stackText: '+35% frenzy fire rate', icon: 'i-lucide-flame', rarity: 'unstable', accent: '#f97316' },
    { id: 'hyperVelocity', name: 'HYPERVELOCITY', description: 'Projectiles move 50% faster and hit 25% harder.', stackText: '+50% speed, +25% damage', icon: 'i-lucide-chevrons-right', rarity: 'wild', accent: '#38bdf8' },
    { id: 'killShockwave', name: 'KILLQUAKE', description: 'Every 12 kills, emit a growing shockwave that damages nearby enemies.', stackText: 'Triggers sooner, grows larger and hits harder', icon: 'i-lucide-waves', rarity: 'unstable', accent: '#22d3ee' },
    { id: 'executioner', name: 'EXECUTIONER', description: 'Enemies below 18% health are instantly destroyed. Bosses at half that.', stackText: '+3% execution threshold', icon: 'i-lucide-skull', rarity: 'cataclysmic', accent: '#fb7185' },
    { id: 'overkillDividend', name: 'OVERKILL DIVIDEND', description: 'Excess lethal damage erupts from the victim as a compact shockwave.', stackText: 'Larger wave, converts more excess damage', icon: 'i-lucide-circle-dollar-sign', rarity: 'unstable', accent: '#fbbf24' },
    { id: 'ceilingBattery', name: 'CEILING BATTERY', description: 'Mount a top-center turret that copies your weapon, projectiles and offensive upgrades at 82% fire rate.', stackText: '+1 full-power ceiling turret', icon: 'i-lucide-cctv', rarity: 'cataclysmic', accent: '#a3e635' },
    { id: 'aegisPlating', name: 'AEGIS PLATING', description: 'Every 16 kills, gain a 40 point shield that soaks damage before your hull. Holds up to 120.', stackText: '+20 per plate, +60 capacity, 2 kills sooner', icon: 'i-lucide-shield', rarity: 'wild', accent: '#38bdf8' },
    { id: 'overcharge', name: 'OVERCHARGE', description: '16% of your hits critically strike for 250% damage.', stackText: '+7% crit chance, +50% crit damage', icon: 'i-lucide-target', rarity: 'unstable', accent: '#f472b6' },
    { id: 'prismLance', name: 'PRISM LANCE', description: 'Every 3.5 seconds, fire a screen-piercing beam along your aim for 900% damage.', stackText: '0.5s sooner, +300% beam damage', icon: 'i-lucide-sword', rarity: 'cataclysmic', accent: '#fde68a' }
]

/**
 * Blood Circuit. Deliberately a regen-over-time on an internal cooldown rather than an instant burst:
 * the trigger is kill-gated, and late builds kill fast enough that an instant heal made the player
 * unkillable. The cooldown decouples the heal from kill rate; the ramp lets spike damage still land.
 */
export function shapezzVampireBurstStats(stacks: number) {
    const bounded = Math.max(1, Math.min(4, stacks))
    return {
        kills: Math.max(10, 16 - (bounded - 1) * 2),
        healFraction: 0.22 + (bounded - 1) * 0.04,
        duration: 2.5,
        cooldown: Math.max(3.4, 7 - (bounded - 1) * 0.8)
    }
}

/**
 * Aegis Plating. Flat, capped shield on purpose — it stays relevant early and fades naturally as
 * max HP scales, so it can never become a percentage-based immortality engine like Blood Circuit was.
 */
export function shapezzShieldStats(stacks: number) {
    const bounded = Math.max(1, Math.min(4, stacks))
    return {
        kills: Math.max(10, 16 - (bounded - 1) * 2),
        amount: 40 + (bounded - 1) * 20,
        capacity: 120 + (bounded - 1) * 60
    }
}

/** Pocket Singularity: time-based, so a slow mortar and an 18-shot carbine get the same black holes. */
export function shapezzBlackHoleStats(stacks: number) {
    const bounded = Math.max(1, Math.min(4, stacks))
    return {
        interval: Math.max(1.8, 4.5 - (bounded - 1) * 0.9),
        radius: 125 + bounded * 18,
        duration: 2.6,
        /** Share of player damage dealt per 0.16s tick inside the core. */
        tickDamage: 0.75
    }
}

/** Overcharge. Crit rolls come from the shared RNG; the chance is capped well under a sure thing. */
export function shapezzCritStats(stacks: number) {
    if (stacks <= 0) return { chance: 0, multiplier: 1 }
    const bounded = Math.min(6, stacks)
    return {
        chance: Math.min(0.5, 0.16 + (bounded - 1) * 0.07),
        multiplier: 2.5 + (bounded - 1) * 0.5
    }
}

/** Prism Lance: one piercing beam on a timer, hitting everything on the line. */
export function shapezzPrismLanceStats(stacks: number) {
    const bounded = Math.max(1, Math.min(4, stacks))
    return {
        interval: Math.max(2, 3.5 - (bounded - 1) * 0.5),
        damageMultiplier: 9 + (bounded - 1) * 3,
        width: 26 + bounded * 6
    }
}

/** Hypervelocity damage bonus; speed is `1.5 ^ stacks` in the engine. */
export function shapezzHyperVelocityDamage(stacks: number) {
    return 1 + Math.min(4, Math.max(0, stacks)) * 0.25
}

export function shapezzExecutionThreshold(stacks: number) {
    if (stacks <= 0) return 0
    return Math.min(0.3, 0.18 + (stacks - 1) * 0.03)
}

export function shapezzKillShockwaveStats(stacks: number) {
    const bounded = Math.max(1, Math.min(6, stacks))
    return {
        kills: Math.max(6, 14 - bounded * 2),
        radius: 180 + bounded * 35,
        damageMultiplier: 2 + bounded * 0.6
    }
}

export function shapezzOverkillDividendStats(stacks: number) {
    const bounded = Math.max(1, Math.min(5, stacks))
    return {
        radius: 80 + bounded * 15,
        conversion: 0.4 + bounded * 0.1,
        damageCapMultiplier: 3 + bounded * 0.6
    }
}

export function shapezzRunUpgrade(id: ShapezzRunUpgradeId) {
    return SHAPEZZ_RUN_UPGRADES.find(upgrade => upgrade.id === id)!
}

export function shapezzCheckpointCount(elapsedMs: number) {
    return Math.max(0, Math.floor(elapsedMs / SHAPEZZ_CHECKPOINT_MS))
}

/** Every accepted mutation also mutates the arena; checkpoint 8 is a wall and 12+ is intentionally terminal. */
export function shapezzCheckpointPressure(checkpoint: number) {
    const acceptedUpgrades = Math.max(0, Math.floor(checkpoint))
    return {
        health: Math.pow(1.16, acceptedUpgrades) * Math.pow(1.032, acceptedUpgrades * acceptedUpgrades),
        damage: Math.pow(1.055, acceptedUpgrades) * (1 + Math.max(0, acceptedUpgrades - 4) * 0.35),
        population: Math.min(2.2, 1 + acceptedUpgrades * 0.08),
        reward: Math.min(3, 0.2 + acceptedUpgrades * 0.18)
    }
}

/** Coin value carried by one enemy. Later mutations increase both this value and enemy density. */
export function shapezzEnemyCoinValue(baseReward: number, elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const checkpoint = shapezzCheckpointCount(elapsedMs)
    const pressure = shapezzCheckpointPressure(checkpoint)
    const difficulty = shapezzDifficulty(difficultyId)
    const minutes = Math.max(0, elapsedMs) / 60_000
    return Math.max(1, Math.round(
        Math.max(0, baseReward)
        * SHAPEZZ_COIN_PAYOUT_SCALE
        * difficulty.reward
        * pressure.reward
        * (1 + minutes * 0.025)
    ))
}

export function shapezzIntensity(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const minutes = Math.max(0, elapsedMs) / 60_000
    const difficulty = shapezzDifficulty(difficultyId)
    const openingRamp = 0.58 + Math.min(1, minutes / 0.75) * 0.42
    return difficulty.spawnRate * openingRamp * (1 + minutes * 0.24 + Math.pow(minutes, 1.35) * 0.075)
}

/** Enemy durability grows faster on high selected difficulties, where late builds otherwise erase the board. */
export function shapezzEnemyHealthMultiplier(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const minutes = Math.max(0, elapsedMs) / 60_000
    const tier = Math.max(0, SHAPEZZ_DIFFICULTY_IDS.indexOf(difficultyId))
    const baselineRamp = 1 + minutes * 0.24 + Math.pow(minutes, 1.3) * 0.075
    const highDifficultyRamp = Math.max(0, minutes - 0.75) * tier * 0.08
    return shapezzDifficulty(difficultyId).enemyHealth * (baselineRamp + highDifficultyRamp)
}

/** Base headroom for one completed 45-second mutation, before difficulty. */
export const SHAPEZZ_PAYOUT_HEADROOM = 12_800
/**
 * How the ceiling compounds with run length.
 *
 * A run's real coin rate rises faster than its length: every mutation adds
 * enemy value *and* enemy density, and the build that survives to take them is
 * killing faster too. A quadratic ceiling therefore drifts below honest play on
 * a long run and clipped real cashouts on the low difficulties, where a strong
 * build survives longest. At 2.4 the ceiling tracks the earning curve instead
 * of crossing it, which also makes it tighter than the old one on the short
 * runs a forged total is most likely to claim.
 */
export const SHAPEZZ_PAYOUT_EXPONENT = 2.4

/**
 * Server-side anti-cheat ceiling, tuned so honest play brushes against it only on excellent runs.
 * Target economy: a fresh account on Spark/Surge banks roughly 1-10k per run; a maxed workshop on
 * a long, clean run reaches 1-2M, which is the site-wide top band for a settled run.
 */
export function shapezzMaxPayoutForRun(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const boundedElapsedMs = Math.max(0, Math.min(elapsedMs, 24 * 60 * 60 * 1000))
    const roundProgress = boundedElapsedMs / SHAPEZZ_CHECKPOINT_MS
    const difficulty = shapezzDifficulty(difficultyId)
    return Math.floor(
        SHAPEZZ_PAYOUT_HEADROOM
        * Math.pow(roundProgress, SHAPEZZ_PAYOUT_EXPONENT)
        * difficulty.reward
    )
}

/**
 * The amount a completed run can actually bank. Keep this shared so the live
 * offer shown by the client uses the exact same ceiling as server settlement.
 */
export function shapezzPayoutForRun(coins: number, elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const collectedCoins = Math.max(0, Math.floor(Number.isFinite(coins) ? coins : 0))
    return Math.min(collectedCoins, shapezzMaxPayoutForRun(elapsedMs, difficultyId))
}

/** Arena recharge after a settled run (cashout or defeat) — abandoned runs never trigger it. */
export const SHAPEZZ_RUN_COOLDOWN_MS = 2 * 60 * 60 * 1000
export const SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM = 10 * 60 * 1000

export function shapezzRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number) {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + SHAPEZZ_RUN_COOLDOWN_MS - now)
}

/** One gem clears each started ten-minute block of arena recharge time. */
export function shapezzCooldownRushCost(remainingMs: number) {
    return Math.max(0, Math.ceil(Math.max(0, remainingMs) / SHAPEZZ_COOLDOWN_RUSH_MS_PER_GEM))
}

/** Arena bounds, mirrored from app/utils/shapezz/world.ts. */
const ARENA_WIDTH = 1280
const ARENA_FLOOR_Y = 662
/** A bare account's jump peaks about 227px up; ledges stay a comfortable step below that. */
const PLATFORM_MAX_STEP = 185
const PLATFORM_MIN_STEP = 105
/** Nothing above this line: snipers and boss attacks live up there. */
const PLATFORM_TOP_Y = 235

export interface ShapezzPlatformLayout {
    x: number
    y: number
    width: number
    height: number
}

/**
 * A fresh set of elevated ledges for one run (the floor is not included). One "generosity" roll sets the
 * mood, so some arenas get more and wider ledges and others only a couple of narrow ones. Every ledge can be
 * reached with a bare account's jump: each one sits one step above the floor or above a ledge it overlaps.
 */
export function shapezzRollPlatforms(rng: () => number = randomFloat): ShapezzPlatformLayout[] {
    const generosity = rng()
    const count = Math.max(2, Math.min(7, Math.round(2 + generosity * 4 + (rng() - 0.5) * 2)))
    const platforms: ShapezzPlatformLayout[] = []
    for (let attempt = 0; platforms.length < count && attempt < count * 40; attempt++) {
        const width = Math.round(120 + generosity * 110 + rng() * 90)
        // Stand on the floor or on a ledge already placed, then step up from it.
        const supports = [{ x: 0, y: ARENA_FLOOR_Y, width: ARENA_WIDTH, height: 0 }, ...platforms]
        const support = supports[Math.floor(rng() * supports.length)]!
        const y = Math.round(support.y - PLATFORM_MIN_STEP - rng() * (PLATFORM_MAX_STEP - PLATFORM_MIN_STEP))
        if (y < PLATFORM_TOP_Y) continue
        // Overlap the support by at least 60px so the jump up is a straight hop.
        const minX = Math.max(30, support.x + 60 - width)
        const maxX = Math.min(ARENA_WIDTH - 30 - width, support.x + support.width - 60)
        if (maxX < minX) continue
        const x = Math.round(minX + rng() * (maxX - minX))
        const crowded = platforms.some(other => Math.abs(other.y - y) < 95
            && x < other.x + other.width + 70 && other.x < x + width + 70)
        if (crowded) continue
        platforms.push({ x, y, width, height: y < 380 ? 16 : 18 })
    }
    return platforms.sort((a, b) => b.y - a.y)
}

