import { randomFloat, randomInt, randomWeighted } from '../random'

// ─── Void Runner ────────────────────────────────────────────────────────────
//
// An extraction miner. You undock from the mothership at the centre of the
// sector, mine rocks and kill patrols for resources, and fly back to the
// mothership to bank what you're carrying. Everything you're holding when you
// die is lost, so the whole run is a "one more rock" pressure test — and the
// ion storm that closes in from the edges at five minutes makes that decision
// for you eventually.
//
// The gun and the mining laser are the same hardware. A module you bolt into a
// hardpoint rolls both combat and mining affixes, so a "weapon" upgrade is
// always also a mining upgrade, and choosing a loadout means choosing what kind
// of runner you are.

export const VOID_STORM_START_MS = 5 * 60 * 1000
/** By this point the storm has swallowed the entire sector, mothership included. */
export const VOID_STORM_FULL_MS = 8 * 60 * 1000
/** Hard ceiling. Anyone still out here has already been in the gas for a minute. */
export const VOID_RUN_DURATION_MS = 9 * 60 * 1000

/** Storm damage per second at full depth, as a fraction of the player's max hull. */
export const VOID_STORM_DPS_FRACTION = 0.075
/** Enemies breathe the same gas, but they only take a quarter of it. */
export const VOID_STORM_ENEMY_MULT = 0.25

export const VOID_DOCK_RADIUS = 200
export const VOID_EXTRACT_HOLD_MS = 1200

// ─── Difficulty ramp ────────────────────────────────────────────────────────

/**
 * The sector gets meaner every minute you stay in it, independently of the
 * sector tier. Minute 0 is the baseline; by the time the storm arrives at
 * minute 5 patrols hit about 60% harder, and anyone still out at minute 8 is
 * fighting something close to double-strength.
 */
export const VOID_RAMP_PER_MINUTE = 0.12

export function voidRampMinute(elapsedMs: number) {
    return Math.max(0, Math.floor(elapsedMs / 60_000))
}

/** Multiplier on enemy hp, damage and reward at a given point in the run. */
export function voidRampMultiplier(elapsedMs: number) {
    return 1 + voidRampMinute(elapsedMs) * VOID_RAMP_PER_MINUTE
}

/** Patrols also arrive faster and in greater numbers as the clock runs. */
export function voidRampSpawnIntervalMult(elapsedMs: number) {
    return Math.max(0.4, 1 - voidRampMinute(elapsedMs) * 0.075)
}

export function voidRampExtraEnemies(elapsedMs: number) {
    return Math.floor(voidRampMinute(elapsedMs) * 0.8)
}

/** The mid-run capital shows up here, well before the storm. */
export const VOID_MIDBOSS_SPAWN_MS = 3 * 60 * 1000

// ─── Resources ──────────────────────────────────────────────────────────────

export type VoidResourceId = 'ferrite' | 'cobalt' | 'iridium' | 'xenite' | 'scrap' | 'circuitry' | 'warpCore'

export interface VoidResourceDefinition {
    id: VoidResourceId
    name: string
    /** `ore` comes out of rocks and buys the boat; `salvage` drops off kills and buys the guns. */
    kind: 'ore' | 'salvage'
    color: number
    icon: string
    description: string
}

export const VOID_RESOURCES = [
    { id: 'ferrite', name: 'Ferrite', kind: 'ore', color: 0x9aa6b2, icon: 'i-lucide-hexagon', description: 'Dull grey structural ore. The backbone of every hull plate ever pressed.' },
    { id: 'cobalt', name: 'Cobalt', kind: 'ore', color: 0x4f8ff7, icon: 'i-lucide-diamond', description: 'Deep blue crystal that holds a shield lattice together.' },
    { id: 'iridium', name: 'Iridium', kind: 'ore', color: 0xc084fc, icon: 'i-lucide-pyramid', description: 'Violet superdense ore. Slow to cut, worth the exposure.' },
    { id: 'xenite', name: 'Xenite', kind: 'ore', color: 0x34d399, icon: 'i-lucide-atom', description: 'Living green ore that hums when the laser touches it. Only the deep sectors have it.' },
    { id: 'scrap', name: 'Scrap', kind: 'salvage', color: 0xf59e0b, icon: 'i-lucide-wrench', description: 'Torn hull plate off dead patrols. Feeds thrusters, weapon cores and targeting gear.' },
    { id: 'circuitry', name: 'Circuitry', kind: 'salvage', color: 0x22d3ee, icon: 'i-lucide-cpu', description: 'Intact targeting boards pulled from heavier wrecks.' },
    { id: 'warpCore', name: 'Warp Core', kind: 'salvage', color: 0xf472b6, icon: 'i-lucide-zap', description: 'A still-warm drive core. Only capital ships carry one.' }
] as const satisfies readonly VoidResourceDefinition[]

export const VOID_RESOURCE_IDS = VOID_RESOURCES.map(r => r.id)

export type VoidResourceBundle = Partial<Record<VoidResourceId, number>>

export function voidResource(id: string) {
    return VOID_RESOURCES.find(r => r.id === id) ?? VOID_RESOURCES[0]
}

/** Packed colour to CSS, so the UI can use the exact palette the canvas does. */
export function voidHex(color: number) {
    return `#${color.toString(16).padStart(6, '0')}`
}

export function voidResourceHex(id: string) {
    return voidHex(voidResource(id).color)
}

// ─── The market ─────────────────────────────────────────────────────────────
//
// Nothing in the sector drops coins. Patrols drop salvage, rocks drop ore, and
// the only way either becomes money is selling it at the dock — which means
// every coin you earn had to survive an extraction first.
//
// Prices are deliberately top-heavy. Ferrite is close to worthless by the
// standards of this site; xenite and warp cores are where the money is, and
// both only exist in the deep sectors.

export const VOID_MARKET_PRICES: Record<VoidResourceId, number> = {
    ferrite: 1_000,
    scrap: 1_500,
    cobalt: 11_000,
    circuitry: 28_000,
    iridium: 80_000,
    xenite: 280_000,
    warpCore: 800_000
}

export function voidUnitPrice(id: string) {
    return VOID_MARKET_PRICES[id as VoidResourceId] ?? 0
}

/** Coin value of a bundle at market rates. */
export function voidBundleValue(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.reduce((sum, id) => sum + Math.max(0, Math.floor(bundle[id] ?? 0)) * VOID_MARKET_PRICES[id], 0)
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
    /** Enemy hp/damage/speed multiplier, before the per-minute ramp. */
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
    /** When the sector's heavy capital arrives. The mid-boss is always minute 3. */
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
        threat: 1,
        baseEnemies: 4,
        maxEnemies: 10,
        spawnIntervalMs: 10_000,
        rockCountMin: 28,
        rockCountMax: 36,
        reward: 1,
        mineTimeMult: 1,
        bossFirstSpawnMs: 330_000,
        recommendedPower: 0
    },
    {
        tier: 2,
        name: 'Cinder Reach',
        description: 'Wrecks of an old mining war. Cobalt is common, and so is the patrol that wants it back.',
        color: 0xf59e0b,
        threat: 1.7,
        baseEnemies: 6,
        maxEnemies: 14,
        spawnIntervalMs: 8000,
        rockCountMin: 26,
        rockCountMax: 34,
        reward: 2.3,
        mineTimeMult: 1.12,
        bossFirstSpawnMs: 285_000,
        recommendedPower: 60
    },
    {
        tier: 3,
        name: 'The Long Dark',
        description: 'No stars, no beacons. Iridium seams and something that hunts by drive signature.',
        color: 0xa855f7,
        threat: 2.9,
        baseEnemies: 8,
        maxEnemies: 18,
        spawnIntervalMs: 6400,
        rockCountMin: 24,
        rockCountMax: 32,
        reward: 5.2,
        mineTimeMult: 1.28,
        bossFirstSpawnMs: 240_000,
        recommendedPower: 155
    },
    {
        tier: 4,
        name: 'Xenite Womb',
        description: 'The rocks are warm and they move a little. Nothing that flies out here is friendly.',
        color: 0x34d399,
        threat: 4.7,
        baseEnemies: 10,
        maxEnemies: 22,
        spawnIntervalMs: 5200,
        rockCountMin: 22,
        rockCountMax: 30,
        reward: 11,
        mineTimeMult: 1.45,
        bossFirstSpawnMs: 200_000,
        recommendedPower: 330
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
    /** Base rock body colour, plus the ore seam colour that glows through it. */
    color: number
    shade: number
    glow: number
    /** Base milliseconds of held laser to crack it open, before modifiers. */
    mineMs: number
    yieldMin: number
    yieldMax: number
    radius: number
    /** Spawn weight per sector tier — index 0 is tier 1. Zero means absent. */
    weights: readonly number[]
}

export const VOID_ROCKS: readonly VoidRockDefinition[] = [
    {
        id: 'ferrite-node', name: 'Ferrite Node', resource: 'ferrite',
        color: 0x6b7280, shade: 0x3f4552, glow: 0xd7dee6, mineMs: 7000, yieldMin: 4, yieldMax: 8, radius: 36,
        weights: [70, 40, 20, 9]
    },
    {
        id: 'cobalt-seam', name: 'Cobalt Seam', resource: 'cobalt',
        color: 0x334d78, shade: 0x1e2f4d, glow: 0x7cb6ff, mineMs: 11_500, yieldMin: 3, yieldMax: 6, radius: 40,
        weights: [13, 40, 33, 20]
    },
    {
        id: 'iridium-cluster', name: 'Iridium Cluster', resource: 'iridium',
        color: 0x4c2f78, shade: 0x2e1a4d, glow: 0xd8b4fe, mineMs: 17_000, yieldMin: 2, yieldMax: 5, radius: 44,
        weights: [3, 15, 33, 32]
    },
    {
        id: 'xenite-bloom', name: 'Xenite Bloom', resource: 'xenite',
        color: 0x134e4a, shade: 0x0b2f2c, glow: 0x5eead4, mineMs: 23_000, yieldMin: 2, yieldMax: 4, radius: 48,
        weights: [0, 2, 13, 39]
    }
]

export function voidRock(id: string): VoidRockDefinition {
    return VOID_ROCKS.find(r => r.id === id) ?? VOID_ROCKS[0]!
}

export function voidRollRock(tier: number, rng: () => number = randomFloat): VoidRockDefinition {
    const index = Math.max(0, Math.min(3, tier - 1))
    const pool = VOID_ROCKS.filter(rock => (rock.weights[index] ?? 0) > 0)
    return randomWeighted(pool, rock => rock.weights[index] ?? 0, rng)
}

// ─── Enemies ────────────────────────────────────────────────────────────────

export type VoidEnemyAbility = 'shockwave' | 'railbeam' | 'reinforce' | 'burst' | 'drones' | 'minelayer'

export interface VoidEnemyDefinition {
    id: string
    name: string
    description: string
    color: number
    accentColor: number
    trimColor: number
    radius: number
    hp: number
    speed: number
    /** Damage of a single bolt, before sector threat and the minute ramp. */
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
    /** Relative spawn weight per sector tier. */
    weights: readonly number[]
    /** Capitals never spawn from the normal patrol roll. */
    boss?: boolean
}

export const VOID_ENEMIES: readonly VoidEnemyDefinition[] = [
    {
        id: 'interceptor',
        name: 'Interceptor',
        description: 'Standard corporate patrol. Nothing special, and there are always more.',
        color: 0xb91c1c, accentColor: 0xfca5a5, trimColor: 0x7f1d1d, radius: 17,
        hp: 52, speed: 156, damage: 7, fireGapMs: 1150, range: 400, vision: 430, turnRate: 2.6,
        credits: 16,
        drops: [{ resource: 'scrap', min: 2, max: 4 }],
        abilities: [], abilityCooldownMs: 0,
        weights: [52, 42, 32, 24]
    },
    {
        id: 'stinger',
        name: 'Stinger',
        description: 'Light hull strapped to an oversized drive. It will close the gap before you finish the thought.',
        color: 0xea580c, accentColor: 0xfed7aa, trimColor: 0x9a3412, radius: 13,
        hp: 30, speed: 272, damage: 5.5, fireGapMs: 720, range: 300, vision: 560, turnRate: 4.4,
        credits: 18,
        drops: [{ resource: 'scrap', min: 2, max: 4 }],
        abilities: [], abilityCooldownMs: 0,
        weights: [26, 26, 26, 24]
    },
    {
        id: 'bulwark',
        name: 'Bulwark',
        description: 'A flying wall. Vents a shockwave ring when you get close — outrun it or dive inside it.',
        color: 0x475569, accentColor: 0xe2e8f0, trimColor: 0x1e293b, radius: 26,
        hp: 165, speed: 96, damage: 13, fireGapMs: 1500, range: 340, vision: 380, turnRate: 1.3,
        credits: 38,
        drops: [{ resource: 'scrap', min: 4, max: 8 }, { resource: 'circuitry', min: 1, max: 3, chance: 0.55 }],
        abilities: ['shockwave'], abilityCooldownMs: 7800,
        weights: [14, 18, 22, 24]
    },
    {
        id: 'lancer',
        name: 'Lancer',
        description: 'A gun with a cockpit bolted on. Charges a rail beam across half the sector; the charge line is your warning.',
        color: 0x7c3aed, accentColor: 0xddd6fe, trimColor: 0x4c1d95, radius: 15,
        hp: 38, speed: 120, damage: 17, fireGapMs: 2400, range: 760, vision: 780, turnRate: 1.9,
        credits: 34,
        drops: [{ resource: 'scrap', min: 3, max: 5 }, { resource: 'circuitry', min: 1, max: 2, chance: 0.45 }],
        abilities: ['railbeam'], abilityCooldownMs: 9500,
        weights: [8, 14, 20, 28]
    },
    {
        id: 'warden',
        name: 'Warden',
        description: 'A drone carrier with far too much armour. Ignores you personally and lets its swarm do the work.',
        color: 0x0d9488, accentColor: 0x99f6e4, trimColor: 0x134e4a, radius: 30,
        hp: 235, speed: 84, damage: 9, fireGapMs: 1900, range: 320, vision: 520, turnRate: 1,
        credits: 46,
        drops: [{ resource: 'scrap', min: 4, max: 8 }, { resource: 'circuitry', min: 1, max: 3, chance: 0.55 }],
        abilities: ['drones'], abilityCooldownMs: 9500,
        weights: [6, 13, 18, 20]
    },
    {
        id: 'nettle',
        name: 'Nettle',
        description: 'Runs interference and leaves proximity mines in its wake. Chasing one in a straight line is how you die.',
        color: 0xca8a04, accentColor: 0xfef08a, trimColor: 0x713f12, radius: 16,
        hp: 66, speed: 172, damage: 8, fireGapMs: 1400, range: 330, vision: 520, turnRate: 2.9,
        credits: 28,
        drops: [{ resource: 'scrap', min: 2, max: 4 }],
        abilities: ['minelayer'], abilityCooldownMs: 5200,
        weights: [5, 10, 15, 17]
    },
    {
        // Launched by Wardens, never rolled as a patrol. Individually trivial;
        // the threat is that there are always six more.
        id: 'drone',
        name: 'Warden Drone',
        description: 'A hand-sized hunter-killer. Almost no health, almost no damage, absolutely relentless.',
        color: 0x2dd4bf, accentColor: 0xccfbf1, trimColor: 0x0f766e, radius: 8,
        hp: 13, speed: 224, damage: 2.6, fireGapMs: 950, range: 250, vision: 1400, turnRate: 5,
        credits: 3,
        drops: [{ resource: 'scrap', min: 1, max: 1, chance: 0.22 }],
        abilities: [], abilityCooldownMs: 0,
        weights: [0, 0, 0, 0]
    },
    {
        id: 'harbinger',
        name: 'Harbinger',
        description: 'A fast strike cruiser that jumps in at minute three. Shockwaves, burst salvos, and a small escort wing.',
        color: 0xc2410c, accentColor: 0xfdba74, trimColor: 0x7c2d12, radius: 40,
        hp: 520, speed: 118, damage: 15, fireGapMs: 950, range: 500, vision: 950, turnRate: 1.15,
        credits: 150,
        drops: [
            { resource: 'scrap', min: 8, max: 16 },
            { resource: 'circuitry', min: 2, max: 5 },
            { resource: 'warpCore', min: 1, max: 1, chance: 0.3 }
        ],
        abilities: ['shockwave', 'burst', 'reinforce'], abilityCooldownMs: 6500,
        weights: [0, 0, 0, 0],
        boss: true
    },
    {
        id: 'dreadnought',
        name: 'Dreadnought',
        description: 'Sector command. Shockwaves, rail beams, and a hangar full of interceptors it is happy to spend.',
        color: 0x991b1b, accentColor: 0xfecaca, trimColor: 0x450a0a, radius: 60,
        hp: 1100, speed: 76, damage: 22, fireGapMs: 850, range: 580, vision: 1150, turnRate: 0.85,
        credits: 320,
        drops: [
            { resource: 'scrap', min: 16, max: 30 },
            { resource: 'circuitry', min: 5, max: 11 },
            { resource: 'warpCore', min: 1, max: 3, chance: 0.7 }
        ],
        abilities: ['shockwave', 'railbeam', 'reinforce', 'burst'], abilityCooldownMs: 5800,
        weights: [0, 0, 0, 0],
        boss: true
    }
]

export const VOID_MIDBOSS_ID = 'harbinger'
export const VOID_BOSS_ID = 'dreadnought'
export const VOID_DRONE_ID = 'drone'
/** How many hunter-killers a Warden puts in the air per launch. */
export const VOID_WARDEN_DRONE_COUNT = 3
export const VOID_WARDEN_MAX_DRONES = 7
/** Boss respawn cadence once the sector capital is down. */
export const VOID_BOSS_RESPAWN_MS = 120_000

export function voidEnemy(id: string): VoidEnemyDefinition {
    return VOID_ENEMIES.find(e => e.id === id) ?? VOID_ENEMIES[0]!
}

export function voidRollEnemy(tier: number, rng: () => number = randomFloat): VoidEnemyDefinition {
    const index = Math.max(0, Math.min(3, tier - 1))
    const pool = VOID_ENEMIES.filter(e => !e.boss && (e.weights[index] ?? 0) > 0)
    return randomWeighted(pool, e => e.weights[index] ?? 0, rng)
}

// ─── Ships ──────────────────────────────────────────────────────────────────

export interface VoidShipDefinition {
    id: string
    name: string
    description: string
    speedMult: number
    turnMult: number
    cargoMult: number
    hullMult: number
    /** Extra multiplier on cut time (below 1 = faster). */
    miningMult: number
    /** Hardpoints. Every mounted module contributes its affixes to the whole ship. */
    turretSlots: number
    /**
     * Barrels on the primary weapon. More barrels fire more parallel lanes on
     * every trigger pull for more total damage — see `voidVolley` — which is a
     * large part of what you're buying when you buy a bigger hull.
     */
    barrels: number
    radius: number
    color: number
    accent: number
    trim: number
    cost: { credits: number, resources: VoidResourceBundle, gems?: number }
    requiresSector: number
    /** Marks the one hull that is bought rather than earned. */
    premium?: boolean
}

export const VOID_SHIPS: readonly VoidShipDefinition[] = [
    {
        id: 'skiff', name: 'Scout Skiff',
        description: 'The loaner they hand every new runner. One hardpoint, one barrel, gets out of the way quickly.',
        speedMult: 1, turnMult: 1, cargoMult: 1, hullMult: 1, miningMult: 1,
        turretSlots: 1, barrels: 1, radius: 17, color: 0x22d3ee, accent: 0xa5f3fc, trim: 0x0e7490,
        cost: { credits: 0, resources: {} }, requiresSector: 0
    },
    {
        id: 'courier', name: 'Halcyon Courier',
        description: 'A hauler chassis with the cargo braces cut out. Quick, roomy enough, thin in a fight.',
        speedMult: 1.14, turnMult: 1.1, cargoMult: 1.3, hullMult: 0.95, miningMult: 1,
        turretSlots: 2, barrels: 2, radius: 19, color: 0x3b82f6, accent: 0xbfdbfe, trim: 0x1e3a8a,
        cost: { credits: 1_500_000, resources: { ferrite: 180, cobalt: 30 }, gems: 15 }, requiresSector: 1
    },
    {
        id: 'prospector', name: 'Prospector',
        description: 'Purpose-built rock cutter. Twin laser heads shave a fifth off every cut and the hold is deep.',
        speedMult: 0.9, turnMult: 0.88, cargoMult: 1.9, hullMult: 1.2, miningMult: 0.8,
        turretSlots: 2, barrels: 2, radius: 23, color: 0xf59e0b, accent: 0xfef3c7, trim: 0x92400e,
        cost: { credits: 6_000_000, resources: { ferrite: 520, cobalt: 150 }, gems: 40 }, requiresSector: 1
    },
    {
        id: 'vanguard', name: 'Vanguard',
        description: 'Military surplus. Three hardpoints, a triple-barrel spinal mount, and real armour.',
        speedMult: 1, turnMult: 0.95, cargoMult: 1.35, hullMult: 1.55, miningMult: 1,
        turretSlots: 3, barrels: 3, radius: 25, color: 0xef4444, accent: 0xfecaca, trim: 0x7f1d1d,
        cost: { credits: 45_000_000, resources: { ferrite: 1250, cobalt: 460, iridium: 80 }, gems: 90 }, requiresSector: 2
    },
    {
        id: 'leviathan', name: 'Leviathan',
        description: 'A mobile refinery with guns. Nothing about it is fast, but nothing empties its hold either.',
        speedMult: 0.64, turnMult: 0.54, cargoMult: 3.1, hullMult: 2.2, miningMult: 0.88,
        turretSlots: 4, barrels: 3, radius: 36, color: 0x8b5cf6, accent: 0xede9fe, trim: 0x4c1d95,
        cost: { credits: 250_000_000, resources: { ferrite: 2900, cobalt: 1250, iridium: 380 }, gems: 160 }, requiresSector: 3
    },
    {
        id: 'wraith', name: 'Wraith',
        description: 'Prototype hull with no plating worth the name. Fastest thing in the sector, and it knows it.',
        speedMult: 1.52, turnMult: 1.45, cargoMult: 0.95, hullMult: 0.8, miningMult: 0.95,
        turretSlots: 3, barrels: 2, radius: 18, color: 0x10b981, accent: 0xd1fae5, trim: 0x064e3b,
        cost: { credits: 900_000_000, resources: { cobalt: 2400, iridium: 1000, xenite: 210 }, gems: 250 }, requiresSector: 3
    },
    {
        id: 'aurelian', name: 'Aurelian Crown',
        description: 'Obsidian hull, gold filigree, a sapphire drive core that should not exist. Fast, armoured, cavernous and triple-barrelled — there is nothing it is bad at, which is precisely what it costs.',
        speedMult: 1.32, turnMult: 1.26, cargoMult: 2.3, hullMult: 1.85, miningMult: 0.72,
        turretSlots: 4, barrels: 3, radius: 27, color: 0x0b1020, accent: 0xfbbf24, trim: 0x1d4ed8,
        cost: {
            credits: 100_000_000_000,
            resources: { iridium: 6000, xenite: 2500, warpCore: 400 },
            gems: 500
        }, requiresSector: 0,
        premium: true
    }
]

export function voidShip(id: string): VoidShipDefinition {
    return VOID_SHIPS.find(s => s.id === id) ?? VOID_SHIPS[0]!
}

/** Perpendicular spacing between barrel lanes, in world units. */
export const VOID_LANE_SPACING = 14

/**
 * Resolves a trigger pull into parallel lanes. Total output rises sub-linearly
 * with lane count, so a triple-barrel hull is a real upgrade over a single
 * without being three times the damage — and the wide lanes mean it also
 * sweeps groups rather than drilling one target.
 */
export function voidVolley(damage: number, barrels: number, multishot: number) {
    const lanes = Math.max(1, Math.round(barrels + multishot))
    const total = damage * (1 + (lanes - 1) * 0.4)
    return { lanes, damagePerShot: total / lanes }
}

// ─── Upgrade tracks ─────────────────────────────────────────────────────────

export type VoidUpgradeId = 'thrusters' | 'weaponCore' | 'targeting' | 'plating' | 'deflector' | 'hold' | 'refinery'

export interface VoidUpgradeDefinition {
    id: VoidUpgradeId
    name: string
    description: string
    icon: string
    /** Enemies fund the offence side, rocks fund the boat. */
    funding: 'salvage' | 'ore'
    maxLevel: number
    baseCredits: number
    creditGrowth: number
    resourceStep: VoidResourceBundle
    /** One short line per effect, for the hangar row. */
    format: (level: number) => string[]
}

export const VOID_BASE_SPEED = 215
export const VOID_BASE_HULL = 110
export const VOID_BASE_CARGO = 55
export const VOID_BASE_DAMAGE = 10
export const VOID_BASE_FIRE_GAP_MS = 400
export const VOID_BASE_WEAPON_RANGE = 520
export const VOID_BASE_MINING_RANGE = 170
export const VOID_BASE_MAGNET_RANGE = 240
export const VOID_BASE_PROJECTILE_SPEED = 900
export const VOID_BASE_TURN_RATE = 3.5
export const VOID_BOOST_MULT = 1.85
export const VOID_BOOST_CAPACITY_MS = 2600
export const VOID_BOOST_RECHARGE_PER_SEC = 900
export const VOID_SHIELD_RECHARGE_DELAY_MS = 4000

export const voidSpeedFor = (level: number) => VOID_BASE_SPEED + level * 12
export const voidDamageFor = (level: number) => VOID_BASE_DAMAGE + level * 2.6
export const voidFireGapFor = (level: number) => Math.max(110, VOID_BASE_FIRE_GAP_MS * 0.958 ** level)
export const voidMiningMultFor = (level: number) => Math.max(0.3, 0.955 ** level)
export const voidWeaponRangeFor = (level: number) => VOID_BASE_WEAPON_RANGE + level * 26
export const voidMiningRangeFor = (level: number) => VOID_BASE_MINING_RANGE + level * 15
export const voidCritFor = (level: number) => level * 0.006
export const voidHullFor = (level: number) => Math.round(VOID_BASE_HULL + level * 15)
export const voidShieldFor = (level: number) => level <= 0 ? 0 : Math.round(20 + (level - 1) * 16)
export const voidShieldRegenFor = (level: number) => level <= 0 ? 0 : 3 + level * 1.5
export const voidCargoFor = (level: number) => Math.round(VOID_BASE_CARGO + level * 28)
export const voidOreYieldFor = (level: number) => 1 + level * 0.08
export const voidSalvageYieldFor = (level: number) => 1 + level * 0.09
export const voidMarketMultFor = (level: number) => 1 + level * 0.05

export const VOID_UPGRADES: readonly VoidUpgradeDefinition[] = [
    {
        id: 'weaponCore', name: 'Weapon Core', icon: 'i-lucide-atom',
        description: 'The reactor behind both the gun and the cutting laser. Raises damage, shortens the firing cycle, and cuts rock faster.',
        // Deliberately scrap-only: the core track is the spine of the build and
        // should never be gated behind a drop that only heavies carry.
        funding: 'salvage', maxLevel: 20,
        baseCredits: 100_000, creditGrowth: 1.62, resourceStep: { scrap: 18 },
        format: level => [
            `${voidDamageFor(level).toFixed(1)} dmg`,
            `${Math.round(voidFireGapFor(level))} ms cycle`,
            `${Math.round(voidMiningMultFor(level) * 100)}% cut time`
        ]
    },
    {
        id: 'targeting', name: 'Targeting Suite', icon: 'i-lucide-scan-line',
        description: 'Reach and precision. Longer weapon and beam range means cutting a rock from outside a Lancer\'s comfort zone.',
        funding: 'salvage', maxLevel: 14,
        baseCredits: 140_000, creditGrowth: 1.95, resourceStep: { scrap: 16, circuitry: 4 },
        format: level => [
            `${Math.round(voidWeaponRangeFor(level))} m weapon`,
            `${Math.round(voidMiningRangeFor(level))} m beam`,
            `+${(voidCritFor(level) * 100).toFixed(1)}% crit`
        ]
    },
    {
        id: 'thrusters', name: 'Ion Thrusters', icon: 'i-lucide-rocket',
        description: 'Cruise and burn speed. The cheapest way to stop dying to things you could simply have left behind.',
        funding: 'salvage', maxLevel: 16,
        baseCredits: 100_000, creditGrowth: 1.76, resourceStep: { scrap: 13 },
        format: level => [`${Math.round(voidSpeedFor(level))} m/s`]
    },
    {
        id: 'plating', name: 'Hull Plating', icon: 'i-lucide-shield-half',
        description: 'Raw hit points. The storm burns a percentage of max hull, so plating buys time in the gas too.',
        funding: 'ore', maxLevel: 20,
        baseCredits: 100_000, creditGrowth: 1.6, resourceStep: { ferrite: 24 },
        format: level => [`${voidHullFor(level)} hp`]
    },
    {
        id: 'deflector', name: 'Deflector Lattice', icon: 'i-lucide-shield',
        description: 'A regenerating buffer that soaks hits first and recharges after four seconds without being touched.',
        funding: 'ore', maxLevel: 14,
        baseCredits: 200_000, creditGrowth: 1.95, resourceStep: { ferrite: 18, cobalt: 7 },
        format: level => level === 0
            ? ['No shield']
            : [`${voidShieldFor(level)} shield`, `${voidShieldRegenFor(level).toFixed(1)}/s regen`]
    },
    {
        id: 'hold', name: 'Cargo Braces', icon: 'i-lucide-package',
        description: 'How much you can carry before the hold locks out. A full hold means every rock you cut is wasted.',
        funding: 'ore', maxLevel: 16,
        baseCredits: 150_000, creditGrowth: 1.78, resourceStep: { ferrite: 20, cobalt: 5 },
        format: level => [`${voidCargoFor(level)} units`]
    },
    {
        id: 'refinery', name: 'Refinery Module', icon: 'i-lucide-flask-conical',
        description: 'Pulls more out of everything you break — ore per rock, salvage per wreck — and squeezes a better price out of the dock.',
        funding: 'ore', maxLevel: 14,
        baseCredits: 240_000, creditGrowth: 2, resourceStep: { cobalt: 12, iridium: 3 },
        format: level => [
            `+${Math.round((voidOreYieldFor(level) - 1) * 100)}% ore`,
            `+${Math.round((voidSalvageYieldFor(level) - 1) * 100)}% salvage`,
            `+${Math.round((voidMarketMultFor(level) - 1) * 100)}% sale price`
        ]
    }
]

export const VOID_UPGRADE_IDS = VOID_UPGRADES.map(u => u.id)

export function voidUpgrade(id: string): VoidUpgradeDefinition {
    return VOID_UPGRADES.find(u => u.id === id) ?? VOID_UPGRADES[0]!
}

export type VoidUpgradeLevels = Record<VoidUpgradeId, number>

/**
 * The old split of nine tracks (separate weapon, reload and mining lines)
 * folded down into these seven. Anyone who already bought levels keeps them:
 * the merged tracks take the best of what fed into them rather than the sum,
 * so nobody is retroactively handed free levels either.
 */
const VOID_LEGACY_UPGRADE_IDS: Record<VoidUpgradeId, string[]> = {
    thrusters: ['engine'],
    weaponCore: ['weapon', 'reload', 'miningSpeed'],
    targeting: ['miningRange'],
    plating: ['hull'],
    deflector: ['shield'],
    hold: ['cargo'],
    refinery: ['oreYield']
}

export function voidNormalizeLevels(levels: Partial<Record<string, number>> | null | undefined): VoidUpgradeLevels {
    const read = (key: string) => {
        const raw = Math.floor(Number(levels?.[key] ?? 0))
        return Number.isFinite(raw) ? Math.max(0, raw) : 0
    }
    const out = {} as VoidUpgradeLevels
    for (const upgrade of VOID_UPGRADES) {
        const legacy = VOID_LEGACY_UPGRADE_IDS[upgrade.id].map(read)
        const level = Math.max(read(upgrade.id), ...legacy)
        out[upgrade.id] = Math.min(upgrade.maxLevel, level)
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
        resources[resourceId] = Math.round(step * (level + 1) * (1 + level * 0.3))
    }
    return { credits, resources }
}

// ─── Modules (the gun and the mining laser, in one box) ─────────────────────

export type VoidRarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'unique'

export interface VoidRarityDefinition {
    id: VoidRarityId
    name: string
    color: number
    hex: string
    affixCount: number
    /** Every affix roll is multiplied by this. */
    power: number
    cost: { credits: number, resources: VoidResourceBundle }
    guaranteedSpecial?: boolean
}

export const VOID_RARITIES = [
    { id: 'common', name: 'Common', color: 0x94a3b8, hex: '#94a3b8', affixCount: 2, power: 1, cost: { credits: 250_000, resources: { scrap: 22 } } },
    { id: 'uncommon', name: 'Uncommon', color: 0x4ade80, hex: '#4ade80', affixCount: 3, power: 1.5, cost: { credits: 900_000, resources: { scrap: 75 } } },
    { id: 'rare', name: 'Rare', color: 0x60a5fa, hex: '#60a5fa', affixCount: 4, power: 2.2, cost: { credits: 4_000_000, resources: { scrap: 190, circuitry: 22 } } },
    { id: 'epic', name: 'Epic', color: 0xc084fc, hex: '#c084fc', affixCount: 5, power: 3.2, cost: { credits: 20_000_000, resources: { scrap: 400, circuitry: 85 } } },
    { id: 'legendary', name: 'Legendary', color: 0xfbbf24, hex: '#fbbf24', affixCount: 6, power: 4.5, cost: { credits: 90_000_000, resources: { circuitry: 240, warpCore: 5 } } },
    { id: 'unique', name: 'Unique', color: 0xf43f5e, hex: '#f43f5e', affixCount: 7, power: 6.2, cost: { credits: 400_000_000, resources: { circuitry: 650, warpCore: 28 } }, guaranteedSpecial: true }
] as const satisfies readonly VoidRarityDefinition[]

export function voidRarity(id: string): VoidRarityDefinition {
    return VOID_RARITIES.find(r => r.id === id) ?? VOID_RARITIES[0]
}

export function voidRarityIndex(id: string) {
    const index = VOID_RARITIES.findIndex(r => r.id === id)
    return index < 0 ? 0 : index
}

export type VoidAffixId =
    | 'damage' | 'fireRate' | 'critChance' | 'critDamage' | 'pierce' | 'multishot'
    | 'homing' | 'splash' | 'lifesteal' | 'weaponRange' | 'velocity'
    | 'miningSpeed' | 'miningYield' | 'miningRange'
    | 'salvageYield' | 'creditYield' | 'magnet'
    | 'hullCapacity' | 'shieldCapacity' | 'cargoCapacity' | 'thrust'

export type VoidAffixGroup = 'combat' | 'mining' | 'haul' | 'ship'

export interface VoidAffixDefinition {
    id: VoidAffixId
    name: string
    group: VoidAffixGroup
    /** Roll band before rarity scaling. */
    min: number
    max: number
    integer?: boolean
    /** Minimum rarity index this affix can appear on. */
    minRarity: number
    describe: (value: number) => string
}

export const VOID_AFFIXES: readonly VoidAffixDefinition[] = [
    // ── Combat ──
    { id: 'damage', name: 'Overcharged', group: 'combat', min: 1.8, max: 4.2, minRarity: 0, describe: v => `+${v.toFixed(1)} weapon damage` },
    { id: 'fireRate', name: 'Rapid', group: 'combat', min: 5, max: 12, minRarity: 0, describe: v => `+${Math.round(v)}% fire rate` },
    { id: 'weaponRange', name: 'Extended', group: 'combat', min: 6, max: 14, minRarity: 0, describe: v => `+${Math.round(v)}% weapon range` },
    { id: 'velocity', name: 'Accelerated', group: 'combat', min: 7, max: 16, minRarity: 0, describe: v => `+${Math.round(v)}% projectile speed` },
    { id: 'critChance', name: 'Precise', group: 'combat', min: 2, max: 5.5, minRarity: 1, describe: v => `+${v.toFixed(1)}% crit chance` },
    { id: 'critDamage', name: 'Brutal', group: 'combat', min: 10, max: 24, minRarity: 1, describe: v => `+${Math.round(v)}% crit damage` },
    { id: 'lifesteal', name: 'Vampiric', group: 'combat', min: 0.8, max: 2.1, minRarity: 2, describe: v => `${v.toFixed(1)}% hull leech` },
    { id: 'pierce', name: 'Piercing', group: 'combat', min: 0.9, max: 1.3, integer: true, minRarity: 3, describe: v => `Pierces ${Math.round(v)} extra target${Math.round(v) === 1 ? '' : 's'}` },
    { id: 'multishot', name: 'Scattering', group: 'combat', min: 0.5, max: 0.9, integer: true, minRarity: 3, describe: v => `+${Math.round(v)} projectile${Math.round(v) === 1 ? '' : 's'}` },
    { id: 'homing', name: 'Seeking', group: 'combat', min: 16, max: 38, minRarity: 2, describe: v => `${Math.round(v)}% tracking` },
    { id: 'splash', name: 'Detonating', group: 'combat', min: 11, max: 24, minRarity: 3, describe: v => `${Math.round(v)} m splash` },

    // ── Mining ──
    { id: 'miningSpeed', name: 'Honed', group: 'mining', min: 5, max: 12, minRarity: 0, describe: v => `−${Math.round(v)}% cut time` },
    { id: 'miningYield', name: 'Rich Seam', group: 'mining', min: 5, max: 13, minRarity: 0, describe: v => `+${Math.round(v)}% ore per rock` },
    { id: 'miningRange', name: 'Far Beam', group: 'mining', min: 7, max: 17, minRarity: 1, describe: v => `+${Math.round(v)}% beam range` },

    // ── Haul ──
    { id: 'salvageYield', name: 'Scavenging', group: 'haul', min: 6, max: 15, minRarity: 0, describe: v => `+${Math.round(v)}% salvage from kills` },
    { id: 'creditYield', name: 'Profiteering', group: 'haul', min: 4, max: 10, minRarity: 1, describe: v => `+${Math.round(v)}% market prices` },
    { id: 'magnet', name: 'Magnetic', group: 'haul', min: 8, max: 20, minRarity: 1, describe: v => `+${Math.round(v)}% pickup radius` },

    // ── Ship ──
    { id: 'hullCapacity', name: 'Reinforced', group: 'ship', min: 4, max: 10, minRarity: 1, describe: v => `+${Math.round(v)}% max hull` },
    { id: 'shieldCapacity', name: 'Warded', group: 'ship', min: 6, max: 15, minRarity: 2, describe: v => `+${Math.round(v)}% max shield` },
    { id: 'cargoCapacity', name: 'Cavernous', group: 'ship', min: 5, max: 12, minRarity: 2, describe: v => `+${Math.round(v)}% cargo hold` },
    { id: 'thrust', name: 'Overtuned', group: 'ship', min: 3, max: 8, minRarity: 2, describe: v => `+${Math.round(v)}% top speed` }
]

export function voidAffix(id: string): VoidAffixDefinition {
    return VOID_AFFIXES.find(a => a.id === id) ?? VOID_AFFIXES[0]!
}

export const VOID_AFFIX_GROUP_LABEL: Record<VoidAffixGroup, string> = {
    combat: 'Combat',
    mining: 'Mining',
    haul: 'Haul',
    ship: 'Ship'
}

export type VoidSpecialId = 'rocket-conversion' | 'chain-arc' | 'railgun' | 'swarm-drones' | 'void-siphon' | 'singularity' | 'harvester' | 'prospectors-eye'

export interface VoidSpecialDefinition {
    id: VoidSpecialId
    name: string
    description: string
    icon: string
}

export const VOID_SPECIALS: readonly VoidSpecialDefinition[] = [
    {
        id: 'rocket-conversion', name: 'Warhead Conversion', icon: 'i-lucide-rocket',
        description: 'Every barrel on the ship fires rockets — 60% more damage in a 70 m blast, at a 25% slower cycle.'
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
        description: 'Three drones orbit your hull and independently engage anything within 420 m.'
    },
    {
        id: 'void-siphon', name: 'Void Siphon', icon: 'i-lucide-droplet',
        description: '10% of damage dealt repairs your hull, and kills cough up a bonus ore fragment straight into the hold.'
    },
    {
        id: 'singularity', name: 'Collapse Core', icon: 'i-lucide-circle-dot',
        description: 'Every kill leaves a two-second singularity that drags nearby ships in and grinds them down.'
    },
    {
        id: 'harvester', name: 'Harvest Protocol', icon: 'i-lucide-combine',
        description: 'The cutting beam finishes rocks 35% faster and strips a second, smaller rock in range at the same time.'
    },
    {
        id: 'prospectors-eye', name: "Prospector's Eye", icon: 'i-lucide-eye',
        description: 'Every rock you crack has a 30% chance to yield one unit of the next ore tier up, on top of its normal haul.'
    }
]

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

const VOID_MODULE_NOUNS = ['Repeater', 'Autocannon', 'Lance', 'Pulser', 'Driver', 'Scattergun', 'Emitter', 'Battery', 'Fang', 'Needle', 'Cutter', 'Rig', 'Bore', 'Reaper']
const VOID_MODULE_PREFIXES = ['Halcyon', 'Cinder', 'Nix', 'Umbral', 'Karrow', 'Deep', 'Sable', 'Vex', 'Orbital', 'Broken', 'Hollow', 'Ashen']

export function rollVoidWeapon(rarityId: VoidRarityId, rng: () => number = randomFloat): Omit<VoidWeaponInstance, 'id' | 'slotIndex'> {
    const rarity = voidRarity(rarityId)
    const index = voidRarityIndex(rarityId)
    const available = VOID_AFFIXES.filter(a => a.minRarity <= index)
    const chosen: VoidAffixDefinition[] = []
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

    const prefix = VOID_MODULE_PREFIXES[Math.floor(rng() * VOID_MODULE_PREFIXES.length)]!
    const noun = VOID_MODULE_NOUNS[Math.floor(rng() * VOID_MODULE_NOUNS.length)]!
    const name = specialId ? `${prefix} ${voidSpecial(specialId)!.name}` : `${prefix} ${noun}`

    return { rarityId, name, affixes, specialId }
}

/** Stripping a module returns this fraction of what its rarity costs to buy. */
export const VOID_SALVAGE_RATE = 0.18

export function voidSalvageValue(rarityId: VoidRarityId) {
    const cost = voidRarity(rarityId).cost
    const resources: VoidResourceBundle = {}
    for (const [id, amount] of Object.entries(cost.resources) as [VoidResourceId, number][]) {
        const value = Math.max(1, Math.round(amount * VOID_SALVAGE_RATE))
        resources[id] = value
    }
    return { credits: Math.round(cost.credits * VOID_SALVAGE_RATE), resources }
}

// ─── Boss loot ──────────────────────────────────────────────────────────────

/** Chance that a downed capital coughs up a whole module. */
export const VOID_BOSS_MODULE_DROP_CHANCE = 0.4

/**
 * What a capital can drop, by sector. Deeper sectors don't just drop *more* —
 * they drop *better*, which is the main reason to push into a tier that can
 * kill you rather than farming a safe one.
 */
const VOID_BOSS_DROP_TABLE: Record<number, readonly (readonly [VoidRarityId, number])[]> = {
    1: [['common', 56], ['uncommon', 32], ['rare', 11], ['epic', 1]],
    2: [['common', 26], ['uncommon', 42], ['rare', 24], ['epic', 7], ['legendary', 1]],
    3: [['uncommon', 26], ['rare', 40], ['epic', 26], ['legendary', 7], ['unique', 1]],
    4: [['rare', 24], ['epic', 40], ['legendary', 30], ['unique', 6]]
}

export function voidBossDropTable(tier: number) {
    return VOID_BOSS_DROP_TABLE[Math.max(1, Math.min(VOID_MAX_SECTOR, tier))] ?? VOID_BOSS_DROP_TABLE[1]!
}

export function voidRollBossModuleRarity(tier: number, rng: () => number = randomFloat): VoidRarityId {
    const table = voidBossDropTable(tier)
    return randomWeighted(table, entry => entry[1], rng)[0]
}

/**
 * A single readable score for a module, so the inventory can sort and the
 * player can tell at a glance whether a new drop beats what's mounted.
 */
export function voidModuleScore(weapon: VoidWeaponInstance) {
    const rarityWeight = (voidRarityIndex(weapon.rarityId) + 1) ** 1.35
    const affixWeight = Object.values(weapon.affixes).reduce<number>((sum, value) => sum + (value ?? 0), 0)
    return Math.round(rarityWeight * 8 + affixWeight * 1.6 + (weapon.specialId ? 40 : 0))
}

// ─── Loadout resolution ─────────────────────────────────────────────────────

export interface VoidDerivedStats {
    maxHull: number
    maxShield: number
    shieldRegenPerSec: number
    speed: number
    turnRate: number
    cargoCapacity: number
    damage: number
    fireGapMs: number
    weaponRange: number
    projectileSpeed: number
    critChance: number
    critDamage: number
    pierce: number
    multishot: number
    homing: number
    splash: number
    lifesteal: number
    miningRange: number
    miningTimeMult: number
    oreYieldMult: number
    salvageYieldMult: number
    marketPriceMult: number
    magnetRange: number
    turretSlots: number
    specialIds: VoidSpecialId[]
}

export interface VoidLoadoutInput {
    levels: VoidUpgradeLevels
    shipId: string
    weapons: VoidWeaponInstance[]
}

/**
 * Every mounted module contributes its whole affix sheet to the ship — combat
 * rolls, mining rolls and haul rolls alike. Modules are not independent guns
 * with independent stats; they are the ship's weapon-and-laser system, and
 * mounting a second one makes the first one better too.
 */
export function voidDerivedStats(input: VoidLoadoutInput): VoidDerivedStats {
    const ship = voidShip(input.shipId)
    const levels = input.levels
    const mounted = input.weapons.filter(w => w.slotIndex !== null && w.slotIndex < ship.turretSlots)

    const sum = (id: VoidAffixId) => mounted.reduce((total, weapon) => total + (weapon.affixes[id] ?? 0), 0)
    const pct = (id: VoidAffixId) => sum(id) / 100

    const specialIds = Array.from(new Set(mounted.map(w => w.specialId).filter((id): id is VoidSpecialId => Boolean(id))))
    const harvester = specialIds.includes('harvester')

    return {
        maxHull: Math.round(voidHullFor(levels.plating) * ship.hullMult * (1 + pct('hullCapacity'))),
        maxShield: Math.round(voidShieldFor(levels.deflector) * ship.hullMult * (1 + pct('shieldCapacity'))),
        shieldRegenPerSec: voidShieldRegenFor(levels.deflector),
        speed: voidSpeedFor(levels.thrusters) * ship.speedMult * (1 + pct('thrust')),
        turnRate: VOID_BASE_TURN_RATE * ship.turnMult,
        cargoCapacity: Math.round(voidCargoFor(levels.hold) * ship.cargoMult * (1 + pct('cargoCapacity'))),

        damage: voidDamageFor(levels.weaponCore) + sum('damage'),
        fireGapMs: Math.max(70, voidFireGapFor(levels.weaponCore) / (1 + pct('fireRate'))),
        weaponRange: voidWeaponRangeFor(levels.targeting) * (1 + pct('weaponRange')),
        projectileSpeed: VOID_BASE_PROJECTILE_SPEED * (1 + pct('velocity')),
        critChance: Math.min(0.85, voidCritFor(levels.targeting) + pct('critChance')),
        critDamage: 1.5 + pct('critDamage'),
        pierce: Math.round(sum('pierce')),
        multishot: Math.round(sum('multishot')),
        homing: Math.min(1, pct('homing')),
        splash: sum('splash'),
        lifesteal: pct('lifesteal'),

        miningRange: voidMiningRangeFor(levels.targeting) * (1 + pct('miningRange')),
        miningTimeMult: Math.max(0.12, voidMiningMultFor(levels.weaponCore) * ship.miningMult * (1 - pct('miningSpeed')) * (harvester ? 0.65 : 1)),
        oreYieldMult: voidOreYieldFor(levels.refinery) * (1 + pct('miningYield')),
        salvageYieldMult: voidSalvageYieldFor(levels.refinery) * (1 + pct('salvageYield')),
        marketPriceMult: voidMarketMultFor(levels.refinery) * (1 + pct('creditYield')),
        magnetRange: VOID_BASE_MAGNET_RANGE * (1 + pct('magnet')),

        turretSlots: ship.turretSlots,
        specialIds
    }
}

/** What each mounted module looks like as an auto-turret. */
export interface VoidTurretRuntime {
    id: string
    rarityId: VoidRarityId
    name: string
    color: number
    /** Turrets fire the ship's pooled damage at a reduced rate — they support, they don't replace your trigger. */
    damage: number
    fireGapMs: number
    range: number
}

export const VOID_TURRET_DAMAGE_SHARE = 0.5
export const VOID_TURRET_CYCLE_MULT = 2.1

export function voidTurretRuntime(weapon: VoidWeaponInstance, stats: VoidDerivedStats): VoidTurretRuntime {
    return {
        id: weapon.id,
        rarityId: weapon.rarityId,
        name: weapon.name,
        color: voidRarity(weapon.rarityId).color,
        damage: stats.damage * VOID_TURRET_DAMAGE_SHARE,
        fireGapMs: stats.fireGapMs * VOID_TURRET_CYCLE_MULT,
        range: stats.weaponRange * 0.85
    }
}

// ─── Power level ────────────────────────────────────────────────────────────

/** A single number the hangar uses to say "this sector will kill you". */
export function voidPowerLevel(input: VoidLoadoutInput) {
    const levels = input.levels
    const upgradeScore = VOID_UPGRADES.reduce((sum, def) => sum + levels[def.id] * (def.funding === 'salvage' ? 2.4 : 2), 0)
    const ship = voidShip(input.shipId)
    const shipScore = (ship.hullMult + ship.speedMult + ship.cargoMult * 0.4) * 6
        + ship.turretSlots * 4
        + (ship.barrels - 1) * 5
    const moduleScore = input.weapons
        .filter(w => w.slotIndex !== null)
        .reduce((sum, w) => sum + voidModuleScore(w) * 0.18, 0)
    return Math.round(upgradeScore + shipScore + moduleScore)
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
//
// There is no coin payout for a run. What you extract is material, and the only
// anti-cheat ceiling that matters is the hold you launched with — you cannot
// bank more units than the ship could physically carry.

export function voidMaxResourceUnitsForRun(cargoCapacity: number) {
    return Math.max(0, Math.floor(cargoCapacity))
}

export function voidRollDrop(min: number, max: number) {
    return randomInt(min, max)
}
