import { randomFloat, randomInt, randomWeighted } from '../random'

// ─── Void Runner ────────────────────────────────────────────────────────────
//
// An extraction miner. You undock from the mothership at the centre of the
// sector, mine rocks and kill patrols for resources, and fly back to the
// mothership to bank what you're carrying. Everything you're holding when you
// die is lost, so the whole run is a "one more rock" pressure test — and the
// ion storm that closes in from the edges at five minutes makes that decision
// for you eventually.

export const VOID_STORM_START_MS = 5 * 60 * 1000
/** By this point the storm has swallowed the entire sector, mothership included. */
export const VOID_STORM_FULL_MS = 8 * 60 * 1000
/** Hard ceiling. Anyone still out here has already been in the gas for a minute. */
export const VOID_RUN_DURATION_MS = 9 * 60 * 1000

/** Storm damage per second at full depth, as a fraction of the player's max hull. */
export const VOID_STORM_DPS_FRACTION = 0.085
/** Enemies breathe the same gas, but they only take a quarter of it. */
export const VOID_STORM_ENEMY_MULT = 0.25

export const VOID_DOCK_RADIUS = 190
export const VOID_EXTRACT_HOLD_MS = 1200

// ─── Resources ──────────────────────────────────────────────────────────────

export type VoidResourceId = 'ferrite' | 'cobalt' | 'iridium' | 'xenite' | 'scrap' | 'circuitry' | 'warpCore'

export interface VoidResourceDefinition {
    id: VoidResourceId
    name: string
    /** `ore` comes out of rocks and buys hull/shield/cargo/hulls; `salvage` drops off kills and buys guns and engines. */
    kind: 'ore' | 'salvage'
    color: number
    icon: string
    description: string
}

export const VOID_RESOURCES = [
    { id: 'ferrite', name: 'Ferrite', kind: 'ore', color: 0x9aa6b2, icon: 'i-lucide-hexagon', description: 'Dull grey structural ore. The backbone of every hull plate ever pressed.' },
    { id: 'cobalt', name: 'Cobalt', kind: 'ore', color: 0x4f8ff7, icon: 'i-lucide-diamond', description: 'Deep blue crystal that holds a shield lattice together.' },
    { id: 'iridium', name: 'Iridium', kind: 'ore', color: 0xc084fc, icon: 'i-lucide-gem', description: 'Violet superdense ore. Slow to cut, worth the exposure.' },
    { id: 'xenite', name: 'Xenite', kind: 'ore', color: 0x34d399, icon: 'i-lucide-atom', description: 'Living green ore that hums when the laser touches it. Only the deep sectors have it.' },
    { id: 'scrap', name: 'Scrap', kind: 'salvage', color: 0xf59e0b, icon: 'i-lucide-wrench', description: 'Torn hull plate off dead patrols. Feeds engines, guns and reload gear.' },
    { id: 'circuitry', name: 'Circuitry', kind: 'salvage', color: 0x22d3ee, icon: 'i-lucide-cpu', description: 'Intact targeting boards pulled from heavier wrecks.' },
    { id: 'warpCore', name: 'Warp Core', kind: 'salvage', color: 0xf472b6, icon: 'i-lucide-zap', description: 'A still-warm drive core. Only capital ships carry one.' }
] as const satisfies readonly VoidResourceDefinition[]

export const VOID_RESOURCE_IDS = VOID_RESOURCES.map(r => r.id)

export type VoidResourceBundle = Partial<Record<VoidResourceId, number>>

export function voidResource(id: string) {
    return VOID_RESOURCES.find(r => r.id === id) ?? VOID_RESOURCES[0]
}

/** Total units in a bundle — cargo hold capacity counts every resource the same. */
export function voidBundleUnits(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.reduce((sum, id) => sum + Math.max(0, Math.floor(bundle[id] ?? 0)), 0)
}

export function voidAddBundles(a: VoidResourceBundle, b: VoidResourceBundle): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const total = Math.max(0, Math.floor(a[id] ?? 0)) + Math.max(0, Math.floor(b[id] ?? 0))
        if (total > 0) out[id] = total
    }
    return out
}

export function voidCanAfford(held: VoidResourceBundle, cost: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.every(id => (held[id] ?? 0) >= (cost[id] ?? 0))
}

export function voidSubtractBundle(held: VoidResourceBundle, cost: VoidResourceBundle): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const left = Math.max(0, Math.floor(held[id] ?? 0)) - Math.max(0, Math.floor(cost[id] ?? 0))
        if (left > 0) out[id] = left
    }
    return out
}

// ─── Sectors ────────────────────────────────────────────────────────────────

export interface VoidSectorDefinition {
    tier: number
    name: string
    description: string
    color: number
    accent: string
    /** Enemy hp/damage/speed multiplier. */
    threat: number
    /** How many patrols are alive at once at the start of a run. */
    baseEnemies: number
    maxEnemies: number
    spawnIntervalMs: number
    rockCountMin: number
    rockCountMax: number
    /** Credits and resource drops scale with this. */
    reward: number
    /** Ore in this sector takes this much longer to cut. */
    mineTimeMult: number
    bossFirstSpawnMs: number
    /** Power level the hangar wants to see before it stops calling this a bad idea. */
    recommendedPower: number
}

export const VOID_SECTORS = [
    {
        tier: 1,
        name: 'Halcyon Drift',
        description: 'A picked-over ferrite field on the edge of charted space. Thin patrols, forgiving rocks.',
        color: 0x38bdf8,
        accent: 'info',
        threat: 1,
        baseEnemies: 5,
        maxEnemies: 11,
        spawnIntervalMs: 9000,
        rockCountMin: 26,
        rockCountMax: 34,
        reward: 1,
        mineTimeMult: 1,
        bossFirstSpawnMs: 150_000,
        recommendedPower: 0
    },
    {
        tier: 2,
        name: 'Cinder Reach',
        description: 'Wrecks of an old mining war. Cobalt is common, and so is the patrol that wants it back.',
        color: 0xf59e0b,
        accent: 'warning',
        threat: 1.85,
        baseEnemies: 7,
        maxEnemies: 15,
        spawnIntervalMs: 7200,
        rockCountMin: 24,
        rockCountMax: 32,
        reward: 2.4,
        mineTimeMult: 1.15,
        bossFirstSpawnMs: 125_000,
        recommendedPower: 55
    },
    {
        tier: 3,
        name: 'The Long Dark',
        description: 'No stars, no beacons. Iridium seams and something that hunts by drive signature.',
        color: 0xa855f7,
        accent: 'secondary',
        threat: 3.3,
        baseEnemies: 9,
        maxEnemies: 19,
        spawnIntervalMs: 5800,
        rockCountMin: 22,
        rockCountMax: 30,
        reward: 5.5,
        mineTimeMult: 1.35,
        bossFirstSpawnMs: 100_000,
        recommendedPower: 140
    },
    {
        tier: 4,
        name: 'Xenite Womb',
        description: 'The rocks are warm and they move a little. Nothing that flies out here is friendly.',
        color: 0x34d399,
        accent: 'success',
        threat: 5.6,
        baseEnemies: 11,
        maxEnemies: 24,
        spawnIntervalMs: 4600,
        rockCountMin: 20,
        rockCountMax: 28,
        reward: 12,
        mineTimeMult: 1.6,
        bossFirstSpawnMs: 80_000,
        recommendedPower: 300
    }
] as const satisfies readonly VoidSectorDefinition[]

export const VOID_MAX_SECTOR = VOID_SECTORS.length

export function voidSector(tier: number): VoidSectorDefinition {
    return VOID_SECTORS.find(s => s.tier === tier) ?? VOID_SECTORS[0]
}

/**
 * Sector N unlocks by banking a successful extraction out of sector N-1.
 * `highestSectorExtracted` starts at 0, so tier 1 is open to everyone.
 */
export function voidSectorUnlocked(tier: number, highestSectorExtracted: number) {
    return tier <= 1 || highestSectorExtracted >= tier - 1
}

// ─── Rocks ──────────────────────────────────────────────────────────────────

export interface VoidRockDefinition {
    id: string
    name: string
    resource: VoidResourceId
    color: number
    glow: number
    /** Base seconds of held laser to crack it open, before mining upgrades and sector modifiers. */
    mineMs: number
    yieldMin: number
    yieldMax: number
    radius: number
    /** Spawn weight per sector tier — index 0 is tier 1. A zero means it isn't found there at all. */
    weights: readonly number[]
}

export const VOID_ROCKS = [
    {
        id: 'ferrite-node', name: 'Ferrite Node', resource: 'ferrite',
        color: 0x8c96a3, glow: 0xd7dee6, mineMs: 8000, yieldMin: 3, yieldMax: 7, radius: 34,
        weights: [70, 42, 22, 10]
    },
    {
        id: 'cobalt-seam', name: 'Cobalt Seam', resource: 'cobalt',
        color: 0x2f5fae, glow: 0x7cb6ff, mineMs: 13_000, yieldMin: 2, yieldMax: 5, radius: 38,
        weights: [12, 40, 34, 20]
    },
    {
        id: 'iridium-cluster', name: 'Iridium Cluster', resource: 'iridium',
        color: 0x7c3aed, glow: 0xd8b4fe, mineMs: 19_000, yieldMin: 2, yieldMax: 4, radius: 42,
        weights: [3, 14, 32, 32]
    },
    {
        id: 'xenite-bloom', name: 'Xenite Bloom', resource: 'xenite',
        color: 0x0f766e, glow: 0x5eead4, mineMs: 26_000, yieldMin: 1, yieldMax: 3, radius: 46,
        weights: [0, 2, 12, 38]
    }
] as const satisfies readonly VoidRockDefinition[]

export function voidRock(id: string): VoidRockDefinition {
    return VOID_ROCKS.find(r => r.id === id) ?? VOID_ROCKS[0]
}

export function voidRollRock(tier: number, rng: () => number = randomFloat): VoidRockDefinition {
    const index = Math.max(0, Math.min(3, tier - 1))
    const pool = VOID_ROCKS.filter(rock => rock.weights[index]! > 0)
    return randomWeighted(pool, rock => rock.weights[index]!, rng)
}

// ─── Enemies ────────────────────────────────────────────────────────────────

export type VoidEnemyAbility = 'shockwave' | 'railbeam' | 'reinforce'

export interface VoidEnemyDefinition {
    id: string
    name: string
    description: string
    color: number
    accentColor: number
    radius: number
    hp: number
    speed: number
    /** Damage of a single bolt, before sector threat scaling. */
    damage: number
    fireGapMs: number
    range: number
    /** How far it can notice you. Fly outside this and it goes back to drifting. */
    vision: number
    /** Turn rate in radians per second — heavies swing around slowly enough to kite. */
    turnRate: number
    credits: number
    drops: { resource: VoidResourceId, min: number, max: number, chance?: number }[]
    abilities: readonly VoidEnemyAbility[]
    abilityCooldownMs: number
    /** Relative spawn weight per sector tier — index 0 is tier 1. */
    weights: readonly number[]
    boss?: boolean
}

export const VOID_ENEMIES: readonly VoidEnemyDefinition[] = [
    {
        id: 'interceptor',
        name: 'Interceptor',
        description: 'Standard corporate patrol. Nothing special, and there are always more.',
        color: 0xdc2626, accentColor: 0xfca5a5, radius: 17,
        hp: 58, speed: 152, damage: 8, fireGapMs: 1100, range: 400, vision: 430, turnRate: 2.6,
        credits: 14,
        drops: [{ resource: 'scrap', min: 1, max: 3 }],
        abilities: [], abilityCooldownMs: 0,
        weights: [52, 42, 32, 24]
    },
    {
        id: 'stinger',
        name: 'Stinger',
        description: 'Light hull strapped to an oversized drive. It will close the gap before you finish the thought.',
        color: 0xf97316, accentColor: 0xfed7aa, radius: 13,
        hp: 34, speed: 268, damage: 6, fireGapMs: 700, range: 300, vision: 560, turnRate: 4.4,
        credits: 16,
        drops: [{ resource: 'scrap', min: 1, max: 3 }],
        abilities: [], abilityCooldownMs: 0,
        weights: [26, 26, 26, 24]
    },
    {
        id: 'bulwark',
        name: 'Bulwark',
        description: 'A flying wall. Vents a shockwave ring when you get close — outrun it or eat it.',
        color: 0x64748b, accentColor: 0xe2e8f0, radius: 26,
        hp: 190, speed: 94, damage: 15, fireGapMs: 1500, range: 340, vision: 370, turnRate: 1.3,
        credits: 34,
        drops: [{ resource: 'scrap', min: 3, max: 6 }, { resource: 'circuitry', min: 1, max: 2, chance: 0.45 }],
        abilities: ['shockwave'], abilityCooldownMs: 7500,
        weights: [14, 18, 22, 24]
    },
    {
        id: 'lancer',
        name: 'Lancer',
        description: 'A gun with a cockpit bolted on. Charges a rail beam across half the sector; the charge line is your warning.',
        color: 0x8b5cf6, accentColor: 0xddd6fe, radius: 15,
        hp: 42, speed: 118, damage: 20, fireGapMs: 2300, range: 760, vision: 780, turnRate: 1.9,
        credits: 30,
        drops: [{ resource: 'scrap', min: 2, max: 4 }, { resource: 'circuitry', min: 1, max: 2, chance: 0.3 }],
        abilities: ['railbeam'], abilityCooldownMs: 9000,
        weights: [8, 14, 20, 28]
    },
    {
        id: 'dreadnought',
        name: 'Dreadnought',
        description: 'Sector command. Shockwaves, rail beams, and a hangar full of interceptors it is happy to spend.',
        color: 0xb91c1c, accentColor: 0xfecaca, radius: 58,
        hp: 1050, speed: 78, damage: 24, fireGapMs: 820, range: 560, vision: 1100, turnRate: 0.85,
        credits: 260,
        drops: [
            { resource: 'scrap', min: 14, max: 26 },
            { resource: 'circuitry', min: 4, max: 9 },
            { resource: 'warpCore', min: 1, max: 2, chance: 0.6 }
        ],
        abilities: ['shockwave', 'railbeam', 'reinforce'], abilityCooldownMs: 6000,
        weights: [0, 0, 0, 0],
        boss: true
    }
]

export const VOID_BOSS_ID = 'dreadnought'

export function voidEnemy(id: string): VoidEnemyDefinition {
    return VOID_ENEMIES.find(e => e.id === id) ?? VOID_ENEMIES[0]!
}

export function voidRollEnemy(tier: number, rng: () => number = randomFloat): VoidEnemyDefinition {
    const index = Math.max(0, Math.min(3, tier - 1))
    const pool = VOID_ENEMIES.filter(e => !e.boss && e.weights[index]! > 0)
    return randomWeighted(pool, e => e.weights[index]!, rng)
}

/** Boss respawn cadence once the first one is down. */
export const VOID_BOSS_RESPAWN_MS = 105_000

// ─── Ships ──────────────────────────────────────────────────────────────────

export interface VoidShipDefinition {
    id: string
    name: string
    description: string
    /** Multiplies the engine upgrade's top speed. */
    speedMult: number
    /** Multiplies turn rate — capitals swing around like a barge. */
    turnMult: number
    cargoMult: number
    hullMult: number
    /** Additional flat multiplier on mining time (below 1 = faster). */
    miningMult: number
    turretSlots: number
    radius: number
    color: number
    accent: number
    cost: { credits: number, resources: VoidResourceBundle }
    /** Rock-funded ships also want you to have proven a sector first. */
    requiresSector: number
}

export const VOID_SHIPS = [
    {
        id: 'skiff', name: 'Scout Skiff',
        description: 'The loaner they hand every new runner. Small hold, small guns, gets out of the way quickly.',
        speedMult: 1, turnMult: 1, cargoMult: 1, hullMult: 1, miningMult: 1,
        turretSlots: 1, radius: 16, color: 0x22d3ee, accent: 0xa5f3fc,
        cost: { credits: 0, resources: {} }, requiresSector: 0
    },
    {
        id: 'courier', name: 'Halcyon Courier',
        description: 'A hauler chassis with the cargo braces cut out. Quick, roomy enough, thin in a fight.',
        speedMult: 1.14, turnMult: 1.1, cargoMult: 1.25, hullMult: 0.95, miningMult: 1,
        turretSlots: 2, radius: 18, color: 0x60a5fa, accent: 0xbfdbfe,
        cost: { credits: 14_000, resources: { ferrite: 220, cobalt: 40 } }, requiresSector: 1
    },
    {
        id: 'prospector', name: 'Prospector',
        description: 'Purpose-built rock cutter. Twin laser heads shave a fifth off every cut and the hold is deep.',
        speedMult: 0.9, turnMult: 0.88, cargoMult: 1.85, hullMult: 1.15, miningMult: 0.8,
        turretSlots: 2, radius: 22, color: 0xfbbf24, accent: 0xfef3c7,
        cost: { credits: 48_000, resources: { ferrite: 600, cobalt: 180 } }, requiresSector: 1
    },
    {
        id: 'vanguard', name: 'Vanguard',
        description: 'Military surplus. Three hardpoints, real armour, and it still turns like something that wants to fight.',
        speedMult: 1, turnMult: 0.95, cargoMult: 1.35, hullMult: 1.5, miningMult: 1,
        turretSlots: 3, radius: 24, color: 0xf87171, accent: 0xfecaca,
        cost: { credits: 160_000, resources: { ferrite: 1400, cobalt: 520, iridium: 90 } }, requiresSector: 2
    },
    {
        id: 'leviathan', name: 'Leviathan',
        description: 'A mobile refinery with guns. Nothing about it is fast, but nothing empties its hold either.',
        speedMult: 0.62, turnMult: 0.52, cargoMult: 3, hullMult: 2.1, miningMult: 0.9,
        turretSlots: 4, radius: 34, color: 0xa78bfa, accent: 0xede9fe,
        cost: { credits: 520_000, resources: { ferrite: 3200, cobalt: 1400, iridium: 420 } }, requiresSector: 3
    },
    {
        id: 'wraith', name: 'Wraith',
        description: 'Prototype hull with no plating worth the name. Fastest thing in the sector, and it knows it.',
        speedMult: 1.5, turnMult: 1.45, cargoMult: 0.95, hullMult: 0.8, miningMult: 0.95,
        turretSlots: 3, radius: 17, color: 0x34d399, accent: 0xd1fae5,
        cost: { credits: 1_250_000, resources: { cobalt: 2600, iridium: 1100, xenite: 240 } }, requiresSector: 3
    }
] as const satisfies readonly VoidShipDefinition[]

export function voidShip(id: string): VoidShipDefinition {
    return VOID_SHIPS.find(s => s.id === id) ?? VOID_SHIPS[0]
}

// ─── Upgrades ───────────────────────────────────────────────────────────────

export type VoidUpgradeId =
    | 'engine' | 'weapon' | 'reload'
    | 'hull' | 'shield' | 'cargo'
    | 'miningSpeed' | 'miningRange' | 'oreYield'

export interface VoidUpgradeDefinition {
    id: VoidUpgradeId
    name: string
    description: string
    icon: string
    /** Which drop feeds it — enemies pay for the offence side, rocks for the boat. */
    funding: 'salvage' | 'ore'
    group: 'combat' | 'hull' | 'mining'
    maxLevel: number
    baseCredits: number
    creditGrowth: number
    /** Per-level resource cost is this bundle scaled by (level + 1). */
    resourceStep: VoidResourceBundle
    /** Human-readable value at a level, for the hangar. */
    format: (level: number) => string
}

export const VOID_UPGRADES = [
    {
        id: 'engine', name: 'Ion Thrusters', icon: 'i-lucide-rocket',
        description: 'Raises cruise and boost speed. Every runner\'s first purchase, and their last regret when they outrun their own turn rate.',
        funding: 'salvage', group: 'combat', maxLevel: 15,
        baseCredits: 900, creditGrowth: 1.36, resourceStep: { scrap: 14 },
        format: level => `${Math.round(voidBaseSpeed(level))} m/s`
    },
    {
        id: 'weapon', name: 'Gun Calibration', icon: 'i-lucide-crosshair',
        description: 'Flat damage on your primary cannon and every turret bolted to the hull.',
        funding: 'salvage', group: 'combat', maxLevel: 20,
        baseCredits: 1100, creditGrowth: 1.38, resourceStep: { scrap: 16, circuitry: 2 },
        format: level => `${voidWeaponDamage(level).toFixed(1)} dmg`
    },
    {
        id: 'reload', name: 'Feed Actuators', icon: 'i-lucide-timer',
        description: 'Shortens the gap between shots. Compounds viciously with multishot rolls.',
        funding: 'salvage', group: 'combat', maxLevel: 15,
        baseCredits: 1300, creditGrowth: 1.4, resourceStep: { scrap: 18, circuitry: 3 },
        format: level => `${Math.round(voidFireGapMs(level))} ms`
    },
    {
        id: 'hull', name: 'Hull Plating', icon: 'i-lucide-shield-half',
        description: 'Raw hit points. The storm eats a percentage of your max hull, so plating buys time in the gas too.',
        funding: 'ore', group: 'hull', maxLevel: 20,
        baseCredits: 1000, creditGrowth: 1.37, resourceStep: { ferrite: 26 },
        format: level => `${voidBaseHull(level)} hp`
    },
    {
        id: 'shield', name: 'Deflector Lattice', icon: 'i-lucide-shield',
        description: 'A regenerating buffer that soaks hits first and recharges after four seconds without being touched.',
        funding: 'ore', group: 'hull', maxLevel: 12,
        baseCredits: 2200, creditGrowth: 1.44, resourceStep: { ferrite: 20, cobalt: 8 },
        format: level => level === 0 ? 'None' : `${voidShieldCapacity(level)} shield`
    },
    {
        id: 'cargo', name: 'Cargo Braces', icon: 'i-lucide-package',
        description: 'How much you can carry before the hold locks out. Full hold means every rock you cut is wasted.',
        funding: 'ore', group: 'hull', maxLevel: 15,
        baseCredits: 1600, creditGrowth: 1.35, resourceStep: { ferrite: 22, cobalt: 6 },
        format: level => `${voidBaseCargo(level)} units`
    },
    {
        id: 'miningSpeed', name: 'Laser Focus', icon: 'i-lucide-zap',
        description: 'Cuts through rock faster. Eight seconds on a ferrite node is a long time to sit still.',
        funding: 'ore', group: 'mining', maxLevel: 14,
        baseCredits: 1400, creditGrowth: 1.39, resourceStep: { ferrite: 24, cobalt: 6 },
        format: level => `${Math.round(voidMiningSpeedMult(level) * 100)}% cut time`
    },
    {
        id: 'miningRange', name: 'Beam Optics', icon: 'i-lucide-scan-line',
        description: 'Mine from further out, which is the difference between cutting a rock and being on top of one when a Lancer charges.',
        funding: 'ore', group: 'mining', maxLevel: 10,
        baseCredits: 1800, creditGrowth: 1.38, resourceStep: { ferrite: 18, cobalt: 10 },
        format: level => `${Math.round(voidMiningRange(level))} m`
    },
    {
        id: 'oreYield', name: 'Refinery Sieve', icon: 'i-lucide-flask-conical',
        description: 'Pulls more units out of the same rock. Multiplicative with everything, so it never stops being good.',
        funding: 'ore', group: 'mining', maxLevel: 12,
        baseCredits: 2600, creditGrowth: 1.42, resourceStep: { cobalt: 14, iridium: 3 },
        format: level => `+${Math.round((voidOreYieldMult(level) - 1) * 100)}% yield`
    }
] as const satisfies readonly VoidUpgradeDefinition[]

export const VOID_UPGRADE_IDS = VOID_UPGRADES.map(u => u.id)

export function voidUpgrade(id: string): VoidUpgradeDefinition {
    return VOID_UPGRADES.find(u => u.id === id) ?? VOID_UPGRADES[0]
}

export type VoidUpgradeLevels = Record<VoidUpgradeId, number>

export function voidNormalizeLevels(levels: Partial<Record<string, number>> | null | undefined): VoidUpgradeLevels {
    const out = {} as VoidUpgradeLevels
    for (const upgrade of VOID_UPGRADES) {
        const raw = Math.floor(Number(levels?.[upgrade.id] ?? 0))
        out[upgrade.id] = Math.max(0, Math.min(upgrade.maxLevel, Number.isFinite(raw) ? raw : 0))
    }
    return out
}

/** `null` once the track is maxed. */
export function voidUpgradeCost(id: VoidUpgradeId, level: number): { credits: number, resources: VoidResourceBundle } | null {
    const def = voidUpgrade(id)
    if (level >= def.maxLevel) return null
    const credits = Math.round(def.baseCredits * def.creditGrowth ** level)
    const resources: VoidResourceBundle = {}
    for (const [resourceId, step] of Object.entries(def.resourceStep) as [VoidResourceId, number][]) {
        resources[resourceId] = Math.round(step * (level + 1) * (1 + level * 0.35))
    }
    return { credits, resources }
}

// ─── Derived ship stats ─────────────────────────────────────────────────────

export const VOID_BASE_SPEED = 215
export const VOID_BASE_HULL = 100
export const VOID_BASE_CARGO = 55
export const VOID_BASE_MINING_RANGE = 165
export const VOID_BASE_FIRE_GAP_MS = 400
export const VOID_BASE_DAMAGE = 10
export const VOID_BOOST_MULT = 1.85
export const VOID_BOOST_CAPACITY_MS = 2600
export const VOID_BOOST_RECHARGE_PER_SEC = 900
export const VOID_SHIELD_RECHARGE_DELAY_MS = 4000
export const VOID_BASE_TURN_RATE = 3.5

export function voidBaseSpeed(level: number) {
    return VOID_BASE_SPEED + level * 11
}

export function voidBaseHull(level: number) {
    return Math.round(VOID_BASE_HULL + level * 14)
}

export function voidShieldCapacity(level: number) {
    return level <= 0 ? 0 : Math.round(18 + (level - 1) * 15)
}

export function voidShieldRegenPerSec(level: number) {
    return level <= 0 ? 0 : 3 + level * 1.4
}

export function voidBaseCargo(level: number) {
    return Math.round(VOID_BASE_CARGO + level * 26)
}

export function voidWeaponDamage(level: number) {
    return VOID_BASE_DAMAGE + level * 2.4
}

export function voidFireGapMs(level: number) {
    return Math.max(115, VOID_BASE_FIRE_GAP_MS * 0.945 ** level)
}

/** Multiplier applied to a rock's base cut time. Lower is faster. */
export function voidMiningSpeedMult(level: number) {
    return Math.max(0.28, 0.94 ** level)
}

export function voidMiningRange(level: number) {
    return VOID_BASE_MINING_RANGE + level * 16
}

export function voidOreYieldMult(level: number) {
    return 1 + level * 0.09
}

export interface VoidLoadoutInput {
    levels: VoidUpgradeLevels
    shipId: string
    weapons: VoidWeaponInstance[]
}

export interface VoidDerivedStats {
    maxHull: number
    maxShield: number
    shieldRegenPerSec: number
    speed: number
    turnRate: number
    cargoCapacity: number
    damage: number
    fireGapMs: number
    miningRange: number
    miningTimeMult: number
    oreYieldMult: number
    turretSlots: number
}

export function voidDerivedStats(input: VoidLoadoutInput): VoidDerivedStats {
    const ship = voidShip(input.shipId)
    const levels = input.levels
    return {
        maxHull: Math.round(voidBaseHull(levels.hull) * ship.hullMult),
        maxShield: Math.round(voidShieldCapacity(levels.shield) * ship.hullMult),
        shieldRegenPerSec: voidShieldRegenPerSec(levels.shield),
        speed: voidBaseSpeed(levels.engine) * ship.speedMult,
        turnRate: VOID_BASE_TURN_RATE * ship.turnMult,
        cargoCapacity: Math.round(voidBaseCargo(levels.cargo) * ship.cargoMult),
        damage: voidWeaponDamage(levels.weapon),
        fireGapMs: voidFireGapMs(levels.reload),
        miningRange: voidMiningRange(levels.miningRange),
        miningTimeMult: voidMiningSpeedMult(levels.miningSpeed) * ship.miningMult,
        oreYieldMult: voidOreYieldMult(levels.oreYield),
        turretSlots: ship.turretSlots
    }
}

// ─── Weapons ────────────────────────────────────────────────────────────────

export type VoidRarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unique'

export interface VoidRarityDefinition {
    id: VoidRarityId
    name: string
    color: number
    /** Tailwind-ish hex for the hangar cards. */
    hex: string
    affixCount: number
    /** Every affix roll is multiplied by this, so a legendary roll dwarfs a common one. */
    power: number
    cost: { credits: number, resources: VoidResourceBundle }
    /** Uniques always roll a gameplay-altering special on top of their affixes. */
    guaranteedSpecial?: boolean
}

export const VOID_RARITIES = [
    { id: 'common', name: 'Common', color: 0x94a3b8, hex: '#94a3b8', affixCount: 1, power: 1, cost: { credits: 3000, resources: { scrap: 25 } } },
    { id: 'uncommon', name: 'Uncommon', color: 0x4ade80, hex: '#4ade80', affixCount: 2, power: 1.55, cost: { credits: 9500, resources: { scrap: 80 } } },
    { id: 'rare', name: 'Rare', color: 0x60a5fa, hex: '#60a5fa', affixCount: 3, power: 2.3, cost: { credits: 30_000, resources: { scrap: 200, circuitry: 25 } } },
    { id: 'epic', name: 'Epic', color: 0xc084fc, hex: '#c084fc', affixCount: 4, power: 3.3, cost: { credits: 95_000, resources: { scrap: 420, circuitry: 90 } } },
    { id: 'legendary', name: 'Legendary', color: 0xfbbf24, hex: '#fbbf24', affixCount: 5, power: 4.7, cost: { credits: 280_000, resources: { circuitry: 260, warpCore: 6 } } },
    { id: 'unique', name: 'Unique', color: 0xf43f5e, hex: '#f43f5e', affixCount: 6, power: 6.4, cost: { credits: 850_000, resources: { circuitry: 700, warpCore: 30 } }, guaranteedSpecial: true }
] as const satisfies readonly VoidRarityDefinition[]

export function voidRarity(id: string): VoidRarityDefinition {
    return VOID_RARITIES.find(r => r.id === id) ?? VOID_RARITIES[0]
}

export function voidRarityIndex(id: string) {
    const index = VOID_RARITIES.findIndex(r => r.id === id)
    return index < 0 ? 0 : index
}

export type VoidAffixId =
    | 'damage' | 'fireRate' | 'range' | 'velocity'
    | 'critChance' | 'critMult' | 'pierce' | 'multishot'
    | 'homing' | 'splash' | 'lifesteal'

export interface VoidAffixDefinition {
    id: VoidAffixId
    name: string
    /** Roll band before rarity scaling. */
    min: number
    max: number
    integer?: boolean
    suffix: string
    /** Minimum rarity index this affix can appear on. */
    minRarity: number
    describe: (value: number) => string
}

export const VOID_AFFIXES = [
    { id: 'damage', name: 'Overcharged', min: 2.5, max: 5.5, suffix: ' dmg', minRarity: 0, describe: v => `+${v.toFixed(1)} turret damage` },
    { id: 'fireRate', name: 'Rapid', min: 7, max: 16, suffix: '%', minRarity: 0, describe: v => `+${Math.round(v)}% fire rate` },
    { id: 'range', name: 'Extended', min: 8, max: 18, suffix: '%', minRarity: 0, describe: v => `+${Math.round(v)}% range` },
    { id: 'velocity', name: 'Accelerated', min: 9, max: 20, suffix: '%', minRarity: 0, describe: v => `+${Math.round(v)}% projectile speed` },
    { id: 'critChance', name: 'Precise', min: 3, max: 8, suffix: '%', minRarity: 1, describe: v => `+${v.toFixed(1)}% crit chance` },
    { id: 'critMult', name: 'Brutal', min: 12, max: 30, suffix: '%', minRarity: 1, describe: v => `+${Math.round(v)}% crit damage` },
    { id: 'pierce', name: 'Piercing', min: 1, max: 1.4, integer: true, suffix: '', minRarity: 2, describe: v => `Pierces ${Math.round(v)} extra target${Math.round(v) === 1 ? '' : 's'}` },
    { id: 'multishot', name: 'Scattering', min: 0.6, max: 1, integer: true, suffix: '', minRarity: 2, describe: v => `+${Math.round(v)} projectile${Math.round(v) === 1 ? '' : 's'}` },
    { id: 'homing', name: 'Seeking', min: 25, max: 55, suffix: '%', minRarity: 2, describe: v => `${Math.round(v)}% tracking` },
    { id: 'splash', name: 'Detonating', min: 16, max: 34, suffix: ' m', minRarity: 3, describe: v => `${Math.round(v)} m splash` },
    { id: 'lifesteal', name: 'Vampiric', min: 1.2, max: 3, suffix: '%', minRarity: 3, describe: v => `${v.toFixed(1)}% hull leech` }
] as const satisfies readonly VoidAffixDefinition[]

export function voidAffix(id: string): VoidAffixDefinition {
    return VOID_AFFIXES.find(a => a.id === id) ?? VOID_AFFIXES[0]
}

export type VoidSpecialId = 'rocket-conversion' | 'chain-arc' | 'railgun' | 'swarm-drones' | 'void-siphon' | 'singularity'

export interface VoidSpecialDefinition {
    id: VoidSpecialId
    name: string
    description: string
    icon: string
}

export const VOID_SPECIALS = [
    {
        id: 'rocket-conversion', name: 'Warhead Conversion', icon: 'i-lucide-rocket',
        description: 'Your primary cannon and every turret fire rockets — 60% more damage in a 70 m blast, at a 25% slower cycle.'
    },
    {
        id: 'chain-arc', name: 'Arc Cascade', icon: 'i-lucide-git-fork',
        description: 'Every hit forks to two more targets within 260 m for 55% damage.'
    },
    {
        id: 'railgun', name: 'Mass Driver', icon: 'i-lucide-move-right',
        description: 'Shots pierce everything they touch and travel 60% faster. Line up a lane and hold the trigger.'
    },
    {
        id: 'swarm-drones', name: 'Swarm Rack', icon: 'i-lucide-bug',
        description: 'Three drones orbit your hull and independently engage anything in 420 m.'
    },
    {
        id: 'void-siphon', name: 'Void Siphon', icon: 'i-lucide-droplet',
        description: '10% of damage dealt repairs your hull, and kills cough up a bonus ore fragment straight into the hold.'
    },
    {
        id: 'singularity', name: 'Collapse Core', icon: 'i-lucide-circle-dot',
        description: 'Every kill leaves a two-second singularity that drags nearby ships in and grinds them for heavy damage.'
    }
] as const satisfies readonly VoidSpecialDefinition[]

export function voidSpecial(id: string | null | undefined) {
    return VOID_SPECIALS.find(s => s.id === id) ?? null
}

export interface VoidWeaponInstance {
    id: string
    rarityId: VoidRarityId
    name: string
    affixes: Partial<Record<VoidAffixId, number>>
    specialId: VoidSpecialId | null
    slotIndex: number | null
}

const VOID_WEAPON_NOUNS = ['Repeater', 'Autocannon', 'Lance', 'Pulser', 'Driver', 'Scattergun', 'Emitter', 'Battery', 'Fang', 'Needle']
const VOID_WEAPON_PREFIXES = ['Halcyon', 'Cinder', 'Nix', 'Umbral', 'Karrow', 'Deep', 'Sable', 'Vex', 'Orbital', 'Broken']

/** Turret baselines before affixes — the numbers a Common with no rolls would have. */
export const VOID_TURRET_BASE = {
    damage: 6.5,
    fireGapMs: 900,
    range: 400,
    velocity: 640
}

export function rollVoidWeapon(rarityId: VoidRarityId, rng: () => number = randomFloat): Omit<VoidWeaponInstance, 'id' | 'slotIndex'> {
    const rarity = voidRarity(rarityId)
    const index = voidRarityIndex(rarityId)
    const pool = VOID_AFFIXES.filter(a => a.minRarity <= index)
    const chosen: VoidAffixDefinition[] = []
    const available = [...pool]
    for (let i = 0; i < rarity.affixCount && available.length > 0; i++) {
        const pickIndex = Math.floor(rng() * available.length)
        chosen.push(available.splice(pickIndex, 1)[0]!)
    }

    const affixes: Partial<Record<VoidAffixId, number>> = {}
    for (const affix of chosen) {
        const raw = (affix.min + rng() * (affix.max - affix.min)) * rarity.power
        affixes[affix.id] = affix.integer ? Math.max(1, Math.round(raw)) : Math.round(raw * 10) / 10
    }

    const specialId = rarity.guaranteedSpecial
        ? VOID_SPECIALS[Math.floor(rng() * VOID_SPECIALS.length)]!.id
        : null

    const prefix = VOID_WEAPON_PREFIXES[Math.floor(rng() * VOID_WEAPON_PREFIXES.length)]!
    const noun = VOID_WEAPON_NOUNS[Math.floor(rng() * VOID_WEAPON_NOUNS.length)]!
    const name = specialId ? `${prefix} ${voidSpecial(specialId)!.name}` : `${prefix} ${noun}`

    return { rarityId, name, affixes, specialId }
}

/** What a turret is worth in scrap when you strip it — a flat fraction of what it cost. */
export const VOID_WEAPON_SELL_RATE = 0.35

export function voidWeaponSellValue(rarityId: VoidRarityId) {
    const cost = voidRarity(rarityId).cost
    return {
        credits: Math.round(cost.credits * VOID_WEAPON_SELL_RATE),
        resources: Object.fromEntries(
            Object.entries(cost.resources).map(([id, amount]) => [id, Math.round(amount * VOID_WEAPON_SELL_RATE)])
        ) as VoidResourceBundle
    }
}

export interface VoidTurretRuntime {
    id: string
    rarityId: VoidRarityId
    name: string
    damage: number
    fireGapMs: number
    range: number
    velocity: number
    critChance: number
    critMult: number
    pierce: number
    multishot: number
    homing: number
    splash: number
    lifesteal: number
    color: number
    specialId: VoidSpecialId | null
}

/** Resolves a stored weapon plus the player's flat gun-calibration bonus into runtime numbers. */
export function voidTurretRuntime(weapon: VoidWeaponInstance, flatDamage: number): VoidTurretRuntime {
    const a = weapon.affixes
    return {
        id: weapon.id,
        rarityId: weapon.rarityId,
        name: weapon.name,
        damage: (VOID_TURRET_BASE.damage + (a.damage ?? 0)) + flatDamage * 0.45,
        fireGapMs: VOID_TURRET_BASE.fireGapMs / (1 + (a.fireRate ?? 0) / 100),
        range: VOID_TURRET_BASE.range * (1 + (a.range ?? 0) / 100),
        velocity: VOID_TURRET_BASE.velocity * (1 + (a.velocity ?? 0) / 100),
        critChance: (a.critChance ?? 0) / 100,
        critMult: 1.5 + (a.critMult ?? 0) / 100,
        pierce: Math.round(a.pierce ?? 0),
        multishot: Math.round(a.multishot ?? 0),
        homing: (a.homing ?? 0) / 100,
        splash: a.splash ?? 0,
        lifesteal: (a.lifesteal ?? 0) / 100,
        color: voidRarity(weapon.rarityId).color,
        specialId: weapon.specialId
    }
}

// ─── Power level ────────────────────────────────────────────────────────────

/**
 * A single number the hangar uses to say "this sector will kill you". Upgrade
 * levels carry most of it; hull and turret rarity carry the rest.
 */
export function voidPowerLevel(input: VoidLoadoutInput) {
    const levels = input.levels
    const upgradeScore = VOID_UPGRADES.reduce((sum, def) => sum + levels[def.id] * (def.group === 'combat' ? 2.4 : def.group === 'hull' ? 2 : 1.2), 0)
    const ship = voidShip(input.shipId)
    const shipScore = (ship.hullMult + ship.speedMult + ship.cargoMult * 0.4) * 6 + ship.turretSlots * 4
    const turretScore = input.weapons
        .filter(w => w.slotIndex !== null)
        .reduce((sum, w) => sum + (voidRarityIndex(w.rarityId) + 1) ** 1.6 * 3, 0)
    return Math.round(upgradeScore + shipScore + turretScore)
}

export function voidRecommendedSector(power: number, highestSectorExtracted: number) {
    let best = 1
    for (const sector of VOID_SECTORS) {
        if (!voidSectorUnlocked(sector.tier, highestSectorExtracted)) break
        if (power >= sector.recommendedPower) best = sector.tier
    }
    return best
}

// ─── Payout ─────────────────────────────────────────────────────────────────

/**
 * Anti-cheat ceiling on banked credits. Generous enough that a genuinely good
 * run never brushes it, tight enough that a forged finish-run payload can't
 * print a fortune.
 */
export function voidMaxCreditsForRun(elapsedMs: number, tier: number) {
    const sector = voidSector(tier)
    const minutes = Math.max(0, elapsedMs) / 60_000
    return Math.round((1200 + minutes * 2600) * sector.reward)
}

/** And the same idea for cargo, keyed off the hold the player actually launched with. */
export function voidMaxResourceUnitsForRun(cargoCapacity: number) {
    return Math.max(0, Math.floor(cargoCapacity))
}

/** Flat credit bonus for docking with a full-value hold instead of dying on it. */
export function voidExtractionBonus(tier: number, unitsCarried: number) {
    return Math.round(voidSector(tier).reward * (250 + unitsCarried * 12))
}

export function voidRollDrop(min: number, max: number) {
    return randomInt(min, max)
}
