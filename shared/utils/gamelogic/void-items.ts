// ─── Void Runner: gear ──────────────────────────────────────────────────────
//
// Ships are shells; gear is what makes them fight. Every gun, turret, armour
// plate and shield generator is an item with:
// - a tier (T1-T5). Each tier is crafted from the materials of its sector,
//   and you can only craft up to one tier past the deepest sector you cleared.
// - a rarity, rolled when it is crafted, which sets a quality bonus and how
//   many random affixes it carries.
// - a level (+0 to +10), bought with materials and coins on a steep curve.
// - one socket for a relic mod. Mods are rare finds from elites, wardens and
//   vaults, and add a unique effect.
//
// The loop: craft T1 gear, level it, clear the sector, craft T2 and start again.

import type { VoidResourceBundle, VoidResourceId } from './void'

export type VoidItemKind = 'gun' | 'turret' | 'armor' | 'shield' | 'secondary' | 'device'

export const VOID_ITEM_KINDS: VoidItemKind[] = ['gun', 'turret', 'armor', 'shield', 'secondary', 'device']

// ─── Damage types ───────────────────────────────────────────────────────────
//
// Energy strips shields and glances off plate; kinetic rounds bounce off
// shields and tear hulls; explosives are even-handed. Loadouts become a
// question of what you are fighting, not just DPS.

export type VoidDamageType = 'energy' | 'kinetic' | 'explosive'

export const VOID_DAMAGE_MULT: Record<VoidDamageType, { shield: number, hull: number }> = {
    energy: { shield: 1.6, hull: 0.95 },
    kinetic: { shield: 0.65, hull: 1.1 },
    explosive: { shield: 1, hull: 1 }
}

export const VOID_DAMAGE_TYPE: Record<string, VoidDamageType> = {
    blaster: 'energy', autocannon: 'kinetic', scatter: 'kinetic', plasma: 'energy', lancer: 'energy', driver: 'kinetic',
    pulse: 'energy', gatling: 'kinetic', flak: 'kinetic', tesla: 'energy', beam: 'energy', missile: 'explosive', mortar: 'explosive', rail: 'kinetic',
    seekers: 'explosive', rockets: 'explosive', torpedo: 'explosive', mines: 'explosive', sentry: 'kinetic'
}

// ─── Secondary weapons and devices ─────────────────────────────────────────

export interface VoidSecondaryDefinition {
    id: string
    /** Damage per warhead at power 1. */
    damage: number
    /** Warheads per volley. */
    volley: number
    ammo: number
    /** Seconds between volleys. */
    reload: number
    splash: number
    /** Needs a held lock on a target before it fires. */
    lock: boolean
    speed: number
}

export const VOID_SECONDARIES: Record<string, VoidSecondaryDefinition> = {
    seekers: { id: 'seekers', damage: 30, volley: 4, ammo: 12, reload: 1.4, splash: 10, lock: true, speed: 150 },
    rockets: { id: 'rockets', damage: 22, volley: 6, ammo: 8, reload: 1.2, splash: 9, lock: false, speed: 260 },
    mines: { id: 'mines', damage: 90, volley: 1, ammo: 8, reload: 0.8, splash: 22, lock: false, speed: 0 },
    torpedo: { id: 'torpedo', damage: 260, volley: 1, ammo: 4, reload: 3, splash: 26, lock: true, speed: 90 }
}

export interface VoidDeviceDefinition {
    id: string
    cooldown: number
    duration: number
    /** What it does, in plain words, for the HUD and the pilot guide. */
    effect: string
    /** Share of the energy bar it costs to trigger. */
    energy: number
}

export const VOID_DEVICES: Record<string, VoidDeviceDefinition> = {
    booster: { id: 'booster', cooldown: 30, duration: 2, energy: 0.3, effect: 'Refills a big chunk of your shield in two seconds. Use it when the shield runs low.' },
    decoy: { id: 'decoy', cooldown: 26, duration: 7, energy: 0.35, effect: 'Drops a hologram of your ship that enemies shoot at instead of you.' },
    sentry: { id: 'sentry', cooldown: 34, duration: 18, energy: 0.4, effect: 'Deploys a small turret that shoots nearby hostiles for a while.' },
    cloak: { id: 'cloak', cooldown: 38, duration: 4.5, energy: 0.5, effect: 'Enemies lose track of you for a few seconds. Firing breaks it; wardens still see you.' },
    dilator: { id: 'dilator', cooldown: 48, duration: 5, energy: 0.6, effect: 'Slows every enemy and enemy shot around you for a few seconds.' }
}

export const VOID_MAX_TIER = 5
export const VOID_ITEM_MAX_LEVEL = 10

/** Player power per tier; tracks the sector threat curve a step behind. */
export const VOID_TIER_POWER = [1, 1.8, 3.2, 5.2, 8]

export function voidTierPower(tier: number) {
    return VOID_TIER_POWER[Math.max(1, Math.min(VOID_MAX_TIER, tier)) - 1]!
}

export const VOID_TIER_NAMES = ['T1', 'T2', 'T3', 'T4', 'T5']

// ─── Rarity ─────────────────────────────────────────────────────────────────

export interface VoidRarity {
    name: string
    color: string
    mult: number
    affixes: number
    weight: number
}

export const VOID_RARITIES: VoidRarity[] = [
    // A legendary lands roughly a tier above its own: a maxed T1 legendary
    // edges out a maxed T2 common, but not a maxed T2 uncommon.
    { name: 'Common', color: '#c9d3dd', mult: 1, affixes: 0, weight: 60 },
    { name: 'Uncommon', color: '#5eff8a', mult: 1.12, affixes: 1, weight: 25 },
    { name: 'Rare', color: '#5ec8ff', mult: 1.28, affixes: 2, weight: 10.5 },
    { name: 'Epic', color: '#c38bff', mult: 1.5, affixes: 2, weight: 3.7 },
    { name: 'Legendary', color: '#ffb347', mult: 1.9, affixes: 3, weight: 0.8 }
]

// ─── Types per kind ─────────────────────────────────────────────────────────

export interface VoidItemType {
    id: string
    kind: VoidItemKind
    name: string
    description: string
    /** Lowest tier this type can be crafted at. */
    minTier: number
    color: number
}

/**
 * Gun and turret types reuse the ballistics in void.ts (VOID_GUNS and
 * VOID_TURRETS); armour and shields are defined here.
 */
export const VOID_ITEM_TYPES: VoidItemType[] = [
    { id: 'blaster', kind: 'gun', name: 'Twin Blaster', description: 'Alternating bolts that converge on the crosshair.', minTier: 1, color: 0xffd08a },
    { id: 'autocannon', kind: 'gun', name: 'Autocannon', description: 'Twice the rate at a little over half the punch.', minTier: 1, color: 0xffe45e },
    { id: 'scatter', kind: 'gun', name: 'Scattergun', description: 'A short-range pellet spread.', minTier: 2, color: 0xff9a4d },
    { id: 'plasma', kind: 'gun', name: 'Plasma Thrower', description: 'Slow globes that splash on impact.', minTier: 2, color: 0x7dff6b },
    { id: 'lancer', kind: 'gun', name: 'Lance Beam', description: 'A continuous cutting beam.', minTier: 3, color: 0x6fe3ff },
    { id: 'driver', kind: 'gun', name: 'Mass Driver', description: 'An instant slug that pierces every hull in line.', minTier: 4, color: 0xd49bff },

    { id: 'pulse', kind: 'turret', name: 'Pulse Cannon', description: 'Reliable bolts at a steady clip.', minTier: 1, color: 0x5ec8ff },
    { id: 'gatling', kind: 'turret', name: 'Gatling', description: 'A hose of small rounds.', minTier: 1, color: 0xffd35e },
    { id: 'flak', kind: 'turret', name: 'Flak Battery', description: 'Pellet bursts that shred swarms.', minTier: 2, color: 0xff8a3d },
    { id: 'tesla', kind: 'turret', name: 'Tesla Coil', description: 'Short-range lightning that jumps between targets.', minTier: 2, color: 0x8fb8ff },
    { id: 'beam', kind: 'turret', name: 'Cutting Beam', description: 'A continuous beam, brutal on rock.', minTier: 3, color: 0x3dffb0 },
    { id: 'missile', kind: 'turret', name: 'Swarm Missiles', description: 'Homing warheads with a wide blast.', minTier: 3, color: 0xff4f6d },
    { id: 'mortar', kind: 'turret', name: 'Siege Mortar', description: 'Heavy shells with a huge blast. Slow and far.', minTier: 4, color: 0xffa23d },
    { id: 'rail', kind: 'turret', name: 'Railgun', description: 'Instant slugs that punch through a line.', minTier: 4, color: 0xc38bff },

    { id: 'plating', kind: 'armor', name: 'Armour Plating', description: 'Thick plate. Pure hull.', minTier: 1, color: 0xc9d3dd },
    { id: 'bulkhead', kind: 'armor', name: 'Reinforced Bulkhead', description: 'Less hull, but shrugs off part of every hit.', minTier: 1, color: 0xffc27a },

    { id: 'deflector', kind: 'shield', name: 'Deflector', description: 'A big shield pool with a steady recharge.', minTier: 1, color: 0x6fd8ff },
    { id: 'regenerator', kind: 'shield', name: 'Regenerator', description: 'A smaller pool that comes back fast.', minTier: 1, color: 0x7dffd2 },

    { id: 'seekers', kind: 'secondary', name: 'Seeker Pods', description: 'Hold E to lock on, release to loose four homing missiles.', minTier: 1, color: 0xff6b4f },
    { id: 'rockets', kind: 'secondary', name: 'Cluster Rockets', description: 'Press E to dump a spread of fast dumbfire rockets.', minTier: 1, color: 0xffa23d },
    { id: 'mines', kind: 'secondary', name: 'Proximity Mines', description: 'Press E to drop a mine behind you. Lure pursuers over it.', minTier: 2, color: 0xffd23f },
    { id: 'torpedo', kind: 'secondary', name: 'Heavy Torpedo', description: 'Hold E to lock, release to launch a slow torpedo that guts big hulls.', minTier: 3, color: 0xff4fa8 },

    { id: 'booster', kind: 'device', name: 'Shield Booster', description: 'Press G to pour energy into your shield.', minTier: 1, color: 0x6fd8ff },
    { id: 'decoy', kind: 'device', name: 'Holo Decoy', description: 'Press G to drop a hologram that pulls enemy fire.', minTier: 1, color: 0x9fffd9 },
    { id: 'sentry', kind: 'device', name: 'Sentry Drone', description: 'Press G to deploy an armed sentry that holds position.', minTier: 2, color: 0xffd35e },
    { id: 'cloak', kind: 'device', name: 'Phase Cloak', description: 'Press G to vanish from enemy sensors. Firing breaks it; bosses see through it.', minTier: 3, color: 0xc49bff },
    { id: 'dilator', kind: 'device', name: 'Time Dilator', description: 'Press G to slow every enemy and enemy shot around you.', minTier: 4, color: 0x7fd4ff }
]

export function voidItemType(id: string) {
    return VOID_ITEM_TYPES.find(t => t.id === id) ?? null
}

/** Base stats for armour and shield types, per tier power. */
const DEFENCE_BASE: Record<string, { hull?: number, resist?: number, shield?: number, regen?: number, delay?: number }> = {
    plating: { hull: 60 },
    bulkhead: { hull: 40, resist: 0.08 },
    deflector: { shield: 45, regen: 0.12, delay: 2.8 },
    regenerator: { shield: 28, regen: 0.26, delay: 1.6 }
}

// ─── Affixes ────────────────────────────────────────────────────────────────

export interface VoidAffix {
    id: string
    name: string
    kinds: VoidItemKind[]
    min: number
    max: number
    /** How to print a rolled value. */
    format: 'pct' | 'pctNeg'
}

export const VOID_AFFIXES: VoidAffix[] = [
    { id: 'damage', name: 'Damage', kinds: ['gun', 'turret'], min: 0.04, max: 0.12, format: 'pct' },
    { id: 'rate', name: 'Fire rate', kinds: ['gun', 'turret'], min: 0.03, max: 0.1, format: 'pct' },
    { id: 'crit', name: 'Crit chance', kinds: ['gun', 'turret'], min: 0.03, max: 0.08, format: 'pct' },
    { id: 'range', name: 'Range', kinds: ['gun', 'turret'], min: 0.08, max: 0.2, format: 'pct' },
    { id: 'hull', name: 'Hull', kinds: ['armor'], min: 0.05, max: 0.14, format: 'pct' },
    { id: 'resist', name: 'Damage taken', kinds: ['armor'], min: 0.02, max: 0.05, format: 'pctNeg' },
    { id: 'repair', name: 'Hull repair /s', kinds: ['armor'], min: 0.002, max: 0.006, format: 'pct' },
    { id: 'capacity', name: 'Shield', kinds: ['shield'], min: 0.05, max: 0.14, format: 'pct' },
    { id: 'regen', name: 'Recharge', kinds: ['shield'], min: 0.08, max: 0.22, format: 'pct' },
    { id: 'delay', name: 'Recharge delay', kinds: ['shield'], min: 0.08, max: 0.2, format: 'pctNeg' },
    { id: 'ammo', name: 'Ammo', kinds: ['secondary'], min: 0.15, max: 0.4, format: 'pct' },
    { id: 'warhead', name: 'Warhead damage', kinds: ['secondary'], min: 0.06, max: 0.16, format: 'pct' },
    { id: 'reload', name: 'Reload', kinds: ['secondary'], min: 0.08, max: 0.2, format: 'pctNeg' },
    { id: 'cooldown', name: 'Cooldown', kinds: ['device'], min: 0.05, max: 0.15, format: 'pctNeg' },
    { id: 'duration', name: 'Duration', kinds: ['device'], min: 0.08, max: 0.25, format: 'pct' }
]

export function voidAffix(id: string) {
    return VOID_AFFIXES.find(a => a.id === id) ?? null
}

// ─── Relic mods ─────────────────────────────────────────────────────────────

export type VoidModId = 'chain' | 'burn' | 'overcharge' | 'frost' | 'prism' | 'reactive' | 'nanoweave' | 'surge' | 'static'

export interface VoidMod {
    id: VoidModId
    name: string
    description: string
    kinds: VoidItemKind[]
    color: number
    /** Relative drop weight. */
    weight: number
}

export const VOID_MODS: VoidMod[] = [
    { id: 'chain', name: 'Arc Coil', description: 'Hits arc to a second hostile for 35% damage.', kinds: ['gun', 'turret'], color: 0x8fb8ff, weight: 10 },
    { id: 'burn', name: 'Thermite Core', description: 'Hits set targets burning for 40% extra damage over 2s.', kinds: ['gun', 'turret'], color: 0xff7a2e, weight: 10 },
    { id: 'overcharge', name: 'Capacitor Bank', description: 'Every fifth shot hits for triple damage.', kinds: ['gun', 'turret'], color: 0xfff27a, weight: 8 },
    { id: 'frost', name: 'Cryo Shell', description: 'Hits slow hostiles by 30% for 1.5s.', kinds: ['gun', 'turret'], color: 0x9fe8ff, weight: 8 },
    { id: 'prism', name: 'Prism Lens', description: '+8% crit chance, and crits hit for triple.', kinds: ['gun', 'turret'], color: 0xff7ae6, weight: 5 },
    { id: 'reactive', name: 'Reactive Plating', description: 'Hull hits blast half the damage back at the nearest hostile.', kinds: ['armor'], color: 0xffc27a, weight: 8 },
    { id: 'nanoweave', name: 'Nanoweave', description: 'Slowly repairs 1% hull per second.', kinds: ['armor'], color: 0x7dff9a, weight: 8 },
    { id: 'surge', name: 'Surge Capacitor', description: 'When the shield breaks it refills 50% after 1.5s. Once every 25s.', kinds: ['shield'], color: 0x6fd8ff, weight: 8 },
    { id: 'static', name: 'Static Field', description: 'Shield hits zap the nearest hostile.', kinds: ['shield'], color: 0xc49bff, weight: 8 }
]

export const VOID_MOD_IDS: VoidModId[] = VOID_MODS.map(m => m.id)

export function voidMod(id: string | null | undefined) {
    return VOID_MODS.find(m => m.id === id) ?? null
}

// ─── Items ──────────────────────────────────────────────────────────────────

export interface VoidItem {
    id: string
    kind: VoidItemKind
    type: string
    tier: number
    rarity: number
    level: number
    affixes: Record<string, number>
    mod: string | null
}

export function voidItemLevelMult(level: number) {
    return 1 + 0.08 * Math.max(0, Math.min(VOID_ITEM_MAX_LEVEL, level))
}

/** Tier, rarity and level folded into one multiplier. */
export function voidItemPower(item: Pick<VoidItem, 'tier' | 'rarity' | 'level'> & { affixes?: Record<string, number> }) {
    // A blueprint-built MkII runs a notch hotter than its tier.
    const mk2 = item.affixes?.mk2 ? 1.12 : 1
    return voidTierPower(item.tier) * (VOID_RARITIES[item.rarity]?.mult ?? 1) * voidItemLevelMult(item.level) * mk2
}

export function voidItemName(item: Pick<VoidItem, 'type' | 'tier'> & { affixes?: Record<string, number> }) {
    return `${voidItemType(item.type)?.name ?? item.type}${item.affixes?.mk2 ? ' MkII' : ''}`
}

// ─── Crafting ───────────────────────────────────────────────────────────────

const TIER_RECIPES: VoidResourceBundle[] = [
    { ferrite: 220, scrap: 80 },
    { ferrite: 250, cobalt: 220, scrap: 120 },
    { cobalt: 420, iridium: 280, alloy: 40 },
    { iridium: 700, xenite: 340, alloy: 120 },
    { iridium: 800, xenite: 700, alloy: 160, core: 1 }
]
const TIER_COINS = [50_000, 400_000, 2_500_000, 10_000_000, 40_000_000]
const TIER_GEMS = [0, 0, 0, 1, 3]
/** Upgrade material share per tier: cheap to level early gear, heavier late. */
const TIER_UPGRADE_SHARE = [0.12, 0.15, 0.18, 0.2, 0.22]
const KIND_WEIGHT: Record<VoidItemKind, number> = { gun: 1.2, turret: 1, armor: 0.9, shield: 1, secondary: 1.1, device: 1.3 }

export interface VoidItemPrice {
    resources: VoidResourceBundle
    coins: number
    gems: number
}

function scaleBundle(bundle: VoidResourceBundle, factor: number): VoidResourceBundle {
    const out: VoidResourceBundle = {}
    for (const [id, amount] of Object.entries(bundle)) {
        // Warp cores are counted one by one and never scaled down to zero.
        const n = id === 'core' ? amount! : Math.round(amount! * factor / 10) * 10
        if (n > 0) out[id as VoidResourceId] = n
    }
    return out
}

export function voidCraftCost(kind: VoidItemKind, tier: number): VoidItemPrice {
    const t = Math.max(1, Math.min(VOID_MAX_TIER, tier))
    const w = KIND_WEIGHT[kind]
    return {
        resources: scaleBundle(TIER_RECIPES[t - 1]!, w),
        coins: Math.round(TIER_COINS[t - 1]! * w / 1000) * 1000,
        gems: TIER_GEMS[t - 1]!
    }
}

/**
 * Levelling an item: the first few levels are cheap, the last few cost as
 * much as a stack of new crafts. Coins climb faster than materials.
 */
export function voidItemUpgradeCost(item: Pick<VoidItem, 'kind' | 'tier' | 'level'>): VoidItemPrice | null {
    if (item.level >= VOID_ITEM_MAX_LEVEL) return null
    const craft = voidCraftCost(item.kind, item.tier)
    const share = TIER_UPGRADE_SHARE[Math.max(1, Math.min(VOID_MAX_TIER, item.tier)) - 1]!
    const resources = scaleBundle({ ...craft.resources, core: 0 }, share * Math.pow(1.36, item.level))
    // Deep tiers need a warp core for the final level.
    if (item.tier >= 4 && item.level === 9) resources.core = 1
    return {
        resources,
        coins: Math.round(craft.coins * 0.08 * Math.pow(1.5, item.level) / 1000) * 1000,
        gems: item.tier >= 4 && item.level >= 9 ? TIER_GEMS[item.tier - 1]! : 0
    }
}

/** Salvage returns a quarter of the craft materials. */
export function voidSalvageValue(item: Pick<VoidItem, 'kind' | 'tier'>): VoidResourceBundle {
    const craft = voidCraftCost(item.kind, item.tier)
    return scaleBundle({ ...craft.resources, core: 0 }, 0.25)
}

export function voidCanCraftTier(tier: number, highestSectorCleared: number) {
    return tier >= 1 && tier <= Math.min(VOID_MAX_TIER, highestSectorCleared + 1)
}

/**
 * Rolls a crafted item. `rand` is injected so the server can use its CSPRNG
 * and tests can pin outcomes.
 */
export function voidRollItem(kind: VoidItemKind, type: string, tier: number, rand: () => number, blueprint = false): Omit<VoidItem, 'id'> {
    const total = VOID_RARITIES.reduce((s, r) => s + r.weight, 0)
    let roll = rand() * total
    let rarity = 0
    for (let i = 0; i < VOID_RARITIES.length; i++) {
        roll -= VOID_RARITIES[i]!.weight
        if (roll < 0) {
            rarity = i
            break
        }
    }
    const pool = VOID_AFFIXES.filter(a => a.kinds.includes(kind))
    const affixes: Record<string, number> = {}
    const count = Math.min(pool.length, VOID_RARITIES[rarity]!.affixes)
    const options = [...pool]
    for (let i = 0; i < count; i++) {
        const pick = options.splice(Math.floor(rand() * options.length), 1)[0]!
        // Higher rarities roll toward the top of the range.
        const r = Math.min(1, rand() * (1 + rarity * 0.12))
        affixes[pick.id] = Math.round((pick.min + (pick.max - pick.min) * r) * 1000) / 1000
    }
    if (blueprint) {
        affixes.mk2 = 1
        // A blueprint never produces junk.
        if (rarity === 0) rarity = 1
        if (!Object.keys(affixes).some(k => k !== 'mk2') && pool.length) {
            const pick = pool[Math.floor(rand() * pool.length)]!
            affixes[pick.id] = Math.round((pick.min + (pick.max - pick.min) * rand()) * 1000) / 1000
        }
    }
    return { kind, type, tier, rarity, level: 0, affixes, mod: null }
}

/** Levels that grant a bonus affix when reached. */
export const VOID_ITEM_MILESTONES = [5, 10]

/**
 * A milestone bonus: a new affix from the item's pool, or, when every affix is
 * already on it, a boost to its weakest one.
 */
export function voidRollBonusAffix(item: Pick<VoidItem, 'kind' | 'rarity' | 'affixes'>, rand: () => number): Record<string, number> {
    const affixes = { ...(item.affixes ?? {}) }
    const pool = VOID_AFFIXES.filter(a => a.kinds.includes(item.kind))
    const fresh = pool.filter(a => affixes[a.id] === undefined)
    const r = Math.min(1, rand() * (1 + item.rarity * 0.12))
    if (fresh.length) {
        const pick = fresh[Math.floor(rand() * fresh.length)]!
        affixes[pick.id] = Math.round((pick.min + (pick.max - pick.min) * r) * 1000) / 1000
        return affixes
    }
    const weakest = pool.map(a => ({ a, frac: (affixes[a.id]! - a.min) / (a.max - a.min) })).sort((x, y) => x.frac - y.frac)[0]
    if (weakest) affixes[weakest.a.id] = Math.round((affixes[weakest.a.id]! + (weakest.a.max - weakest.a.min) * 0.5) * 1000) / 1000
    return affixes
}

/**
 * Gear salvaged in a run: a random kind and type the pilot could craft at
 * this tier, with rarity rolled twice and the better result kept.
 */
export function voidRollSalvagedGear(tier: number, rand: () => number): Omit<VoidItem, 'id'> {
    const kinds: [VoidItemKind, number][] = [['turret', 3], ['armor', 2], ['shield', 2], ['gun', 1], ['secondary', 1], ['device', 1]]
    const total = kinds.reduce((s, [, w]) => s + w, 0)
    let roll = rand() * total
    let kind: VoidItemKind = 'turret'
    for (const [k, w] of kinds) {
        roll -= w
        if (roll < 0) {
            kind = k
            break
        }
    }
    const types = VOID_ITEM_TYPES.filter(t => t.kind === kind && t.minTier <= tier)
    const type = types[Math.floor(rand() * types.length)] ?? VOID_ITEM_TYPES.find(t => t.kind === kind)!
    const a = voidRollItem(kind, type.id, Math.max(type.minTier, tier), rand)
    const b = voidRollItem(kind, type.id, Math.max(type.minTier, tier), rand)
    return a.rarity >= b.rarity ? a : b
}

export function voidRollMod(rand: () => number): VoidModId {
    const total = VOID_MODS.reduce((s, m) => s + m.weight, 0)
    let roll = rand() * total
    for (const mod of VOID_MODS) {
        roll -= mod.weight
        if (roll < 0) return mod.id
    }
    return VOID_MODS[0]!.id
}

// ─── Fitted stats ───────────────────────────────────────────────────────────

/** What a gun or turret item does in flight. `damage` is final per shot. */
export interface VoidWeaponFit {
    itemId: string
    type: string
    tier: number
    rarity: number
    level: number
    /** Multiplier on the type's base damage (tier, rarity, level, affix). */
    power: number
    rate: number
    range: number
    crit: number
    mod: VoidModId | null
    damageType: VoidDamageType
    /** Secondary: ammo multiplier. Device: duration multiplier. */
    extra: number
    /** Secondary reload or device cooldown multiplier. */
    cycle: number
}

export function voidWeaponFit(item: VoidItem): VoidWeaponFit {
    const a = item.affixes ?? {}
    return {
        itemId: item.id,
        type: item.type,
        tier: item.tier,
        rarity: item.rarity,
        level: item.level,
        power: voidItemPower(item) * (1 + (a.damage ?? 0) + (a.warhead ?? 0)),
        rate: 1 + (a.rate ?? 0),
        range: 1 + (a.range ?? 0),
        crit: (a.crit ?? 0) + (item.mod === 'prism' ? 0.08 : 0),
        mod: (voidMod(item.mod)?.kinds.includes(item.kind) ? item.mod : null) as VoidModId | null,
        damageType: VOID_DAMAGE_TYPE[item.type] ?? 'explosive',
        extra: item.kind === 'secondary' ? 1 + (a.ammo ?? 0) : 1 + (a.duration ?? 0),
        cycle: item.kind === 'secondary'
            ? (1 - (a.reload ?? 0)) / (1 + item.level * 0.02)
            : (1 - (a.cooldown ?? 0)) * (1 - item.level * 0.025) * (1 - item.rarity * 0.03)
    }
}

export interface VoidDefenceStats {
    hull: number
    resist: number
    repair: number
    shield: number
    regen: number
    delay: number
    mods: VoidModId[]
}

/**
 * Hull and shield from fitted armour and generators, on top of the hull's own
 * base. Resist is capped so nothing becomes immune.
 */
export function voidDefenceStats(baseHull: number, baseShield: number, armor: VoidItem[], shields: VoidItem[]): VoidDefenceStats {
    let hull = baseHull
    let resist = 0
    let repair = 0
    let shield = baseShield
    let regenWeighted = 0
    let delay = 3
    const mods: VoidModId[] = []
    for (const item of armor) {
        const base = DEFENCE_BASE[item.type] ?? DEFENCE_BASE.plating!
        const power = voidItemPower(item)
        hull += (base.hull ?? 0) * power * (1 + (item.affixes.hull ?? 0))
        resist += (base.resist ?? 0) + (item.affixes.resist ?? 0)
        repair += item.affixes.repair ?? 0
        if (item.mod && voidMod(item.mod)?.kinds.includes('armor')) mods.push(item.mod as VoidModId)
    }
    let shieldFromGear = 0
    for (const item of shields) {
        const base = DEFENCE_BASE[item.type] ?? DEFENCE_BASE.deflector!
        const amount = (base.shield ?? 0) * voidItemPower(item) * (1 + (item.affixes.capacity ?? 0))
        shieldFromGear += amount
        regenWeighted += amount * (base.regen ?? 0.12) * (1 + (item.affixes.regen ?? 0))
        delay = Math.min(delay, (base.delay ?? 2.8) * (1 - (item.affixes.delay ?? 0)))
        if (item.mod && voidMod(item.mod)?.kinds.includes('shield')) mods.push(item.mod as VoidModId)
    }
    shield += shieldFromGear
    // Without a generator the hull's emitter recharges slowly.
    const regen = shieldFromGear > 0 ? regenWeighted / shieldFromGear : 0.08
    return {
        hull: Math.round(hull),
        resist: Math.min(0.4, resist),
        repair,
        shield: Math.round(shield),
        regen,
        delay: shieldFromGear > 0 ? delay : 3.5,
        mods
    }
}

/** A single comparable number for an item, used for sorting and the hangar. */
export function voidItemScore(item: VoidItem) {
    const affixSum = Object.entries(item.affixes ?? {}).reduce((s, [k, v]) => s + (k === 'mk2' ? 0 : v), 0)
    return Math.round(voidItemPower(item) * 100 * (1 + affixSum) + (item.mod ? 25 : 0))
}
