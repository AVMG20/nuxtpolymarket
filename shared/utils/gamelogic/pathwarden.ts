export const PATHWARDEN_BOOST_IDS = ['bulwark', 'artificer', 'lens', 'reservoir', 'banner', 'bounty'] as const
export type PathwardenBoostId = typeof PATHWARDEN_BOOST_IDS[number]
export type PathwardenBoostCurrency = 'coins' | 'gems'
export type PathwardenBoostLevels = Record<PathwardenBoostId, number>
export const PATHWARDEN_CHECKPOINT_WAVES = [4, 8, 12] as const
export const PATHWARDEN_SURGE_COST_GEMS = 5

export type PathwardenDefenseArchetype = 'ballista' | 'mortar' | 'spire'
export type PathwardenDefenseFamily = 'star' | 'sun' | 'winter' | 'ember' | 'storm' | 'dawn' | 'venom' | 'gale' | 'prism' | 'siege'

export interface PathwardenDefenseBlueprint {
    id: string
    name: string
    coinCost: number
    aetherCost: number
    description: string
    archetype: PathwardenDefenseArchetype
    family: PathwardenDefenseFamily
    tier: number
    damage: number
    range: number
    rate: number
    projectileSpeed: number
    splash: number
    slow: number
    color: string
}

const DEFENSE_FAMILIES: Array<{
    id: PathwardenDefenseFamily
    names: [string, string, string, string, string]
    archetype: PathwardenDefenseArchetype
    description: string
    color: string
    damage: number
    range: number
    rate: number
    projectileSpeed: number
    splash: number
    slow: number
}> = [
    { id: 'star', names: ['Star Ballista', 'Comet Repeater', 'Astral Arbalest', 'Celestial Scorpion', 'Heavenpiercer'], archetype: 'ballista', description: 'Precise rapid bolts excel against priority targets.', color: '#67e8f9', damage: 25, range: 205, rate: 0.58, projectileSpeed: 720, splash: 0, slow: 0 },
    { id: 'sun', names: ['Sun Mortar', 'Solar Bombard', 'Helios Howitzer', 'Daystar Cannon', 'Noonfall Engine'], archetype: 'mortar', description: 'High arcing shells burst across packed formations.', color: '#fbbf24', damage: 48, range: 245, rate: 1.55, projectileSpeed: 430, splash: 82, slow: 0 },
    { id: 'winter', names: ['Winter Spire', 'Rime Monolith', 'Glacier Beacon', 'Permafrost Crown', 'Whiteout Sanctum'], archetype: 'spire', description: 'Frosts nearby ground and slows everything in its reach.', color: '#c4b5fd', damage: 11, range: 178, rate: 0.72, projectileSpeed: 560, splash: 0, slow: 0.46 },
    { id: 'ember', names: ['Ember Bastion', 'Cinder Redoubt', 'Furnace Keep', 'Caldera Citadel', 'Worldfire Bastion'], archetype: 'mortar', description: 'Burning siege shells punish durable enemies.', color: '#fb7185', damage: 33, range: 218, rate: 1.05, projectileSpeed: 470, splash: 42, slow: 0 },
    { id: 'storm', names: ['Tempest Obelisk', 'Thunder Pylon', 'Stormcall Needle', 'Skybreaker Coil', 'Godspark Obelisk'], archetype: 'ballista', description: 'Charged shots arc through clustered hordes.', color: '#fde047', damage: 20, range: 230, rate: 0.82, projectileSpeed: 760, splash: 0, slow: 0 },
    { id: 'dawn', names: ['Dawn Chapel', 'Aurora Shrine', 'Radiant Basilica', 'Seraphic Lantern', 'Firstlight Cathedral'], archetype: 'spire', description: 'Measured radiant pulses cleanse broad formations.', color: '#fef3c7', damage: 39, range: 205, rate: 1.32, projectileSpeed: 520, splash: 66, slow: 0 },
    { id: 'venom', names: ['Briar Slinger', 'Adder Nest', 'Nightshade Bowery', 'Basilisk Roost', 'Widowmaker Grove'], archetype: 'ballista', description: 'Fast venomous darts wear down armored prey.', color: '#86efac', damage: 18, range: 198, rate: 0.48, projectileSpeed: 690, splash: 0, slow: 0.1 },
    { id: 'gale', names: ['Gale Fan', 'Zephyr Mill', 'Cyclone Turret', 'Hurricane Loom', 'Worldwind Engine'], archetype: 'spire', description: 'Wind bursts control swift enemies with relentless fire.', color: '#99f6e4', damage: 15, range: 190, rate: 0.42, projectileSpeed: 640, splash: 28, slow: 0.16 },
    { id: 'prism', names: ['Prism Ward', 'Glasslight Lens', 'Spectrum Tower', 'Aurora Array', 'Thousand-Ray Prism'], archetype: 'spire', description: 'Focused light reaches distant lanes and pierces armor.', color: '#f0abfc', damage: 31, range: 260, rate: 1.08, projectileSpeed: 820, splash: 20, slow: 0 },
    { id: 'siege', names: ['Iron Bombard', 'Castle Cracker', 'Titan Culverin', 'Kingfall Cannon', 'Dreadnought Battery'], archetype: 'mortar', description: 'Slow colossal shells deliver unmatched impact damage.', color: '#fdba74', damage: 68, range: 225, rate: 1.9, projectileSpeed: 390, splash: 64, slow: 0 }
]

const STARTER_IDS = new Set(['bolt', 'mortar', 'frost'])
const FIRST_IDS: Record<PathwardenDefenseFamily, string> = {
    star: 'bolt',
    sun: 'mortar',
    winter: 'frost',
    ember: 'ember',
    storm: 'storm',
    dawn: 'radiant',
    venom: 'venom',
    gale: 'gale',
    prism: 'prism',
    siege: 'siege'
}

/** Fifty distinct defenses: ten tactical families with five increasingly prestigious tiers. */
export const PATHWARDEN_DEFENSE_BLUEPRINTS: PathwardenDefenseBlueprint[] = DEFENSE_FAMILIES.flatMap((family, familyIndex) =>
    family.names.map((name, tierIndex) => {
        const tier = tierIndex + 1
        const id = tier === 1 ? FIRST_IDS[family.id] : `${family.id}-${tier}`
        const coinExponent = familyIndex + tierIndex * DEFENSE_FAMILIES.length
        const coinCost = STARTER_IDS.has(id) ? 0 : Math.round(75_000 * Math.pow(1.43, coinExponent))
        const power = 1 + tierIndex * 0.28
        return {
            id,
            name,
            coinCost,
            aetherCost: Math.round((48 + family.damage * 0.9 + family.splash * 0.18) * (1 + tierIndex * 0.14)),
            description: family.description,
            archetype: family.archetype,
            family: family.id,
            tier,
            damage: Math.round(family.damage * power),
            range: Math.round(family.range * (1 + tierIndex * 0.045)),
            rate: Number((family.rate / (1 + tierIndex * 0.08)).toFixed(3)),
            projectileSpeed: Math.round(family.projectileSpeed * (1 + tierIndex * 0.04)),
            splash: Math.round(family.splash * (1 + tierIndex * 0.12)),
            slow: Math.min(0.62, Number((family.slow * (1 + tierIndex * 0.08)).toFixed(3))),
            color: family.color
        }
    })
)

export type PathwardenDefenseId = string

export const PATHWARDEN_SKINS = [
    { id: 'warden-stone', name: 'Warden Stone', gemCost: 0, description: 'The traditional slate-and-cyan Warden livery.', palette: 'slate' },
    { id: 'ember-court', name: 'Ember Court', gemCost: 50, description: 'Black iron, crimson roofs, and furnace banners.', palette: 'ember' },
    { id: 'verdant-crown', name: 'Verdant Crown', gemCost: 250, description: 'Jade roofs and gold trim for prosperous Wardens.', palette: 'verdant' },
    { id: 'royal-amethyst', name: 'Royal Amethyst', gemCost: 1_000, description: 'Violet crystal roofs with silver battlements.', palette: 'amethyst' },
    { id: 'sun-king', name: 'Sun-King Citadel', gemCost: 10_000, description: 'An unapologetic gold-and-sapphire bragging right.', palette: 'sun' }
] as const

export type PathwardenSkinId = typeof PATHWARDEN_SKINS[number]['id']

export const PATHWARDEN_RUN_COOLDOWN_MS = 2 * 60 * 60 * 1000
export const PATHWARDEN_COOLDOWN_RUSH_MS_PER_GEM = 10 * 60 * 1000

export function pathwardenRunCooldownRemainingMs(lastRunFinishedAt: Date | null, now: number) {
    if (!lastRunFinishedAt) return 0
    return Math.max(0, lastRunFinishedAt.getTime() + PATHWARDEN_RUN_COOLDOWN_MS - now)
}

export function pathwardenCooldownRushCost(remainingMs: number) {
    return Math.max(0, Math.ceil(Math.max(0, remainingMs) / PATHWARDEN_COOLDOWN_RUSH_MS_PER_GEM))
}

export const PATHWARDEN_BOOSTS: Record<PathwardenBoostId, {
    name: string
    description: string
    currency: PathwardenBoostCurrency
    baseCost: number
    maxLevel: number
    sprite: { col: number, row: number }
}> = {
    bulwark: {
        name: 'Warden Bulwark',
        description: 'Reinforce the keep with more starting hearts.',
        currency: 'coins',
        baseCost: 24_000,
        maxLevel: 20,
        sprite: { col: 0, row: 0 }
    },
    artificer: {
        name: 'Master Artificer',
        description: '+3% damage for every defense per level.',
        currency: 'coins',
        baseCost: 32_000,
        maxLevel: 20,
        sprite: { col: 1, row: 0 }
    },
    lens: {
        name: 'Mistglass Lens',
        description: '+3% tower range per level.',
        currency: 'gems',
        baseCost: 3,
        maxLevel: 10,
        sprite: { col: 2, row: 0 }
    },
    reservoir: {
        name: 'Aether Reservoir',
        description: '+15 starting Aether per level.',
        currency: 'gems',
        baseCost: 4,
        maxLevel: 10,
        sprite: { col: 0, row: 1 }
    },
    banner: {
        name: 'Banner of Resolve',
        description: '+2% attack speed and occasional starting hearts.',
        currency: 'coins',
        baseCost: 36_000,
        maxLevel: 20,
        sprite: { col: 1, row: 1 }
    },
    bounty: {
        name: 'Verdant Bounty',
        description: '+3% Aether from defeated enemies per level.',
        currency: 'gems',
        baseCost: 5,
        maxLevel: 10,
        sprite: { col: 2, row: 1 }
    }
}

export function pathwardenBoostCost(id: PathwardenBoostId, level: number) {
    const boost = PATHWARDEN_BOOSTS[id]
    if (level >= boost.maxLevel) return null
    if (boost.currency === 'gems') return Math.ceil(boost.baseCost * Math.pow(1.72, level))
    if (level < 10) return Math.round(boost.baseCost * Math.pow(2, level))
    return Math.round(boost.baseCost * 10_000 * Math.pow(1.8, level - 10))
}

export function pathwardenBoostEffects(levels: PathwardenBoostLevels, surged = false) {
    const surge = surged ? 1.1 : 1
    return {
        startingLives: 20 + Math.ceil(levels.bulwark * 0.75) + Math.floor(levels.banner * 0.25),
        startingAether: Math.round((205 + levels.reservoir * 15) * (surged ? 1.25 : 1)),
        damageMultiplier: (1 + levels.artificer * 0.03) * surge,
        rangeMultiplier: 1 + levels.lens * 0.03,
        rateMultiplier: (1 + levels.banner * 0.02) * (surged ? 1.05 : 1),
        bountyMultiplier: 1 + levels.bounty * 0.03
    }
}

export function pathwardenPower(levels: PathwardenBoostLevels) {
    return 10
        + levels.bulwark * 3
        + levels.artificer * 5
        + levels.lens * 4
        + levels.reservoir * 3
        + levels.banner * 4
        + levels.bounty * 3
}

export function pathwardenCheckpointRate(wave: number, realm: number) {
    const checkpoint = wave >= 12 ? 3 : wave >= 8 ? 2 : wave >= 4 ? 1 : 0
    if (!checkpoint) return 0
    const base = [0, 45, 180, 600][checkpoint]!
    return Math.round(base * (1 + (Math.max(1, realm) - 1) * 0.35))
}

export function pathwardenCheckpointBaseCoins(wave: number, realm: number) {
    const checkpoint = wave >= 12 ? 3 : wave >= 8 ? 2 : wave >= 4 ? 1 : 0
    if (!checkpoint) return 0
    const base = [0, 4_000, 25_000, 125_000][checkpoint]!
    return Math.round(base * (1 + (Math.max(1, realm) - 1) * 0.5))
}

export function pathwardenCashoutCoins(aether: number, wave: number, realm: number) {
    const boundedAether = Math.max(0, Math.floor(Number.isFinite(aether) ? aether : 0))
    return pathwardenCheckpointBaseCoins(wave, realm) + boundedAether * pathwardenCheckpointRate(wave, realm)
}

/** Client reports are capped generously; debug Aether can never become real coins. */
export function pathwardenMaxAetherAtCheckpoint(wave: number, levels: PathwardenBoostLevels, surged = false) {
    const effects = pathwardenBoostEffects(levels, surged)
    const boundedWave = Math.max(0, Math.min(12, Math.floor(wave)))
    const killHeadroom = boundedWave * (55 + boundedWave * 14) * effects.bountyMultiplier
    return Math.ceil(effects.startingAether + killHeadroom + boundedWave * 90)
}
