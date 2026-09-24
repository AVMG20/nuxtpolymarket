// Holdfast — every tunable number lives here. The sim, the UI and the balance
// script all read from these tables, so a rebalance is a one-file change.

import type { HoldfastDifficulty } from './meta'

export type Resource = 'gold' | 'wood' | 'stone' | 'crystal'
export type Cost = Partial<Record<Resource, number>>
export type Resources = Record<Resource, number>

export const RESOURCES: readonly Resource[] = ['gold', 'wood', 'stone', 'crystal']

export type BuildingKind
    = | 'keep'
      | 'goldmine'
      | 'lumbercamp'
      | 'stonemason'
      | 'crystalmine'
      | 'barracks'
      | 'range'
      | 'tower'
      | 'wall'
      | 'gate'

export type UnitKind = 'warrior' | 'archer' | 'knight' | 'catapult' | 'ram' | 'siegetower'

export type UpgradeId
    = | 'warriorDrill'
      | 'warriorSteel'
      | 'archerDrill'
      | 'archerBows'
      | 'knightArmor'
      | 'catapultPayload'
      | 'masonry'
      | 'prosperity'
      | 'fletching'

/** Seconds per simulation tick. The sim is fixed-step; rendering interpolates. */
export const TICK = 0.05
export const MAP_SIZE = 72
/** Tiles along the edge kept free of buildings so spawns never land inside a base. */
export const EDGE_MARGIN = 3

export const START_RESOURCES: Resources = { gold: 260, wood: 150, stone: 0, crystal: 0 }

export interface Production {
    resource: Resource
    /** Per second, per building level. */
    rate: readonly number[]
    /** Converters eat another resource: `ratio` input per output. */
    consumes?: { resource: Resource, ratio: number }
}

export interface Attack {
    damage: readonly number[]
    range: readonly number[]
    cooldown: number
}

export interface BuildingDef {
    kind: BuildingKind
    name: string
    blurb: string
    icon: string
    /** Square footprint in tiles. */
    size: number
    hp: readonly number[]
    cost: Cost
    /** Each extra building of this kind costs this much more (compounding). */
    scale: number
    /** upgrade[i] is the cost of going from level i+1 to level i+2. */
    upgrade: readonly Cost[]
    /** Keep level needed to build it. */
    keepLevel: number
    /** Keep level needed per upgrade step (defaults to 1). */
    upgradeKeepLevel?: readonly number[]
    produces?: Production
    attack?: Attack
    max?: number
    /** Walls and gates: 1x1, drawn as a line, friendly units can climb them. */
    segment?: boolean
    /** Extra pack cap this building grants. */
    packCap?: number
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
    keep: {
        kind: 'keep',
        name: 'Keep',
        blurb: 'Your heart. If it falls, the run is over. Upgrading unlocks new buildings, more packs and a wider territory.',
        icon: 'i-lucide-castle',
        size: 4,
        hp: [2600, 4000, 5600],
        cost: {},
        scale: 1,
        upgrade: [{ gold: 300, wood: 220 }, { gold: 700, stone: 220 }],
        keepLevel: 1,
        attack: { damage: [12, 16, 22], range: [9, 10, 11], cooldown: 1.2 },
        max: 1
    },
    goldmine: {
        kind: 'goldmine',
        name: 'Gold Mine',
        blurb: 'Digs up gold. Upgrading is cheaper than building another.',
        icon: 'i-lucide-pickaxe',
        size: 2,
        hp: [380, 480, 580, 700, 820],
        cost: { gold: 100, wood: 70 },
        scale: 1.75,
        upgrade: [{ gold: 80, wood: 70 }, { gold: 160, wood: 110 }, { gold: 280, stone: 50 }, { gold: 440, stone: 100 }],
        keepLevel: 1,
        upgradeKeepLevel: [1, 1, 2, 2],
        produces: { resource: 'gold', rate: [4, 5.8, 7.8, 10, 12.5] }
    },
    lumbercamp: {
        kind: 'lumbercamp',
        name: 'Lumber Camp',
        blurb: 'Chops wood for walls and buildings.',
        icon: 'i-lucide-axe',
        size: 2,
        hp: [320, 420, 520, 620, 740],
        cost: { gold: 90 },
        scale: 1.75,
        upgrade: [{ gold: 100 }, { gold: 180, wood: 40 }, { gold: 300, stone: 30 }, { gold: 460, stone: 70 }],
        keepLevel: 1,
        upgradeKeepLevel: [1, 1, 2, 2],
        produces: { resource: 'wood', rate: [2.8, 4.1, 5.6, 7.3, 9.2] }
    },
    stonemason: {
        kind: 'stonemason',
        name: 'Stonemason',
        blurb: 'Cuts wood into stone for sturdier walls, towers, knights and upgrades.',
        icon: 'i-lucide-hammer',
        size: 2,
        hp: [480, 600, 740, 900],
        cost: { gold: 200, wood: 120 },
        scale: 1.8,
        upgrade: [{ gold: 200, wood: 100 }, { gold: 340, wood: 160 }, { gold: 520, crystal: 20 }],
        keepLevel: 2,
        produces: { resource: 'stone', rate: [1.1, 1.6, 2.2, 3], consumes: { resource: 'wood', ratio: 1.5 } }
    },
    crystalmine: {
        kind: 'crystalmine',
        name: 'Crystal Mine',
        blurb: 'Grows crystals, the fuel for every upgrade.',
        icon: 'i-lucide-gem',
        size: 2,
        hp: [520, 650, 800, 960],
        cost: { gold: 280, stone: 70 },
        scale: 2,
        upgrade: [{ gold: 280, stone: 80 }, { gold: 460, stone: 140 }, { gold: 720, stone: 220 }],
        keepLevel: 2,
        produces: { resource: 'crystal', rate: [0.22, 0.32, 0.44, 0.58] }
    },
    barracks: {
        kind: 'barracks',
        name: 'Barracks',
        blurb: 'Trains knights and better warriors: bigger packs, tougher steel. +1 pack cap.',
        icon: 'i-lucide-shield',
        size: 3,
        hp: [800],
        cost: { gold: 120, wood: 130 },
        scale: 2.2,
        upgrade: [],
        keepLevel: 1,
        packCap: 1
    },
    range: {
        kind: 'range',
        name: 'Archery Range',
        blurb: 'Builds catapults and trains better archers: bigger packs, longer bows. +1 pack cap.',
        icon: 'i-lucide-target',
        size: 3,
        hp: [700],
        cost: { gold: 120, wood: 130 },
        scale: 2.2,
        upgrade: [],
        keepLevel: 1,
        packCap: 1
    },
    tower: {
        kind: 'tower',
        name: 'Watchtower',
        blurb: 'Looses arrows at anything in range, and archers near it fight harder. Upgraded towers fire heavy bolts; the last level bolts burst.',
        icon: 'i-lucide-tower-control',
        size: 2,
        hp: [600, 900, 1300, 1800],
        cost: { gold: 140, wood: 90 },
        scale: 1.5,
        upgrade: [{ gold: 180, stone: 60 }, { gold: 300, stone: 120, crystal: 10 }, { gold: 480, stone: 200, crystal: 30 }],
        keepLevel: 1,
        upgradeKeepLevel: [2, 2, 3],
        attack: { damage: [11, 17, 25, 34], range: [9, 10, 11, 12], cooldown: 1.05 }
    },
    wall: {
        kind: 'wall',
        name: 'Wall',
        blurb: 'Drag to draw. Wood, then stone, then fortified. Your archers can climb it, enemies must break it.',
        icon: 'i-lucide-brick-wall',
        size: 1,
        hp: [260, 800, 1700],
        cost: { wood: 6 },
        scale: 1,
        upgrade: [{ stone: 6 }, { stone: 12, gold: 8 }],
        keepLevel: 1,
        upgradeKeepLevel: [1, 3],
        segment: true
    },
    gate: {
        kind: 'gate',
        name: 'Gate',
        blurb: 'Your units walk through it, enemies have to break it. Warriors dropped next to a gate hold it.',
        icon: 'i-lucide-door-open',
        size: 1,
        hp: [360, 1000, 2100],
        cost: { wood: 20 },
        scale: 1,
        upgrade: [{ stone: 18 }, { stone: 30, gold: 20 }],
        keepLevel: 1,
        upgradeKeepLevel: [1, 3],
        segment: true
    }
}

/** Toolbar order. */
export const BUILD_ORDER: readonly BuildingKind[] = ['goldmine', 'lumbercamp', 'wall', 'gate', 'tower', 'barracks', 'range', 'stonemason', 'crystalmine']

export const WALL_TIER_NAMES = ['Wood', 'Stone', 'Fortified'] as const

/** Territory radius (tiles from the keep centre) per keep level. */
export const TERRITORY = [13, 17, 21] as const
/** Pack cap from the keep level; barracks and ranges add their own. */
export const KEEP_PACK_CAP = [3, 5, 7] as const

export interface UnitDef {
    kind: UnitKind
    name: string
    icon: string
    hp: number
    damage: number
    cooldown: number
    /** Melee reach or bow range, in tiles. */
    range: number
    /** Ranged units can't shoot anything closer than this. */
    minRange: number
    speed: number
    /** How far a unit notices enemies. */
    aggro: number
    /** How far a friendly unit strays from its post to fight. */
    leash: number
    radius: number
    cost: Cost
    /** Soldiers in a fresh pack. */
    packSize: number
    /** Building the player needs before fielding this unit. */
    requires?: BuildingKind
    /** Raider-only war machine: the player can't field it. */
    enemyOnly?: boolean
    ranged: boolean
    /** Share of arrow damage shrugged off. */
    armor: number
    /** How far a melee hit shoves its target. */
    knock: number
    /** Damage per shot against structures (siege engines only). */
    siege?: number
    /** Blast radius of each shot (siege engines only). */
    splash?: number
}

export const UNITS: Record<UnitKind, UnitDef> = {
    warrior: {
        kind: 'warrior',
        name: 'Warriors',
        icon: 'i-lucide-sword',
        hp: 100,
        damage: 10,
        cooldown: 0.9,
        range: 0.55,
        minRange: 0,
        speed: 2.7,
        aggro: 5,
        leash: 6,
        radius: 0.3,
        cost: { gold: 70, wood: 20 },
        packSize: 6,
        ranged: false,
        armor: 0,
        knock: 0.1
    },
    archer: {
        kind: 'archer',
        name: 'Archers',
        icon: 'i-lucide-bow-arrow',
        hp: 45,
        damage: 8,
        cooldown: 1.35,
        range: 8,
        minRange: 0,
        speed: 2.6,
        aggro: 9.5,
        leash: 3,
        radius: 0.28,
        cost: { gold: 75, wood: 35 },
        packSize: 6,
        ranged: true,
        armor: 0,
        knock: 0.03
    },
    knight: {
        kind: 'knight',
        name: 'Knights',
        icon: 'i-lucide-shield-half',
        hp: 240,
        damage: 20,
        cooldown: 1,
        range: 0.6,
        minRange: 0,
        speed: 2.15,
        aggro: 7,
        leash: 8,
        radius: 0.34,
        cost: { gold: 180, wood: 30, stone: 20 },
        packSize: 4,
        requires: 'barracks',
        ranged: false,
        armor: 0.3,
        knock: 0.18
    },
    catapult: {
        kind: 'catapult',
        name: 'Catapults',
        icon: 'i-lucide-rocket',
        hp: 260,
        damage: 30,
        cooldown: 4,
        range: 11,
        minRange: 3,
        speed: 1.35,
        aggro: 11,
        leash: 2,
        radius: 0.5,
        cost: { gold: 240, wood: 160, stone: 30 },
        packSize: 2,
        requires: 'range',
        ranged: true,
        armor: 0.2,
        knock: 0,
        siege: 90,
        splash: 1.1
    },
    ram: {
        kind: 'ram',
        name: 'Battering Ram',
        icon: 'i-lucide-hammer',
        hp: 600,
        damage: 0,
        cooldown: 1.6,
        range: 0.6,
        minRange: 0,
        speed: 1.2,
        aggro: 0,
        leash: 0,
        radius: 0.5,
        cost: {},
        packSize: 1,
        enemyOnly: true,
        ranged: false,
        armor: 0.75,
        knock: 0,
        siege: 60
    },
    siegetower: {
        kind: 'siegetower',
        name: 'Siege Tower',
        icon: 'i-lucide-castle',
        hp: 500,
        damage: 0,
        cooldown: 1,
        range: 0.2,
        minRange: 0,
        speed: 1,
        aggro: 0,
        leash: 0,
        radius: 0.6,
        cost: {},
        packSize: 1,
        enemyOnly: true,
        ranged: false,
        armor: 0.5,
        knock: 0
    }
}

/** Deploy menu order. */
export const UNIT_ORDER: readonly UnitKind[] = ['warrior', 'archer', 'knight', 'catapult']

/** Pack size of warriors and archers before drills (kept for older readers; see UnitDef.packSize). */
export const BASE_PACK_SIZE = 6
/** Archers standing on a wall shoot further. */
export const WALL_RANGE_BONUS = 2
export const ARROW_SPEED = 15
export const BOLT_SPEED = 22
export const BOULDER_SPEED = 8
/** Refund share when demolishing. */
export const SELL_REFUND = 0.5
/** Repairing costs this share of the building's total spend, scaled by missing hp. */
export const REPAIR_SHARE = 0.4

export interface UpgradeDef {
    id: UpgradeId
    name: string
    blurb: string
    icon: string
    building: BuildingKind
    cost: readonly Cost[]
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
    warriorDrill: {
        id: 'warriorDrill',
        name: 'Shield Drill',
        blurb: '+2 warriors per pack. Same price.',
        icon: 'i-lucide-users',
        building: 'barracks',
        cost: [{ gold: 200, crystal: 15 }, { gold: 340, crystal: 35 }, { gold: 540, crystal: 70 }]
    },
    warriorSteel: {
        id: 'warriorSteel',
        name: 'Tempered Steel',
        blurb: '+20% warrior health and damage.',
        icon: 'i-lucide-sword',
        building: 'barracks',
        cost: [{ gold: 180, crystal: 12 }, { gold: 320, crystal: 30 }, { gold: 520, crystal: 60 }]
    },
    archerDrill: {
        id: 'archerDrill',
        name: 'Volunteer Bowmen',
        blurb: '+2 archers per pack. Same price.',
        icon: 'i-lucide-users',
        building: 'range',
        cost: [{ gold: 200, crystal: 15 }, { gold: 340, crystal: 35 }, { gold: 540, crystal: 70 }]
    },
    archerBows: {
        id: 'archerBows',
        name: 'Yew Longbows',
        blurb: '+20% archer damage and +0.75 range.',
        icon: 'i-lucide-bow-arrow',
        building: 'range',
        cost: [{ gold: 180, crystal: 12 }, { gold: 320, crystal: 30 }, { gold: 520, crystal: 60 }]
    },
    knightArmor: {
        id: 'knightArmor',
        name: 'Plate Armour',
        blurb: '+25% knight health, +10% damage and thicker plate against arrows.',
        icon: 'i-lucide-shield-half',
        building: 'barracks',
        cost: [{ gold: 220, stone: 40, crystal: 15 }, { gold: 400, stone: 90, crystal: 40 }]
    },
    catapultPayload: {
        id: 'catapultPayload',
        name: 'Heavy Payload',
        blurb: '+30% catapult damage and a wider blast.',
        icon: 'i-lucide-bomb',
        building: 'range',
        cost: [{ gold: 220, wood: 120, crystal: 15 }, { gold: 400, stone: 100, crystal: 40 }]
    },
    masonry: {
        id: 'masonry',
        name: 'Masonry',
        blurb: '+30% health for walls, gates and towers, and they patch themselves faster.',
        icon: 'i-lucide-brick-wall',
        building: 'stonemason',
        cost: [{ gold: 160, stone: 60, crystal: 10 }, { gold: 320, stone: 150, crystal: 40 }]
    },
    prosperity: {
        id: 'prosperity',
        name: 'Prosperity',
        blurb: '+15% production from every building.',
        icon: 'i-lucide-trending-up',
        building: 'keep',
        cost: [{ gold: 220, crystal: 15 }, { gold: 420, crystal: 40 }, { gold: 700, crystal: 80 }]
    },
    fletching: {
        id: 'fletching',
        name: 'Fire Arrows',
        blurb: '+30% damage for the keep and watchtowers.',
        icon: 'i-lucide-flame',
        building: 'tower',
        cost: [{ gold: 200, crystal: 15 }, { gold: 380, crystal: 45 }]
    }
}

export const UPGRADE_ORDER: readonly UpgradeId[] = ['warriorDrill', 'warriorSteel', 'archerDrill', 'archerBows', 'knightArmor', 'catapultPayload', 'prosperity', 'masonry', 'fletching']

// ─── Abilities ───────────────────────────────────────────────────────────

export type AbilityId = 'rally' | 'barrage'

export interface AbilityDef {
    id: AbilityId
    name: string
    blurb: string
    icon: string
    /** Seconds between uses. */
    cooldown: number
    /** Seconds before the first use. */
    readyAt: number
    radius: number
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
    rally: {
        id: 'rally',
        name: 'Rally Horn',
        blurb: 'Soldiers near the horn fight 35% harder, swing 25% faster and march 20% quicker for 10 seconds.',
        icon: 'i-lucide-megaphone',
        cooldown: 60,
        readyAt: 30,
        radius: 9
    },
    barrage: {
        id: 'barrage',
        name: 'Arrow Storm',
        blurb: 'The keep darkens the sky: a storm of arrows rains on the target area.',
        icon: 'i-lucide-cloud-hail',
        cooldown: 45,
        readyAt: 45,
        radius: 2.8
    }
}

export const RALLY_DURATION = 10
export const RALLY_DAMAGE = 1.35
export const RALLY_HASTE = 1.25
export const RALLY_SPEED = 1.2
/** Arrow Storm: arrows per storm, damage each, and how far past the territory it reaches. */
export const BARRAGE = { arrows: 36, damage: 16, reach: 6 } as const

// ─── Enemies ─────────────────────────────────────────────────────────────

export interface Lane {
    x: number
    z: number
    /** Minute this lane starts sending packs. */
    opensAt: number
}

export interface DifficultyDef {
    id: HoldfastDifficulty
    name: string
    blurb: string
    keep: { x: number, z: number }
    lanes: readonly Lane[]
    /** Enemy packs per wave grow by one every this many minutes. */
    packsEvery: number
    extraPacks: number
    /** Enemy pack size grows by one every this many minutes. */
    sizeEvery: number
    /** Enemy stat growth per minute. */
    growth: number
    /**
     * How clever the raiders are, 0..1: the chance a pack picks the weakest
     * wall segment to breach, and how strongly waves lean on the
     * least-defended lane.
     */
    cunning: number
    /** Minute raiders start flanking round the walls (Infinity = never). */
    flankFrom: number
    /** Share of packs that flank once they do. */
    flankChance: number
    /** Minute raider knights join the waves. */
    knightsFrom: number
    /** Minute raider catapults join the waves. */
    catapultsFrom: number
    /** Minute battering rams join the waves. */
    ramsFrom: number
    /** Minute siege towers join the waves. */
    towersFrom: number
}

const M = MAP_SIZE - 2

export const DIFFICULTIES: Record<HoldfastDifficulty, DifficultyDef> = {
    easy: {
        id: 'easy',
        name: 'Frontier',
        blurb: 'Your keep sits against the cliffs. Raiders only come from the north.',
        keep: { x: 34, z: 58 },
        lanes: [
            { x: 36, z: 1, opensAt: 0 },
            { x: 12, z: 1, opensAt: 5 },
            { x: 60, z: 1, opensAt: 9 }
        ],
        packsEvery: 4.5,
        extraPacks: 0,
        sizeEvery: 3.4,
        growth: 0.03,
        cunning: 0.25,
        flankFrom: Infinity,
        flankChance: 0,
        knightsFrom: 9,
        catapultsFrom: 12,
        ramsFrom: 8,
        towersFrom: 11
    },
    normal: {
        id: 'normal',
        name: 'Borderlands',
        blurb: 'Open ground on three sides. Raiders flank you as the siege drags on.',
        keep: { x: 34, z: 46 },
        lanes: [
            { x: 36, z: 1, opensAt: 0 },
            { x: 1, z: 34, opensAt: 4 },
            { x: M, z: 34, opensAt: 4 },
            { x: 14, z: 1, opensAt: 9 },
            { x: 58, z: 1, opensAt: 9 }
        ],
        packsEvery: 3.6,
        extraPacks: 0,
        sizeEvery: 3,
        growth: 0.036,
        cunning: 0.55,
        flankFrom: 8,
        flankChance: 0.12,
        knightsFrom: 7.5,
        catapultsFrom: 10,
        ramsFrom: 6.5,
        towersFrom: 9
    },
    hard: {
        id: 'hard',
        name: 'Heartland',
        blurb: 'Dead centre of the map. Nowhere to hide, attacks from every side.',
        keep: { x: 34, z: 34 },
        lanes: [
            { x: 36, z: 1, opensAt: 0 },
            { x: 36, z: M, opensAt: 1.5 },
            { x: 1, z: 36, opensAt: 4.5 },
            { x: M, z: 36, opensAt: 4.5 },
            { x: 4, z: 4, opensAt: 9 },
            { x: M - 3, z: M - 3, opensAt: 9 },
            { x: M - 3, z: 4, opensAt: 13 },
            { x: 4, z: M - 3, opensAt: 13 }
        ],
        packsEvery: 3.3,
        extraPacks: 1,
        sizeEvery: 2.8,
        growth: 0.04,
        cunning: 0.85,
        flankFrom: 5,
        flankChance: 0.22,
        knightsFrom: 6.5,
        catapultsFrom: 9,
        ramsFrom: 5.5,
        towersFrom: 8
    }
}

/** Seconds before the first wave. */
export const FIRST_WAVE_AT = 45
/** Warning shown this many seconds before a wave arrives at the map edge. */
export const WAVE_WARNING = 10
/** Seconds between waves at minute m (before the Bloodmoon). */
export function waveInterval(m: number): number {
    return Math.max(24, 38 - m * 0.8)
}
/** Seconds between waves under the Bloodmoon. */
export const BLOODMOON_INTERVAL = 18
/** After this minute the Bloodmoon rises and enemies scale brutally. */
export const BLOODMOON_AT = 20
export const BLOODMOON_GROWTH = 1.32

// ─── Raider traits ───────────────────────────────────────────────────────
// Packs keep their unit kind but can carry a trait that changes how they
// fight. War bands come themed; later waves mix them in.

export type PackTrait = 'none' | 'shieldwall' | 'volley' | 'sappers' | 'berserkers'
export type WaveTheme = 'raid' | 'horde' | Exclude<PackTrait, 'none'>

export interface TraitDef {
    id: PackTrait
    name: string
    /** Which unit kind carries it (null = any). */
    kind: UnitKind | null
    hp: number
    damage: number
    speed: number
    /** Extra share of arrow damage shrugged off. */
    armor: number
    /** Multiplier on damage to structures. */
    siege: number
    range: number
    /** Only fights soldiers in its way: goes straight for the walls. */
    walls: boolean
    /** Breaks and runs when the pack is nearly wiped out. */
    routs: boolean
    /** Multiplier on how far a melee hit shoves its target. */
    knock: number
}

export const TRAITS: Record<PackTrait, TraitDef> = {
    none: { id: 'none', name: 'Raiders', kind: null, hp: 1, damage: 1, speed: 1, armor: 0, siege: 1, range: 0, walls: false, routs: true, knock: 1 },
    shieldwall: { id: 'shieldwall', name: 'Shieldwall', kind: 'warrior', hp: 1.3, damage: 0.9, speed: 0.85, armor: 0.55, siege: 1, range: 0, walls: false, routs: true, knock: 0.8 },
    volley: { id: 'volley', name: 'Longbows', kind: 'archer', hp: 1, damage: 1.1, speed: 1, armor: 0, siege: 1, range: 1, walls: false, routs: true, knock: 1 },
    sappers: { id: 'sappers', name: 'Sappers', kind: 'warrior', hp: 0.75, damage: 0.8, speed: 1.1, armor: 0, siege: 3, range: 0, walls: true, routs: true, knock: 0.8 },
    berserkers: { id: 'berserkers', name: 'Berserkers', kind: 'warrior', hp: 0.9, damage: 1.3, speed: 1.3, armor: 0, siege: 1.2, range: 0, walls: false, routs: false, knock: 1.6 }
}

/** War band themes, in order (every fifth wave is a war band). */
export const WARBAND_THEMES: readonly WaveTheme[] = ['horde', 'shieldwall', 'volley', 'sappers', 'berserkers']

// ─── Combat, rewards and upkeep ──────────────────────────────────────────

/** Most raiders alive at once; later packs wait at the map edge. */
export const MAX_ENEMIES = 700
/** Gold for every raider killed (knights and catapults pay more). */
export const KILL_BOUNTY: Record<UnitKind, number> = { warrior: 1, archer: 1, knight: 4, catapult: 12, ram: 10, siegetower: 10 }
/** Siege towers: seconds to lower the drawbridge, and how far along the wall it lets raiders climb. */
export const SIEGE_TOWER = { deploy: 2, reach: 4 } as const
/** Clearing a wave pays this, scaled by the wave number; a perfect defence pays more. */
export const WAVE_REWARD = { gold: 30, goldPerWave: 7, wood: 15, woodPerWave: 3, perfect: 1.6 } as const
/** Kill streaks: kills chained with less than `window` seconds between them. */
export const STREAK = { window: 2.5, marks: [10, 25, 50, 100, 200], goldPerKill: 1 } as const
/** Supply carts: every so often a chest of resources appears for your soldiers to grab. */
export const LOOT = { first: 150, every: [140, 210], lifetime: 60, pickup: 1.3 } as const
/** A pack down to this share of its soldiers may break and run. */
export const ROUT_SHARE = 0.3
/** Walls, gates and towers patch themselves this share of max hp per second out of combat... */
export const STRUCTURE_REGEN = 0.004
/** ...plus this much per Masonry level... */
export const STRUCTURE_REGEN_MASONRY = 0.004
/** ...once nothing has hit them for this many seconds. */
export const STRUCTURE_REGEN_DELAY = 10
/** Friendly soldiers bind their wounds out of combat (share of max hp per second). */
export const UNIT_REGEN = 0.02
export const UNIT_REGEN_DELAY = 6
/** Archers near a watchtower shoot harder and further. */
export const TOWER_AURA = { radius: 4.5, damage: 0.15, range: 0.5 } as const
/** Chance an arrow misses a target on the move, at full range. */
export const MOVING_MISS = 0.24
/** Chance any arrow goes wide. */
export const BASE_MISS = 0.03
