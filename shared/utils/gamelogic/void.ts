// ─── Void Runner ────────────────────────────────────────────────────────────
//
// A third-person 3D space shooter. You undock from the station at the centre
// of a sector, crack ore out of asteroids, strip wrecks and kill whatever gets
// in the way, then fly back and dock to bank the hold. Die and the hold is gone.
//
// Everything here is shared between the client (the simulation and the
// hangar UI) and the server (costs, caps and settlement). The client decides
// what happened in a run; the server decides what that run was allowed to be
// worth.

import { VOID_LORE, VOID_PERKS, VOID_ZONES, voidAllowedDepth, voidDepthLoot, voidNormalizePerks, voidPerkCost, type VoidPerkRanks } from './void-pilot'
import { VOID_SUPPLIES, VOID_SUPPLY_CARRY, VOID_SUPPLY_STOCK_MAX, voidContractDay, voidContractResetAt, voidContractsFor, voidNormalizeSupplies, voidSupplyCost } from './void-station'
import {
    VOID_ITEM_KINDS, VOID_ITEM_TYPES, VOID_MAX_TIER, VOID_MODS, VOID_RARITIES, voidAffix, voidCanCraftTier, voidCraftCost, voidDefenceStats, voidItemPower,
    voidItemName, voidItemScore, voidItemType, voidItemUpgradeCost, voidMod, voidSalvageValue, voidWeaponFit, VOID_DAMAGE_TYPE, VOID_DEVICES, VOID_SECONDARIES,
    type VoidItem, type VoidItemKind, type VoidModId, type VoidWeaponFit
} from './void-items'
import { VOID_SKILLS, voidEquippedSkill, voidPilotLevel, voidPilotProgress, voidSkillNodesFor, voidUnlockedSkills, type VoidSkillId } from './void-skills'

export type { VoidSkillId }

// ─── Resources ──────────────────────────────────────────────────────────────

export type VoidResourceId = 'ferrite' | 'cobalt' | 'iridium' | 'xenite' | 'scrap' | 'alloy' | 'core'

export interface VoidResourceDefinition {
    id: VoidResourceId
    name: string
    /** `ore` comes out of asteroids, `salvage` out of wrecks and kills. */
    kind: 'ore' | 'salvage'
    color: number
    description: string
}

export const VOID_RESOURCES = [
    { id: 'ferrite', name: 'Ferrite', kind: 'ore', color: 0xc9d3dd, description: 'Grey structural ore. Every hull plate starts here.' },
    { id: 'cobalt', name: 'Cobalt', kind: 'ore', color: 0x4f9dff, description: 'Blue crystal that holds a shield lattice together.' },
    { id: 'iridium', name: 'Iridium', kind: 'ore', color: 0xc38bff, description: 'Violet superdense ore from the deeper sectors.' },
    { id: 'xenite', name: 'Xenite', kind: 'ore', color: 0x3dffb0, description: 'Living green ore. It hums when the beam touches it.' },
    { id: 'scrap', name: 'Scrap', kind: 'salvage', color: 0xffa640, description: 'Torn plating off dead ships and derelicts.' },
    { id: 'alloy', name: 'Alloy', kind: 'salvage', color: 0x49e6ff, description: 'Military-grade plate. Elites and sealed crates carry it.' },
    { id: 'core', name: 'Warp Core', kind: 'salvage', color: 0xff4fa8, description: 'A still-warm drive core. Only sector wardens carry one.' }
] as const satisfies readonly VoidResourceDefinition[]

export const VOID_RESOURCE_IDS: VoidResourceId[] = VOID_RESOURCES.map(r => r.id)

export type VoidResourceBundle = Partial<Record<VoidResourceId, number>>

export function voidResource(id: string): VoidResourceDefinition {
    return VOID_RESOURCES.find(r => r.id === id) ?? VOID_RESOURCES[0]
}

export function voidHex(color: number) {
    return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * Every material quantity (holds, yields, drops, costs) is counted in this
 * many units per "chunk", so hauls feel generous. Prices are divided by the
 * same factor, which leaves the actual economy unchanged. Warp cores are
 * trophies and stay unscaled.
 */
export const VOID_UNIT_SCALE = 3

/**
 * Base coins the market pays per unit, before Trade Contracts. A fresh pilot
 * makes roughly 10-50k from a five-minute run; the contracts multiply that for
 * players who put serious coins into them.
 */
export const VOID_MARKET_PRICES: Record<VoidResourceId, number> = {
    ferrite: 50,
    scrap: 40,
    cobalt: 85,
    alloy: 125,
    iridium: 90,
    xenite: 125,
    core: 7500
}

// ─── Trade Contracts ────────────────────────────────────────────────────────
//
// A coin-only sink: every level raises what the market pays for every
// material. It never touches materials, so it cannot speed up progression,
// only the coins a run turns into.

export const VOID_TRADE_MAX_LEVEL = 10

/** Sell-price multiplier at a Trade Contracts level. */
export function voidTradeMult(level: number) {
    return 1 + 0.7 * Math.max(0, Math.min(VOID_TRADE_MAX_LEVEL, Math.floor(level)))
}

/** Coins for the next level: 10M for the first, 10B for the tenth. */
export function voidTradeCost(level: number) {
    if (level >= VOID_TRADE_MAX_LEVEL) return null
    const raw = 10_000_000 * Math.pow(1000, level / (VOID_TRADE_MAX_LEVEL - 1))
    const step = raw >= 1e9 ? 50_000_000 : raw >= 1e8 ? 5_000_000 : 1_000_000
    return Math.round(raw / step) * step
}

export function voidSellPrice(id: VoidResourceId, tradeLevel: number) {
    return Math.round(VOID_MARKET_PRICES[id] * voidTradeMult(tradeLevel))
}

export function voidBundleValue(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.reduce((sum, id) => sum + voidUnits(bundle[id]) * VOID_MARKET_PRICES[id], 0)
}

export function voidBundleUnits(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.reduce((sum, id) => sum + voidUnits(bundle[id]), 0)
}

function voidUnits(value: unknown) {
    const n = Math.floor(Number(value) || 0)
    return n > 0 ? n : 0
}

/** Drops zero and junk entries so stored bundles stay tidy. */
export function voidCleanBundle(bundle: Record<string, unknown> | null | undefined): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const amount = voidUnits(bundle?.[id])
        if (amount > 0) out[id] = amount
    }
    return out
}

export function voidAddBundles(a: VoidResourceBundle, b: VoidResourceBundle): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const total = voidUnits(a[id]) + voidUnits(b[id])
        if (total > 0) out[id] = total
    }
    return out
}

export function voidCanAfford(held: VoidResourceBundle, cost: VoidResourceBundle) {
    return VOID_RESOURCE_IDS.every(id => voidUnits(held[id]) >= voidUnits(cost[id]))
}

export function voidSubtractBundle(held: VoidResourceBundle, cost: VoidResourceBundle): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const left = voidUnits(held[id]) - voidUnits(cost[id])
        if (left > 0) out[id] = left
    }
    return out
}

/**
 * What anything in the shipyard costs. Materials are always part of it, so
 * coins alone never skip the flying; coins and gems scale hard on top.
 */
export interface VoidPrice {
    resources: VoidResourceBundle
    coins: number
    gems: number
}

export function voidCanAffordPrice(price: VoidPrice, held: VoidResourceBundle, balance: number, gems: number) {
    return voidCanAfford(held, price.resources) && balance >= price.coins && gems >= price.gems
}

// ─── Sectors ────────────────────────────────────────────────────────────────

export interface VoidSectorDefinition {
    tier: number
    name: string
    description: string
    /** Nebula palette: deep, mid, highlight. */
    palette: readonly [number, number, number]
    /** Enemy hp and damage multiplier. */
    threat: number
    /** Ore mix by asteroid weight. */
    ores: Partial<Record<VoidResourceId, number>>
    /** Name of the warden that guards the sector. Killing it and docking clears the sector. */
    warden: string
}

export const VOID_SECTORS = [
    {
        tier: 1,
        name: 'Halcyon Drift',
        description: 'A quiet ferrite belt on the edge of charted space. Scavenger raiders and not much else.',
        palette: [0x050b1f, 0x1b4a8a, 0x5ec8ff],
        threat: 1,
        ores: { ferrite: 80, cobalt: 20 },
        warden: 'Halcyon Warden'
    },
    {
        tier: 2,
        name: 'Cinder Reach',
        description: 'The wreckage of an old mining war. Cobalt runs deep and so do the minefields.',
        palette: [0x1a0606, 0x8a3412, 0xffb347],
        threat: 2.1,
        ores: { ferrite: 45, cobalt: 45, iridium: 10 },
        warden: 'Cinder Matriarch'
    },
    {
        tier: 3,
        name: 'The Long Dark',
        description: 'No stars, no beacons. Iridium seams and something that hunts by drive signature.',
        palette: [0x07030f, 0x3d1670, 0xc07bff],
        threat: 4,
        ores: { cobalt: 45, iridium: 45, xenite: 10 },
        warden: 'The Hollow King'
    },
    {
        tier: 4,
        name: 'Xenite Womb',
        description: 'The rocks are warm and they move a little. Nothing out here is friendly.',
        palette: [0x010f0c, 0x0d5c4a, 0x5dffc6],
        threat: 7,
        ores: { cobalt: 15, iridium: 45, xenite: 40 },
        warden: 'Womb Sovereign'
    },
    {
        tier: 5,
        name: 'The Abyss',
        description: 'The edge of the map, where the void stares back. Pure xenite and the worst of everything.',
        palette: [0x0a000c, 0x3e0a33, 0xff5f9a],
        threat: 12,
        ores: { iridium: 35, xenite: 65 },
        warden: 'Abyssal Leviathan'
    }
] as const satisfies readonly VoidSectorDefinition[]

export const VOID_MAX_SECTOR = VOID_SECTORS.length

export function voidSector(tier: number): VoidSectorDefinition {
    return VOID_SECTORS.find(s => s.tier === tier) ?? VOID_SECTORS[0]
}

/** Sector N opens once the warden of sector N-1 has been killed and the kill docked home. */
export function voidSectorUnlocked(tier: number, highestSectorCleared: number) {
    return tier >= 1 && tier <= VOID_MAX_SECTOR && tier <= highestSectorCleared + 1
}

/** Every resource that can physically be picked up in a sector. */
export function voidSectorResources(tier: number): Set<VoidResourceId> {
    const sector = voidSector(tier)
    const out = new Set<VoidResourceId>(['scrap', 'alloy', 'core'])
    for (const [id, weight] of Object.entries(sector.ores)) {
        if ((weight ?? 0) > 0) out.add(id as VoidResourceId)
    }
    return out
}

// ─── Turrets ────────────────────────────────────────────────────────────────

export type VoidTurretId = 'pulse' | 'gatling' | 'flak' | 'tesla' | 'beam' | 'missile' | 'mortar' | 'rail'

export interface VoidTurretDefinition {
    id: VoidTurretId
    name: string
    description: string
    color: number
    /** Damage per hit (per pellet for flak, per second for beams). */
    damage: number
    /** Shots per second. Beams tick continuously and ignore this. */
    rate: number
    range: number
    projectileSpeed: number
    pellets: number
    spread: number
    splash: number
    /** Multiplier on damage against asteroids. */
    mining: number
}

export const VOID_TURRETS = [
    {
        id: 'pulse', name: 'Pulse Cannon', description: 'Reliable bolts at a steady clip. Good at everything, great at nothing.',
        color: 0x5ec8ff, damage: 7.5, rate: 2.6, range: 170, projectileSpeed: 320, pellets: 1, spread: 0.01, splash: 0, mining: 1
    },
    {
        id: 'gatling', name: 'Gatling', description: 'A hose of small rounds. Shreds light hulls and anything that stays close.',
        color: 0xffd35e, damage: 2.4, rate: 11, range: 140, projectileSpeed: 380, pellets: 1, spread: 0.035, splash: 0, mining: 0.8
    },
    {
        id: 'flak', name: 'Flak Battery', description: 'Pellet bursts that fill the air. Swarms stop being a problem.',
        color: 0xff8a3d, damage: 3, rate: 1.3, range: 110, projectileSpeed: 300, pellets: 7, spread: 0.11, splash: 0, mining: 0.6
    },
    {
        id: 'tesla', name: 'Tesla Coil', description: 'Short-range lightning that jumps to two more targets.',
        color: 0x8fb8ff, damage: 9, rate: 1.6, range: 115, projectileSpeed: 0, pellets: 1, spread: 0, splash: 0, mining: 0.6
    },
    {
        id: 'beam', name: 'Cutting Beam', description: 'A continuous beam that melts rock twice as fast as it melts ships.',
        color: 0x3dffb0, damage: 26, rate: 0, range: 130, projectileSpeed: 0, pellets: 1, spread: 0, splash: 0, mining: 2.2
    },
    {
        id: 'missile', name: 'Swarm Missiles', description: 'Slow homing warheads with a wide blast. Long reach, big numbers.',
        color: 0xff4f6d, damage: 34, rate: 0.7, range: 300, projectileSpeed: 140, pellets: 1, spread: 0, splash: 14, mining: 0.7
    },
    {
        id: 'mortar', name: 'Siege Mortar', description: 'Heavy shells with a huge blast radius. Slow to reload, long reach.',
        color: 0xffa23d, damage: 42, rate: 0.35, range: 340, projectileSpeed: 170, pellets: 1, spread: 0.01, splash: 26, mining: 1.4
    },
    {
        id: 'rail', name: 'Railgun', description: 'Instant slugs that punch through every hull in a line.',
        color: 0xc38bff, damage: 95, rate: 0.45, range: 360, projectileSpeed: 0, pellets: 1, spread: 0, splash: 0, mining: 1.2
    }
] as const satisfies readonly VoidTurretDefinition[]

export const VOID_TURRET_IDS: VoidTurretId[] = VOID_TURRETS.map(t => t.id)

export function voidTurret(id: string): VoidTurretDefinition {
    return VOID_TURRETS.find(t => t.id === id) ?? VOID_TURRETS[0]
}

/** Rough sustained damage per second, for the hangar's comparisons. */
export function voidTurretDps(id: string) {
    const t = voidTurret(id)
    return t.rate === 0 ? t.damage : t.damage * t.rate * t.pellets * (t.pellets > 1 ? 0.6 : 1)
}

// ─── Primary guns ───────────────────────────────────────────────────────────
//
// The nose guns you fire yourself. Damage is VOID_GUN_BASE times the type's
// multiplier times the fitted gun item's power (tier, rarity, level).

export type VoidGunId = 'blaster' | 'autocannon' | 'scatter' | 'plasma' | 'lancer' | 'driver'

export interface VoidGunDefinition {
    id: VoidGunId
    name: string
    description: string
    color: number
    /** Multiplier on the hull's gun stat, per projectile (per second for beams). */
    damage: number
    rate: number
    speed: number
    pellets: number
    spread: number
    range: number
    splash: number
    /** Hitscan guns pierce every hull on the line. */
    hitscan: boolean
    beam: boolean
}

export const VOID_GUNS = [
    {
        id: 'blaster', name: 'Twin Blaster', description: 'Alternating bolts that converge on the crosshair. Honest and reliable.',
        color: 0xffd08a, damage: 1, rate: 7, speed: 520, pellets: 1, spread: 0, range: 460, splash: 0, hitscan: false, beam: false
    },
    {
        id: 'autocannon', name: 'Autocannon', description: 'Twice the rate of fire at a little over half the punch. Easy to land on fast targets.',
        color: 0xffe45e, damage: 0.6, rate: 15, speed: 640, pellets: 1, spread: 0.012, range: 430, splash: 0, hitscan: false, beam: false
    },
    {
        id: 'scatter', name: 'Scattergun', description: 'A short-range pellet spread that deletes anything within spitting distance.',
        color: 0xff9a4d, damage: 0.55, rate: 2.4, speed: 480, pellets: 8, spread: 0.07, range: 170, splash: 0, hitscan: false, beam: false
    },
    {
        id: 'plasma', name: 'Plasma Thrower', description: 'Slow, heavy plasma globes that burst on impact and splash everything nearby.',
        color: 0x7dff6b, damage: 3.4, rate: 2.2, speed: 300, pellets: 1, spread: 0, range: 380, splash: 12, hitscan: false, beam: false
    },
    {
        id: 'lancer', name: 'Lance Beam', description: 'Hold the trigger for a continuous cutting beam. Brutal on rock and hull alike.',
        color: 0x6fe3ff, damage: 11, rate: 0, speed: 0, pellets: 1, spread: 0, range: 300, splash: 0, hitscan: true, beam: true
    },
    {
        id: 'driver', name: 'Mass Driver', description: 'A single slug that crosses the sector instantly and punches through every hull in line.',
        color: 0xd49bff, damage: 9, rate: 0.9, speed: 0, pellets: 1, spread: 0, range: 800, splash: 0, hitscan: true, beam: false
    }
] as const satisfies readonly VoidGunDefinition[]

export const VOID_GUN_IDS: VoidGunId[] = VOID_GUNS.map(g => g.id)

export function voidGun(id: string): VoidGunDefinition {
    return VOID_GUNS.find(g => g.id === id) ?? VOID_GUNS[0]
}

/** Base bolt damage a T1 common gun multiplies. */
export const VOID_GUN_BASE = 9

export function voidGunDps(id: string, gunStat = VOID_GUN_BASE) {
    const g = voidGun(id)
    return g.beam ? g.damage * gunStat : g.damage * gunStat * g.rate * g.pellets * (g.pellets > 1 ? 0.6 : 1)
}

// ─── Ships ──────────────────────────────────────────────────────────────────

export type VoidAbilityId = 'blink' | 'tractor' | 'salvo' | 'phase' | 'bulwark' | 'swarm' | 'nova' | 'overdrive' | 'lance'

export interface VoidShipDefinition {
    id: string
    name: string
    role: string
    description: string
    /** Warden kills required before the shipyard will build it. */
    requiresSector: number
    hull: number
    shield: number
    /** Cruise speed, units per second. */
    speed: number
    /** Turn rate, radians per second. */
    agility: number
    cargo: number
    turrets: number
    /** Armour plate and shield generator slots. */
    armor: number
    shields: number
    drones: number
    /** Ship-specific ability on R. The starter hull has none. */
    ability: VoidAbilityId | null
    cost: VoidResourceBundle
    coins: number
    gems: number
    /** Length of the model in world units. Drives the chase camera. */
    size: number
}

export const VOID_SHIPS = [
    {
        id: 'sparrow', name: 'Sparrow', role: 'Scout', requiresSector: 0,
        description: 'A tiny loaner with one belly turret, one plate and one shield. Nimble enough to survive the mistakes you are about to make.',
        hull: 120, shield: 60, speed: 62, agility: 2.6, cargo: 1000, turrets: 1, armor: 1, shields: 1, drones: 0, ability: null,
        cost: {}, coins: 0, gems: 0, size: 3.2
    },
    {
        id: 'wasp', name: 'Wasp', role: 'Interceptor', requiresSector: 0,
        description: 'All engine. Twin turrets and a blink drive that puts you behind whatever was chasing you.',
        hull: 100, shield: 80, speed: 84, agility: 3.3, cargo: 875, turrets: 2, armor: 1, shields: 1, drones: 0, ability: 'blink',
        cost: { ferrite: 360, scrap: 240 }, coins: 250_000, gems: 0, size: 3.6
    },
    {
        id: 'mule', name: 'Mule', role: 'Hauler', requiresSector: 0,
        description: 'A flying cargo bay with a mining drone and a tractor pulse that vacuums up everything nearby.',
        hull: 260, shield: 70, speed: 50, agility: 1.8, cargo: 3750, turrets: 2, armor: 2, shields: 1, drones: 1, ability: 'tractor',
        cost: { ferrite: 780, cobalt: 90, scrap: 360 }, coins: 500_000, gems: 0, size: 5.2
    },
    {
        id: 'kestrel', name: 'Kestrel', role: 'Gunship', requiresSector: 1,
        description: 'Four turrets and a missile salvo. The first ship that fights back properly.',
        hull: 220, shield: 120, speed: 64, agility: 2.4, cargo: 1750, turrets: 4, armor: 2, shields: 1, drones: 0, ability: 'salvo',
        cost: { ferrite: 1200, cobalt: 480, scrap: 780 }, coins: 2_500_000, gems: 0, size: 5
    },
    {
        id: 'phantom', name: 'Phantom', role: 'Striker', requiresSector: 1,
        description: 'Fast, agile and hard to pin down. Its phase drive turns it intangible for a moment.',
        hull: 170, shield: 170, speed: 96, agility: 3.4, cargo: 1500, turrets: 3, armor: 2, shields: 1, drones: 0, ability: 'phase',
        cost: { cobalt: 960, scrap: 1140, alloy: 120 }, coins: 4_000_000, gems: 0, size: 4.6
    },
    {
        id: 'aegis', name: 'Aegis', role: 'Tank', requiresSector: 2,
        description: 'A slab of armour with six turrets and a shield overcharge that shrugs off anything for a few seconds.',
        hull: 560, shield: 260, speed: 46, agility: 1.5, cargo: 3000, turrets: 6, armor: 4, shields: 1, drones: 0, ability: 'bulwark',
        cost: { cobalt: 1560, iridium: 270, scrap: 1800, alloy: 240 }, coins: 15_000_000, gems: 5, size: 7.5
    },
    {
        id: 'hive', name: 'Hive', role: 'Carrier', requiresSector: 2,
        description: 'Two turrets and a bay of six attack drones. Launches a second swarm on demand.',
        hull: 380, shield: 220, speed: 54, agility: 1.8, cargo: 2750, turrets: 2, armor: 3, shields: 1, drones: 6, ability: 'swarm',
        cost: { cobalt: 1260, iridium: 420, alloy: 420 }, coins: 18_000_000, gems: 5, size: 7
    },
    {
        id: 'seraph', name: 'Seraph', role: 'Vanguard', requiresSector: 3,
        description: 'Speed and firepower in one frame. Six turrets, two drones and a nova that clears the air around it.',
        hull: 360, shield: 380, speed: 86, agility: 3, cargo: 2500, turrets: 6, armor: 3, shields: 2, drones: 2, ability: 'nova',
        cost: { iridium: 1080, xenite: 120, alloy: 660, core: 3 }, coins: 75_000_000, gems: 25, size: 6.5
    },
    {
        id: 'bastion', name: 'Bastion', role: 'Fortress', requiresSector: 4,
        description: 'Ten turrets, two drones and an overdrive that doubles their fire rate. It turns like a planet.',
        hull: 1100, shield: 460, speed: 40, agility: 1.1, cargo: 5000, turrets: 10, armor: 5, shields: 2, drones: 2, ability: 'overdrive',
        cost: { iridium: 1800, xenite: 420, alloy: 1140, core: 6 }, coins: 250_000_000, gems: 60, size: 11
    },
    {
        id: 'leviathan', name: 'Leviathan', role: 'Dreadnought', requiresSector: 5,
        description: 'Twelve turrets, four drones and a spinal lance that cuts a sector in half. The last ship you will ever need.',
        hull: 1800, shield: 800, speed: 36, agility: 0.9, cargo: 6500, turrets: 12, armor: 6, shields: 2, drones: 4, ability: 'lance',
        cost: { iridium: 2700, xenite: 1080, alloy: 1800, core: 12 }, coins: 900_000_000, gems: 150, size: 16
    }
] as const satisfies readonly VoidShipDefinition[]

export type VoidShipId = (typeof VOID_SHIPS)[number]['id']

export const VOID_SHIP_IDS: string[] = VOID_SHIPS.map(s => s.id)

export function voidShip(id: string): VoidShipDefinition {
    return VOID_SHIPS.find(s => s.id === id) ?? VOID_SHIPS[0]
}

export interface VoidAbilityDefinition {
    id: VoidAbilityId
    name: string
    description: string
    cooldown: number
    duration: number
}

export const VOID_ABILITIES: Record<VoidAbilityId, VoidAbilityDefinition> = {
    blink: { id: 'blink', name: 'Blink', description: 'Teleport forward along your aim.', cooldown: 6, duration: 0 },
    tractor: { id: 'tractor', name: 'Tractor Pulse', description: 'Pull in every pickup in a wide radius.', cooldown: 9, duration: 2.5 },
    salvo: { id: 'salvo', name: 'Missile Salvo', description: 'Launch eight homing missiles.', cooldown: 10, duration: 0 },
    phase: { id: 'phase', name: 'Phase Drive', description: 'Become intangible and fast.', cooldown: 11, duration: 2.2 },
    bulwark: { id: 'bulwark', name: 'Bulwark', description: 'Invulnerable shields for a few seconds.', cooldown: 16, duration: 4 },
    swarm: { id: 'swarm', name: 'Swarm Launch', description: 'Launch six extra drones for a while.', cooldown: 18, duration: 12 },
    nova: { id: 'nova', name: 'Nova', description: 'A blast that wrecks everything close.', cooldown: 12, duration: 0 },
    overdrive: { id: 'overdrive', name: 'Overdrive', description: 'Turrets fire twice as fast.', cooldown: 20, duration: 7 },
    lance: { id: 'lance', name: 'Spinal Lance', description: 'Charge and fire a sector-splitting beam.', cooldown: 18, duration: 2.5 }
}

// ─── Station upgrades ───────────────────────────────────────────────────────
//
// General systems fitted to every hull you own. Combat power lives in gear
// (void-items.ts); these cover flying, hauling and mining.

export type VoidUpgradeId = 'engines' | 'cargo' | 'mining' | 'drones'

export interface VoidUpgradeDefinition {
    id: VoidUpgradeId
    name: string
    description: string
    maxLevel: number
    /** Human readable effect at a given level. */
    effect: (level: number) => string
}

export const VOID_UPGRADES: readonly VoidUpgradeDefinition[] = [
    { id: 'engines', name: 'Thruster Array', description: 'Cruise speed, boost and turn rate.', maxLevel: 8, effect: l => `+${l * 8}% speed, +${l * 4}% turn` },
    { id: 'cargo', name: 'Cargo Systems', description: 'Compressed bays and a stronger tractor.', maxLevel: 10, effect: l => `+${l * 15}% hold, +${l * 20}% pickup range` },
    { id: 'mining', name: 'Mining Rig', description: 'Cuts rock faster and splits more ore from it.', maxLevel: 8, effect: l => `+${l * 25}% mining` },
    { id: 'drones', name: 'Drone Bay', description: 'Harder-hitting drones; every third Mk launches one more.', maxLevel: 9, effect: l => `+${l * 20}% drone damage, +${Math.floor(l / 3)} drones` }
]

/** Roman numeral mark for a part level (Mk 0 means stock). */
export function voidMark(level: number) {
    if (level <= 0) return 'Stock'
    const numerals: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    let n = level
    let out = ''
    for (const [v, r] of numerals) {
        while (n >= v) {
            out += r
            n -= v
        }
    }
    return `Mk ${out}`
}

export const VOID_UPGRADE_IDS: VoidUpgradeId[] = VOID_UPGRADES.map(u => u.id)

export type VoidUpgradeLevels = Record<VoidUpgradeId, number>

export function voidNormalizeLevels(raw: Record<string, unknown> | null | undefined): VoidUpgradeLevels {
    const out = {} as VoidUpgradeLevels
    for (const upgrade of VOID_UPGRADES) {
        const n = Math.floor(Number(raw?.[upgrade.id]) || 0)
        out[upgrade.id] = Math.max(0, Math.min(upgrade.maxLevel, n))
    }
    return out
}

/**
 * Upgrade prices climb through the ore ladder: the early levels cost what
 * sector 1 drops, the late levels need what only the deep sectors have.
 */
export function voidUpgradeCost(id: VoidUpgradeId, level: number): VoidPrice | null {
    const def = VOID_UPGRADES.find(u => u.id === id)
    if (!def || level >= def.maxLevel) return null
    const weight: Record<VoidUpgradeId, number> = { engines: 1, cargo: 1.1, mining: 0.9, drones: 1.2 }
    const w = weight[id]
    const g = (base: number, growth: number) => Math.round(base * w * Math.pow(growth, level) / 10) * 10
    let resources: VoidResourceBundle
    if (level < 3) resources = { ferrite: g(200, 1.5), scrap: g(120, 1.5) }
    else if (level < 6) resources = { ferrite: g(200, 1.45), cobalt: g(70, 1.45), alloy: g(10, 1.5) }
    else resources = voidCleanBundle({ cobalt: g(160, 1.35), iridium: g(50, 1.35), xenite: level >= 8 ? g(10, 1.3) : 0, alloy: g(20, 1.35) })
    const coins = Math.round(80_000 * w * Math.pow(2.1, level) / 1000) * 1000
    const gems = level >= def.maxLevel - 2 ? Math.ceil(3 * Math.pow(1.8, level - (def.maxLevel - 2))) : 0
    return { resources, coins, gems }
}

// ─── Fit and derived stats ──────────────────────────────────────────────────

/** Item ids fitted to one hull. Null is an empty slot. */
export interface VoidShipFit {
    gun: string | null
    turrets: (string | null)[]
    armor: (string | null)[]
    shields: (string | null)[]
    secondary: string | null
    device: string | null
}

/** Normalises a stored fit against the hull's slots and the items that exist. */
export function voidNormalizeFit(shipId: string, raw: unknown, items: readonly VoidItem[]): VoidShipFit {
    const ship = voidShip(shipId)
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<Record<keyof VoidShipFit, unknown>>
    const byId = new Map(items.map(i => [i.id, i]))
    const used = new Set<string>()
    const pick = (id: unknown, kind: VoidItemKind) => {
        if (typeof id !== 'string') return null
        const item = byId.get(id)
        if (!item || item.kind !== kind || used.has(id)) return null
        used.add(id)
        return id
    }
    const list = (value: unknown, count: number, kind: VoidItemKind) => {
        const arr = Array.isArray(value) ? value : []
        return Array.from({ length: count }, (_, i) => pick(arr[i], kind))
    }
    return {
        gun: pick(r.gun, 'gun'),
        turrets: list(r.turrets, ship.turrets, 'turret'),
        armor: list(r.armor, ship.armor, 'armor'),
        shields: list(r.shields, ship.shields, 'shield'),
        secondary: pick(r.secondary, 'secondary'),
        device: pick(r.device, 'device')
    }
}

/**
 * Fills a hull's slots with the strongest gear in the hangar. Used when a new
 * hull is built and by the hangar's auto-fit button.
 */
export function voidAutoFit(shipId: string, items: readonly VoidItem[]): VoidShipFit {
    const ship = voidShip(shipId)
    const best = (kind: VoidItemKind) => items.filter(i => i.kind === kind).sort((a, b) => voidItemScore(b) - voidItemScore(a)).map(i => i.id)
    const take = (kind: VoidItemKind, count: number) => {
        const ids = best(kind)
        return Array.from({ length: count }, (_, i) => ids[i] ?? null)
    }
    return { gun: best('gun')[0] ?? null, turrets: take('turret', ship.turrets), armor: take('armor', ship.armor), shields: take('shield', ship.shields), secondary: best('secondary')[0] ?? null, device: best('device')[0] ?? null }
}

export interface VoidLoadout {
    shipId: string
    levels: VoidUpgradeLevels
    fit: VoidShipFit
    gun: VoidWeaponFit | null
    turrets: (VoidWeaponFit | null)[]
    secondary: VoidWeaponFit | null
    device: VoidWeaponFit | null
    perks: VoidPerkRanks
    skill: { id: VoidSkillId, nodes: string[] }
}

export interface VoidDerivedStats {
    hull: number
    shield: number
    shieldRegen: number
    shieldDelay: number
    resist: number
    hullRepair: number
    defenceMods: VoidModId[]
    speed: number
    boost: number
    agility: number
    cargo: number
    magnet: number
    /** Gun item power: scales the nose gun, ship abilities and skills. */
    damageMult: number
    fireRateMult: number
    miningMult: number
    droneDamageMult: number
    drones: number
    gun: number
}

export function voidDerivedStats(shipId: string, levels: VoidUpgradeLevels, fit: VoidShipFit, items: readonly VoidItem[], perks?: VoidPerkRanks): VoidDerivedStats {
    const ship = voidShip(shipId)
    const l = levels
    const byId = new Map(items.map(i => [i.id, i]))
    const armor = fit.armor.map(id => (id ? byId.get(id) : undefined)).filter((i): i is VoidItem => !!i)
    const shields = fit.shields.map(id => (id ? byId.get(id) : undefined)).filter((i): i is VoidItem => !!i)
    const defence = voidDefenceStats(ship.hull, ship.shield, armor, shields)
    defence.hull = Math.round(defence.hull * (1 + (perks?.frame ?? 0) * 0.06))
    defence.shield = Math.round(defence.shield * (1 + (perks?.capacitor ?? 0) * 0.06))
    const gunItem = fit.gun ? byId.get(fit.gun) : undefined
    const gunPower = gunItem ? voidWeaponFit(gunItem).power : 0.6
    return {
        hull: defence.hull,
        shield: defence.shield,
        shieldRegen: defence.shield * defence.regen,
        shieldDelay: defence.delay,
        resist: defence.resist,
        hullRepair: defence.repair,
        defenceMods: defence.mods,
        speed: ship.speed * (1 + l.engines * 0.08),
        boost: 1.9 + l.engines * 0.05,
        agility: ship.agility * (1 + l.engines * 0.04),
        cargo: Math.round(ship.cargo * (1 + l.cargo * 0.15) * (1 + (perks?.harness ?? 0) * 0.08)),
        magnet: 34 * (1 + l.cargo * 0.2) * Math.max(1, ship.size / 5),
        damageMult: gunPower,
        fireRateMult: 1,
        miningMult: 1 + l.mining * 0.25,
        // Drones ride on the best turret you fitted, so they grow with your gear.
        droneDamageMult: (1 + l.drones * 0.2) * Math.max(gunPower, ...fit.turrets.map(id => (id && byId.get(id) ? voidItemPower(byId.get(id)!) : 0))),
        drones: ship.drones + Math.floor(l.drones / 3) * (ship.drones > 0 ? 1 : 0),
        gun: VOID_GUN_BASE
    }
}

/** A single number to compare builds with. */
export function voidPowerRating(loadout: Pick<VoidLoadout, 'gun' | 'turrets'>, stats: VoidDerivedStats) {
    const turretDps = loadout.turrets.reduce((sum, t) => sum + (t ? voidTurretDps(t.type) * t.power * t.rate : 0), 0)
    const gunDps = loadout.gun ? voidGunDps(loadout.gun.type) * loadout.gun.power * loadout.gun.rate : 0
    const droneDps = stats.drones * 8 * stats.droneDamageMult
    const defence = (stats.hull * (1 + stats.resist) + stats.shield * 1.2) / 10
    return Math.round(turretDps + gunDps * 0.5 + droneDps + defence)
}

// ─── Settlement ─────────────────────────────────────────────────────────────

/** Anything longer is a dead tab, not a run. */
export const VOID_MAX_RUN_MS = 40 * 60 * 1000
/** Runs with no finish older than this can be cleared by the next launch. */
export const VOID_STALE_RUN_MS = 45 * 60 * 1000

/**
 * The most of each resource an honest run could pick up per minute, before
 * the sector bonus. Set well above what a player strip-mining the richest
 * cluster manages (a starter hull fills 1,000 units in about two minutes), so
 * it only ever bites a forged report.
 */
const VOID_UNITS_PER_MINUTE: Record<VoidResourceId, number> = {
    ferrite: 750,
    cobalt: 600,
    iridium: 500,
    xenite: 600,
    scrap: 1000,
    alloy: 300,
    core: 0
}

export interface VoidRunReport {
    extracted: boolean
    haul: VoidResourceBundle
    elapsedMs: number
    kills: number
    wardenKilled: boolean
    /** Jump depth the run reached; loot caps grow with it. */
    depth?: number
}

export interface VoidSettledRun {
    haul: VoidResourceBundle
    units: number
    value: number
    elapsedMs: number
    kills: number
    wardenKilled: boolean
    /** True when the report was trimmed by a cap. */
    trimmed: boolean
}

/**
 * Turns a client report into what the run may bank. Only an extraction banks
 * anything; the haul is filtered to the sector's resources, capped per minute
 * of wall-clock time and trimmed to the hold the ship launched with.
 */
export function voidSettleRun(report: VoidRunReport, tier: number, cargoCapacity: number, wallElapsedMs: number): VoidSettledRun {
    const elapsedMs = Math.max(0, Math.min(Math.floor(Number(report.elapsedMs) || 0), wallElapsedMs, VOID_MAX_RUN_MS))
    const minutes = Math.max(elapsedMs, 0) / 60_000
    // A warden fight takes time to reach and time to win.
    const wardenKilled = Boolean(report.wardenKilled) && wallElapsedMs >= 60_000
    const kills = Math.max(0, Math.min(Math.floor(Number(report.kills) || 0), Math.ceil(minutes * 60) + 10))

    if (!report.extracted) {
        return { haul: {}, units: 0, value: 0, elapsedMs, kills, wardenKilled: false, trimmed: false }
    }

    const allowed = voidSectorResources(tier)
    const sectorBonus = (1 + (tier - 1) * 0.25) * voidDepthLoot(voidAllowedDepth(report.depth ?? 1, elapsedMs))
    let trimmed = false
    const capped: VoidResourceBundle = {}
    for (const id of VOID_RESOURCE_IDS) {
        const reported = voidUnits(report.haul?.[id])
        if (reported <= 0) continue
        if (!allowed.has(id)) {
            trimmed = true
            continue
        }
        const ceiling = id === 'core'
            ? (wardenKilled ? 2 + tier : 0) + Math.floor(minutes / 4)
            : Math.ceil(VOID_UNITS_PER_MINUTE[id] * sectorBonus * minutes) + 300
        const amount = Math.min(reported, ceiling)
        if (amount < reported) trimmed = true
        if (amount > 0) capped[id] = amount
    }

    // Trim to the hold, dropping the cheapest material first.
    const haul: VoidResourceBundle = {}
    let room = Math.max(0, Math.floor(cargoCapacity))
    const byValue = VOID_RESOURCE_IDS
        .filter(id => (capped[id] ?? 0) > 0)
        .sort((a, b) => VOID_MARKET_PRICES[b] - VOID_MARKET_PRICES[a])
    for (const id of byValue) {
        const take = Math.min(capped[id]!, room)
        if (take < capped[id]!) trimmed = true
        if (take > 0) haul[id] = take
        room -= take
    }

    return {
        haul,
        units: voidBundleUnits(haul),
        value: voidBundleValue(haul),
        elapsedMs,
        kills,
        wardenKilled,
        trimmed
    }
}

// ─── Hangar snapshot ────────────────────────────────────────────────────────

/** The persisted fields the hangar needs; matches the `void_state` row. */
export interface VoidStateSnapshot {
    userId?: string
    resources: Record<string, number>
    ownedShipIds: string[]
    equippedShipId: string
    loadouts: Record<string, unknown>
    upgradeLevels: Record<string, number>
    highestSectorCleared: number
    runsPlayed: number
    extractions: number
    kills: number
    wardensKilled: number
    bestHaulValue: number
    totalSold: number
    runStartedAt: Date | null
    runSector: number | null
    pilotXp: number
    tradeLevel: number
    unlockedSkills: string[]
    equippedSkill: string
    skillNodes: Record<string, string[]>
    supplies?: Record<string, number>
    contractsDay?: string | null
    contractsDone?: number[]
    mods?: Record<string, number>
    marks?: number
    perks?: Record<string, number>
    blueprints?: string[]
    lore?: string[]
}

export function voidOwnedShips(s: Pick<VoidStateSnapshot, 'ownedShipIds'>) {
    return Array.from(new Set(['sparrow', ...(s.ownedShipIds ?? [])]))
}

/** The loadout a row flies with, fully normalised and resolved against gear. */
export function voidLoadoutFor(s: VoidStateSnapshot, items: readonly VoidItem[], shipId = s.equippedShipId): VoidLoadout {
    const levels = voidNormalizeLevels(s.upgradeLevels)
    const fit = voidNormalizeFit(shipId, s.loadouts?.[shipId], items)
    const byId = new Map(items.map(i => [i.id, i]))
    const weapon = (id: string | null) => {
        const item = id ? byId.get(id) : undefined
        return item ? voidWeaponFit(item) : null
    }
    const skillId = voidEquippedSkill(s)
    const skill = { id: skillId, nodes: voidSkillNodesFor(s.skillNodes, skillId, voidPilotLevel(s.pilotXp ?? 0)) }
    return { shipId, levels, fit, gun: weapon(fit.gun), turrets: fit.turrets.map(weapon), secondary: weapon(fit.secondary), device: weapon(fit.device), perks: voidNormalizePerks(s.perks), skill }
}

export function voidDescribeItem(item: VoidItem, resources: VoidResourceBundle, balance: number, gems: number) {
    const type = voidItemType(item.type)
    const upgrade = voidItemUpgradeCost(item)
    const base = item.kind === 'gun' ? voidGun(item.type) : item.kind === 'turret' ? voidTurret(item.type) : null
    const power = voidItemPower(item)
    const a = item.affixes ?? {}
    let stats: { label: string, value: string }[] = []
    if (item.kind === 'gun' && base) {
        const g = base as VoidGunDefinition
        stats = [
            { label: 'DPS', value: String(Math.round(voidGunDps(g.id) * power * (1 + (a.damage ?? 0)) * (1 + (a.rate ?? 0)))) },
            { label: 'Range', value: String(Math.round(g.range * (1 + (a.range ?? 0)))) },
            { label: 'Type', value: VOID_DAMAGE_TYPE[g.id] ?? 'energy' }
        ]
    } else if (item.kind === 'turret' && base) {
        const t = base as VoidTurretDefinition
        stats = [
            { label: 'DPS', value: String(Math.round(voidTurretDps(t.id) * power * (1 + (a.damage ?? 0)) * (1 + (a.rate ?? 0)))) },
            { label: 'Range', value: String(Math.round(t.range * (1 + (a.range ?? 0)))) },
            { label: 'Type', value: VOID_DAMAGE_TYPE[t.id] ?? 'energy' }
        ]
    } else if (item.kind === 'secondary') {
        const sec = VOID_SECONDARIES[item.type]!
        const fit = voidWeaponFit(item)
        stats = [
            { label: 'Hit', value: `${Math.round(sec.damage * fit.power)}×${sec.volley}` },
            { label: 'Ammo', value: String(Math.round(sec.ammo * fit.extra)) },
            { label: 'Type', value: VOID_DAMAGE_TYPE[item.type] ?? 'explosive' }
        ]
    } else if (item.kind === 'device') {
        const dev = VOID_DEVICES[item.type]!
        const fit = voidWeaponFit(item)
        stats = [
            { label: 'Cooldown', value: `${Math.round(dev.cooldown * fit.cycle)}s` },
            { label: 'Lasts', value: `${(dev.duration * fit.extra).toFixed(1)}s` }
        ]
    } else {
        const d = item.kind === 'armor' ? voidDefenceStats(0, 0, [item], []) : voidDefenceStats(0, 0, [], [item])
        stats = item.kind === 'armor'
            ? [{ label: 'Hull', value: `+${d.hull}` }, ...(d.resist > 0 ? [{ label: 'Resist', value: `${Math.round(d.resist * 100)}%` }] : [])]
            : [{ label: 'Shield', value: `+${d.shield}` }, { label: 'Recharge', value: `${Math.round(d.regen * 100)}%/s` }]
    }
    return {
        ...item,
        name: voidItemName(item),
        mk2: !!a.mk2,
        color: type?.color ?? 0xffffff,
        rarityName: VOID_RARITIES[item.rarity]?.name ?? 'Common',
        rarityColor: VOID_RARITIES[item.rarity]?.color ?? '#fff',
        score: voidItemScore(item),
        stats,
        affixList: Object.entries(a).filter(([id]) => id !== 'mk2').map(([id, value]) => {
            const def = voidAffix(id)
            return { id, name: def?.name ?? id, value, text: `${def?.format === 'pctNeg' ? '-' : '+'}${Math.round(value * 1000) / 10}%` }
        }),
        modInfo: voidMod(item.mod),
        upgradeCost: upgrade,
        upgradeAffordable: upgrade ? voidCanAffordPrice(upgrade, resources, balance, gems) : false,
        salvage: voidSalvageValue(item)
    }
}

export function voidDescribeState(s: VoidStateSnapshot, balance: number, gems: number, items: readonly VoidItem[]) {
    const resources = voidCleanBundle(s.resources)
    const owned = voidOwnedShips(s)
    const loadout = voidLoadoutFor(s, items)
    const stats = voidDerivedStats(loadout.shipId, loadout.levels, loadout.fit, items, loadout.perks)
    const pilot = voidPilotProgress(s.pilotXp ?? 0)
    const unlockedSkills = voidUnlockedSkills(s)
    const stock = voidNormalizeSupplies(s.supplies)
    const day = voidContractDay()
    const maxCraftTier = Math.min(VOID_MAX_TIER, s.highestSectorCleared + 1)
    return {
        resources,
        balance,
        gems,
        equippedShipId: s.equippedShipId,
        loadout,
        stats,
        power: voidPowerRating(loadout, stats),
        highestSectorCleared: s.highestSectorCleared,
        runsPlayed: s.runsPlayed,
        extractions: s.extractions,
        kills: s.kills,
        wardensKilled: s.wardensKilled,
        bestHaulValue: s.bestHaulValue,
        totalSold: s.totalSold,
        activeRun: s.runStartedAt ? { startedAt: s.runStartedAt, sector: s.runSector ?? 1 } : null,
        prices: Object.fromEntries(VOID_RESOURCE_IDS.map(id => [id, voidSellPrice(id, s.tradeLevel ?? 0)])) as Record<VoidResourceId, number>,
        trade: {
            level: s.tradeLevel ?? 0,
            maxLevel: VOID_TRADE_MAX_LEVEL,
            mult: voidTradeMult(s.tradeLevel ?? 0),
            nextMult: (s.tradeLevel ?? 0) < VOID_TRADE_MAX_LEVEL ? voidTradeMult((s.tradeLevel ?? 0) + 1) : null,
            cost: voidTradeCost(s.tradeLevel ?? 0),
            affordable: (voidTradeCost(s.tradeLevel ?? 0) ?? Infinity) <= balance
        },
        resourceCatalog: VOID_RESOURCES,
        abilities: VOID_ABILITIES,
        pilot,
        marks: s.marks ?? 0,
        perks: VOID_PERKS.map((perk) => {
            const rank = loadout.perks[perk.id]
            const cost = voidPerkCost(perk.id, rank)
            return { id: perk.id, name: perk.name, description: perk.description, icon: perk.icon, rank, maxRank: perk.costs.length, current: perk.effect(rank), next: rank < perk.costs.length ? perk.effect(rank + 1) : null, cost, affordable: cost !== null && (s.marks ?? 0) >= cost }
        }),
        blueprints: (s.blueprints ?? []).filter(id => voidItemType(id)).map(id => ({ id, name: voidItemType(id)!.name, kind: voidItemType(id)!.kind })),
        lore: VOID_LORE.map(entry => ({ ...entry, found: (s.lore ?? []).includes(entry.id) })),
        zones: VOID_ZONES,
        items: items.map(item => voidDescribeItem(item, resources, balance, gems)).sort((a, b) => b.score - a.score),
        mods: VOID_MODS.map(mod => ({ ...mod, count: Math.max(0, Math.floor(Number(s.mods?.[mod.id]) || 0)) })),
        crafting: {
            maxTier: maxCraftTier,
            rarities: VOID_RARITIES,
            types: VOID_ITEM_TYPES.map(t => ({ ...t, unlocked: t.minTier <= maxCraftTier })),
            costs: VOID_ITEM_KINDS.map(kind => ({
                kind,
                tiers: [1, 2, 3, 4, 5].map((tier) => {
                    const price = voidCraftCost(kind, tier)
                    return { tier, ...price, unlocked: voidCanCraftTier(tier, s.highestSectorCleared), affordable: voidCanAffordPrice(price, resources, balance, gems) }
                })
            }))
        },
        supplies: VOID_SUPPLIES.map((supply) => {
            const price = voidSupplyCost(supply.id, s.highestSectorCleared, loadout.perks.quartermaster > 0)
            return { ...supply, stock: stock[supply.id], cost: price, affordable: voidCanAffordPrice(price, resources, balance, gems) }
        }),
        supplyCarry: VOID_SUPPLY_CARRY,
        supplyStockMax: VOID_SUPPLY_STOCK_MAX,
        contracts: voidContractsFor(s.userId ?? '', day, s.highestSectorCleared, s.tradeLevel ?? 0).map(c => ({
            ...c,
            done: s.contractsDay === day && (s.contractsDone ?? []).includes(c.index),
            affordable: (resources[c.resource] ?? 0) >= c.amount
        })),
        contractsReset: voidContractResetAt(),
        equippedSkill: loadout.skill.id,
        skills: VOID_SKILLS.map(skill => ({
            ...skill,
            unlocked: unlockedSkills.includes(skill.id),
            available: s.highestSectorCleared >= skill.requiresSector,
            nodesAllocated: voidSkillNodesFor(s.skillNodes, skill.id, pilot.level),
            affordable: voidCanAffordPrice({ resources: skill.cost, coins: skill.coins, gems: skill.gems }, resources, balance, gems)
        })),
        ships: VOID_SHIPS.map((ship) => {
            const shipLoadout = voidLoadoutFor(s, items, ship.id)
            const shipStats = voidDerivedStats(ship.id, shipLoadout.levels, shipLoadout.fit, items, shipLoadout.perks)
            return {
                ...ship,
                owned: owned.includes(ship.id),
                equipped: ship.id === s.equippedShipId,
                unlocked: s.highestSectorCleared >= ship.requiresSector,
                affordable: voidCanAffordPrice({ resources: ship.cost, coins: ship.coins, gems: ship.gems }, resources, balance, gems),
                fit: shipLoadout.fit,
                turretTypes: shipLoadout.turrets.map(t => t?.type ?? null),
                stats: shipStats,
                power: voidPowerRating(shipLoadout, shipStats)
            }
        }),
        upgrades: VOID_UPGRADES.map((upgrade) => {
            const level = loadout.levels[upgrade.id]
            const cost = voidUpgradeCost(upgrade.id, level)
            return {
                id: upgrade.id,
                name: upgrade.name,
                description: upgrade.description,
                level,
                maxLevel: upgrade.maxLevel,
                current: upgrade.effect(level),
                next: level < upgrade.maxLevel ? upgrade.effect(level + 1) : null,
                cost,
                affordable: cost ? voidCanAffordPrice(cost, resources, balance, gems) : false
            }
        }),
        sectors: VOID_SECTORS.map(sector => ({
            ...sector,
            unlocked: voidSectorUnlocked(sector.tier, s.highestSectorCleared),
            cleared: s.highestSectorCleared >= sector.tier,
            gearTier: sector.tier
        }))
    }
}
