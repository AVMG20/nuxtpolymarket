export const SHAPEZZ_CHECKPOINT_MS = 45_000
export const SHAPEZZ_MAX_PERMANENT_LEVEL = 20
export const SHAPEZZ_MAX_KILL_HEAL_LEVEL = 4
export const SHAPEZZ_WEAPON_REFUND_RATE = 0.25

export const SHAPEZZ_COMBAT_LIMITS = {
    enemies: 100,
    bullets: 520,
    particles: 700,
    damageTexts: 120,
    shockwaves: 90,
    beams: 100,
    pickups: 260,
    turrets: 12,
    singularities: 4
} as const

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
    { id: 'surge', name: 'Surge', tagline: 'The intended first run', enemyHealth: 1.1, enemyDamage: 1, enemySpeed: 1, spawnRate: 1, reward: 1, color: '#a3e635' },
    { id: 'overdrive', name: 'Overdrive', tagline: 'Crowds become a flood', enemyHealth: 2.15, enemyDamage: 1.45, enemySpeed: 1.12, spawnRate: 1.2, reward: 2.2, color: '#fbbf24' },
    { id: 'mayhem', name: 'Mayhem', tagline: 'Bosses stop taking turns', enemyHealth: 3.7, enemyDamage: 2.1, enemySpeed: 1.25, spawnRate: 1.42, reward: 3.6, color: '#fb7185' },
    { id: 'annihilation', name: 'Annihilation', tagline: 'The screen is the enemy', enemyHealth: 6.2, enemyDamage: 3, enemySpeed: 1.4, spawnRate: 1.62, reward: 5.5, color: '#e879f9' }
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

export const SHAPEZZ_WEAPON_TYPES = ['blaster', 'launcher', 'shotgun'] as const
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
    prices: Record<ShapezzWeaponRarity, number>
}> = {
    blaster: {
        name: 'Pulse Carbine', description: 'Fast, precise and dependable. One shot goes exactly where you point it.', icon: 'i-lucide-crosshair',
        damage: 1, fireRate: 1, speed: 1, size: 1, pellets: 1, spread: 0, explosionRadius: 0, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1,
        prices: { common: 0, rare: 20_000, epic: 300_000, legendary: 4_000_000, mythic: 36_000_000 }
    },
    launcher: {
        name: 'Nova Mortar', description: 'Slow, oversized plasma shells that turn every impact into an explosion.', icon: 'i-lucide-bomb',
        damage: 2.4, fireRate: 0.24, speed: 0.72, size: 1.65, pellets: 1, spread: 0, explosionRadius: 80, falloffStart: 9999, falloffEnd: 10_000, minFalloffDamage: 1,
        prices: { common: 12_000, rare: 75_000, epic: 800_000, legendary: 8_000_000, mythic: 50_000_000 }
    },
    shotgun: {
        name: 'Scatter Array', description: 'A violent wall of pellets. Devastating up close, rapidly weaker at range.', icon: 'i-lucide-chevrons-right',
        damage: 0.34, fireRate: 0.46, speed: 0.9, size: 0.74, pellets: 7, spread: 0.3, explosionRadius: 0, falloffStart: 80, falloffEnd: 340, minFalloffDamage: 0.05,
        prices: { common: 8_000, rare: 50_000, epic: 600_000, legendary: 6_000_000, mythic: 45_000_000 }
    }
}

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
        power: rank * 18 + (weaponType === 'launcher' ? 8 : weaponType === 'shotgun' ? 5 : 0),
        damageMultiplier: typeMeta.damage * rarityMeta.damage,
        fireRateMultiplier: typeMeta.fireRate * rarityMeta.fireRate,
        projectileSpeedMultiplier: typeMeta.speed * rarityMeta.speed,
        projectileSizeMultiplier: typeMeta.size * rarityMeta.size,
        pellets: typeMeta.pellets + (weaponType === 'shotgun' ? rank : 0),
        spread: typeMeta.spread + (weaponType === 'shotgun' ? rank * 0.015 : 0),
        explosionRadius: typeMeta.explosionRadius > 0 ? typeMeta.explosionRadius + rank * 14 : 0,
        falloffStart: typeMeta.falloffStart,
        falloffEnd: typeMeta.falloffEnd,
        minFalloffDamage: typeMeta.minFalloffDamage,
        primaryColor: rarityMeta.primaryColor,
        accentColor: rarityMeta.accentColor,
        visualIntensity: rank + 1
    }
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

export function shapezzPermanentUpgradeCost(id: ShapezzPermanentUpgradeId, level: number) {
    if (level >= SHAPEZZ_PERMANENT_UPGRADES[id].maxLevel) return null
    if (id === 'killHeal') return [250_000, 1_250_000, 7_500_000, 30_000_000][level] ?? null
    const base = { core: 30_000, overclock: 32_000, armor: 24_000, thrusters: 28_000, magnet: 20_000 }[id]
    if (level < 10) return Math.round(base * Math.pow(2, level))
    return Math.round(base * 700 * Math.pow(1.35, level - 10))
}

export function shapezzPlayerStats(levels: ShapezzPermanentLevels) {
    return {
        maxHp: 120 + levels.armor * 18,
        damage: 18 + levels.core * 3.2,
        fireRate: 5.5 + levels.overclock * 0.24,
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
    'afterimage', 'deathNova', 'frenzy', 'hyperVelocity'
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
    { id: 'railPierce', name: 'INFINITE RAIL', description: 'Shots punch through 3 additional enemies.', stackText: '+3 pierce per stack', icon: 'i-lucide-move-right', rarity: 'wild', accent: '#67e8f9' },
    { id: 'ricochet', name: 'PINBALL MURDER', description: 'Shots bounce twice and retarget nearby shapes.', stackText: '+2 bounces per stack', icon: 'i-lucide-zap', rarity: 'unstable', accent: '#fde047' },
    { id: 'explosive', name: 'EVERYTHING EXPLODES', description: 'Bullet impacts detonate an area blast.', stackText: 'Larger, harder blasts', icon: 'i-lucide-bomb', rarity: 'cataclysmic', accent: '#fb7185' },
    { id: 'chainLightning', name: 'CHAIN REACTION', description: 'Hits arc lightning through 3 nearby enemies.', stackText: '+2 chain targets', icon: 'i-lucide-radio-tower', rarity: 'cataclysmic', accent: '#c4b5fd' },
    { id: 'orbitals', name: 'ORBITAL ARMORY', description: 'Gain 2 orbiting guns that fire independently.', stackText: '+2 orbital guns', icon: 'i-lucide-orbit', rarity: 'cataclysmic', accent: '#f0abfc' },
    { id: 'droneSwarm', name: 'DRONE SWARM', description: 'Deploy 2 hunter drones with rapid lasers.', stackText: '+2 drones', icon: 'i-lucide-bot', rarity: 'unstable', accent: '#34d399' },
    { id: 'blackHole', name: 'POCKET SINGULARITY', description: 'Every 14th shot creates a crushing black hole.', stackText: 'Triggers 3 shots sooner', icon: 'i-lucide-circle-dot', rarity: 'cataclysmic', accent: '#e879f9' },
    { id: 'bulletTime', name: 'PANIC FIELD', description: 'Enemy projectiles crawl when they get close.', stackText: 'Slower hostile bullets', icon: 'i-lucide-clock-3', rarity: 'wild', accent: '#60a5fa' },
    { id: 'giantRounds', name: 'ABSURD CALIBER', description: 'Projectiles become 70% larger and hit much harder.', stackText: '+70% size, +35% damage', icon: 'i-lucide-maximize-2', rarity: 'unstable', accent: '#fb923c' },
    { id: 'vampireBurst', name: 'BLOOD CIRCUIT', description: 'Every 20 kills restores 25% max health.', stackText: 'Triggers 4 kills sooner', icon: 'i-lucide-heart-pulse', rarity: 'wild', accent: '#f43f5e' },
    { id: 'afterimage', name: 'AFTERIMAGE TURRETS', description: 'Jumping leaves a temporary auto-firing turret.', stackText: '+1 turret per jump', icon: 'i-lucide-copy', rarity: 'unstable', accent: '#2dd4bf' },
    { id: 'deathNova', name: 'CORPSE NOVA', description: 'Dead enemies fire a 12-shot radial burst for you.', stackText: '+6 nova shots', icon: 'i-lucide-sun', rarity: 'cataclysmic', accent: '#facc15' },
    { id: 'frenzy', name: 'NO BRAKES', description: 'Fire rate doubles while your combo is alive.', stackText: '+35% frenzy fire rate', icon: 'i-lucide-flame', rarity: 'unstable', accent: '#f97316' },
    { id: 'hyperVelocity', name: 'HYPERVELOCITY', description: 'Projectiles move 50% faster and leave damaging trails.', stackText: '+50% speed, hotter trails', icon: 'i-lucide-chevrons-right', rarity: 'wild', accent: '#38bdf8' }
]

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
        health: Math.pow(1.28, acceptedUpgrades),
        damage: Math.pow(1.055, acceptedUpgrades),
        population: Math.min(1.7, 1 + acceptedUpgrades * 0.045),
        reward: 1 + acceptedUpgrades * 0.12
    }
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
    const baselineRamp = 1 + minutes * 0.3 + Math.pow(minutes, 1.3) * 0.075
    const highDifficultyRamp = Math.max(0, minutes - 0.75) * tier * 0.11
    return shapezzDifficulty(difficultyId).enemyHealth * (baselineRamp + highDifficultyRamp)
}

/**
 * Server-side anti-cheat ceiling, tuned so honest play brushes against it only on excellent runs.
 * Target economy: a fresh account on Spark/Surge banks roughly 1-10k per run; a maxed build on
 * Annihilation reaches ~1M+ on a long, clean run.
 */
export function shapezzMaxPayoutForRun(elapsedMs: number, difficultyId: ShapezzDifficultyId) {
    const seconds = Math.max(0, Math.min(elapsedMs, 24 * 60 * 60 * 1000)) / 1000
    const minutes = seconds / 60
    const difficulty = shapezzDifficulty(difficultyId)
    const checkpointReward = shapezzCheckpointPressure(shapezzCheckpointCount(elapsedMs)).reward
    return Math.floor(seconds * 55 * difficulty.reward * checkpointReward * (1 + minutes * 0.17))
}

/** Arena recharge after a settled run (cashout or defeat) — abandoned runs never trigger it. */
export const SHAPEZZ_RUN_COOLDOWN_MS = 2 * 60 * 60 * 1000

export function shapezzRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number) {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + SHAPEZZ_RUN_COOLDOWN_MS - now)
}
