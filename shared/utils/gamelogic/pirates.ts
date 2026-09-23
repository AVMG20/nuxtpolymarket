import { randomFloat, randomWeighted } from '../random'

// ─── Pirate Raid ────────────────────────────────────────────────────────────

// The voyage was originally balanced around eight minutes. Timeline-based
// events use this ratio so the complete arc now fits into six minutes while
// preserving the same relative unlocks, event count, and final pressure.
export const PIRATE_LEGACY_RUN_DURATION_MS = 8 * 60 * 1000
export const PIRATE_RUN_DURATION_MS = 6 * 60 * 1000
export const PIRATE_TIMELINE_SCALE = PIRATE_RUN_DURATION_MS / PIRATE_LEGACY_RUN_DURATION_MS
export const PIRATE_OVERRUN_START_MS = PIRATE_RUN_DURATION_MS * 0.75
export const PIRATE_LATE_BOSS_PHASE_MS = PIRATE_RUN_DURATION_MS * 0.875

/**
 * The sea, in world units. The whole map is always in view (scaled to fit), so
 * this is also the design canvas every range and radius is measured against.
 */
export const PIRATE_WORLD_W = 1750
export const PIRATE_WORLD_H = 1025

function pirateTimelineMs(ms: number) {
  return Math.round(ms * PIRATE_TIMELINE_SCALE)
}

/**
 * Ships are drawn procedurally (app/utils/pirates-engine/ships.ts), so a skin
 * is just a palette: planking, deck, trim, sails and an accent that lights the
 * lanterns and figurehead. `glow` skins add a soft aura around the hull.
 */
export interface PirateSkinPalette {
  hull: number
  deck: number
  trim: number
  sail: number
  accent: number
  glow?: boolean
}

export const PIRATE_SHIP_SKINS = [
  { id: 'starter', name: 'Golden Brigantine', cost: 0, palette: { hull: 0x7a4a24, deck: 0xc08a55, trim: 0xf4c542, sail: 0xf3ead2, accent: 0xfacc15 }, description: 'The dependable brig every captain starts with.' },
  { id: 'crimson-privateer', name: 'Crimson Privateer', cost: 50, palette: { hull: 0x4a1414, deck: 0x9a4a2c, trim: 0xd9dde3, sail: 0xc0262d, accent: 0xf8fafc }, description: 'Polished mahogany, silver trim, and privateer-red sails.' },
  { id: 'emerald-serpent', name: 'Emerald Serpent', cost: 250, palette: { hull: 0x0b3d33, deck: 0x1f6f5c, trim: 0xc7d2da, sail: 0x2fbf8a, accent: 0x6ee7b7 }, description: 'Jade lacquer, silver scales, and an ornate serpent prow.' },
  { id: 'royal-aether', name: 'Royal Aether', cost: 1000, palette: { hull: 0x241046, deck: 0x46207e, trim: 0xe9d5ff, sail: 0x6d3fd1, accent: 0xc084fc, glow: true }, description: 'A regal warship lined with luminous violet crystals.' },
  { id: 'crown-of-tides', name: 'Crown of Tides', cost: 10_000, palette: { hull: 0xa9791a, deck: 0xe8b93a, trim: 0x1d4ed8, sail: 0xfdf3d0, accent: 0x60a5fa, glow: true }, description: 'Pure gold and sapphire excess. The ultimate captain flex.' }
] as const satisfies readonly { id: string, name: string, cost: number, palette: PirateSkinPalette, description: string }[]

export type PirateShipSkinId = typeof PIRATE_SHIP_SKINS[number]['id']

export function pirateShipSkin(id: string) {
  return PIRATE_SHIP_SKINS.find(skin => skin.id === id) ?? PIRATE_SHIP_SKINS[0]
}

// One right-click ability may be equipped at a time. The powder keg remains
// the free starter option; the other techniques are permanent coin unlocks.
//
// Cooldowns are absolute wall-clock milliseconds (deliberately NOT run through
// pirateTimelineMs) and are quoted as a level-1 → level-5 pair. Levels buy
// damage *and* frequency, but the floor is what actually keeps an ability
// honest: Hunter's Chain takes ~14s to empty its orbit, so anything under ~30s
// would hand it permanent uptime.
export const PIRATE_ABILITIES = [
  { id: 'bomb', name: 'Powder Keg', cost: 0, cooldownMs: 30_000, minCooldownMs: 20_000, icon: 'i-lucide-bomb', accent: 'warning', description: 'Lob a heavy keg that explodes in a wide area.' },
  { id: 'seekers', name: "Hunter's Chain", cost: 250_000, cooldownMs: 46_000, minCooldownMs: 32_000, icon: 'i-lucide-rocket', accent: 'error', description: 'Bind eight spectral warheads into orbit; one launches every two seconds at your nearest foe for heavy single-target damage.' },
  { id: 'consort', name: 'Ghostly Consort', cost: 250_000, cooldownMs: 42_000, minCooldownMs: 28_000, icon: 'i-lucide-ship', accent: 'info', description: 'Summon an allied escort that shadows your ship and fires your best cannon at reduced damage. It can be shot down — and the cooldown only starts once it sinks.' },
  { id: 'maelstrom', name: "Kraken's Maw", cost: 250_000, cooldownMs: 50_000, minCooldownMs: 32_000, icon: 'i-lucide-tornado', accent: 'primary', description: 'Open a damaging whirlpool that drags nearby ships toward its center.' },
  { id: 'firestorm', name: 'Hellfire Barrage', cost: 250_000, cooldownMs: 44_000, minCooldownMs: 30_000, icon: 'i-lucide-flame', accent: 'warning', description: 'Saturate a huge stretch of sea with seven devastating shells. Each lands somewhere random inside the zone — a gamble that can wipe a fleet or hit nothing but water.' },
  { id: 'tidal', name: 'Rogue Wave', cost: 250_000, cooldownMs: 40_000, minCooldownMs: 28_000, icon: 'i-lucide-waves', accent: 'info', description: 'Roll a towering wave out toward the cursor. It smashes every ship in its path, shoves them back, and washes away enemy shot and mines.' }
] as const

// ─── Rogue Wave ─────────────────────────────────────────────────────────────
// A wide wall of water that rolls out from the ship toward the aim point. It
// is the defensive pick: every ship it passes takes one heavy hit and is
// shoved back, and it erases enemy projectiles and sea mines along the way.
export const PIRATE_ROGUE_WAVE_LENGTH = 560
export const PIRATE_ROGUE_WAVE_WIDTH = 300
export const PIRATE_ROGUE_WAVE_SPEED = 620
export const PIRATE_ROGUE_WAVE_KNOCKBACK = 170

/** Damage the Rogue Wave deals to each ship it rolls over. */
export function pirateRogueWaveDamage(power: number, level = 1) {
  return Math.max(62, Math.round((55 + power * 0.72) * pirateAbilityLevelMultiplier(level)))
}

// ─── Hellfire Barrage ───────────────────────────────────────────────────────
// A deliberate gamble. The marked zone is enormous, but the seven shells
// scatter randomly inside it, so a lucky cluster deletes a fleet while an
// unlucky spread mostly geysers seawater. Damage per shell is correspondingly
// high to make the gamble worth taking.
export const PIRATE_HELLFIRE_ZONE_RADIUS = 270
export const PIRATE_HELLFIRE_SHELL_COUNT = 8
export const PIRATE_HELLFIRE_BLAST_RADIUS = 110

/** Damage of a single Hellfire shell. */
export function pirateHellfireShellDamage(power: number, level = 1) {
  return Math.max(80, Math.round((70 + power * 0.93) * pirateAbilityLevelMultiplier(level)))
}

// ─── Ability levels ─────────────────────────────────────────────────────────
// Every right-click ability has its own five-level upgrade track. Without one,
// a flat power coefficient meant abilities were excellent early and irrelevant
// by the time enemy hulls carried a difficulty-1000 multiplier. Levels are the
// lever that keeps them relevant into the top brackets — a fully upgraded
// ability should comfortably delete the opening waves of a max-difficulty
// voyage, which is exactly what its ~11m total investment is paying for.
export const PIRATE_ABILITY_MAX_LEVEL = 5
export const PIRATE_ABILITY_UPGRADE_BASE_COST = 400_000
export const PIRATE_ABILITY_UPGRADE_GROWTH = 2.6

/** Coin cost to take an ability from `level` to `level + 1`. Null at max. */
export function pirateAbilityUpgradeCost(level: number): number | null {
  if (level >= PIRATE_ABILITY_MAX_LEVEL) return null
  return Math.round(PIRATE_ABILITY_UPGRADE_BASE_COST * Math.pow(PIRATE_ABILITY_UPGRADE_GROWTH, Math.max(0, level - 1)))
}

export function pirateClampAbilityLevel(level: number) {
  const finite = Number.isFinite(level) ? Math.floor(level) : 1
  return Math.max(1, Math.min(PIRATE_ABILITY_MAX_LEVEL, finite))
}

/**
 * Damage multiplier for an ability at a given level — 1x at level 1 rising to
 * 3.2x at level 5. Combined with the per-ability power coefficients below,
 * level 5 on a maxed ship lands in the 1000-1200 range per hit, enough to
 * one-shot the common hulls of an opening difficulty-1000 wave.
 */
export function pirateAbilityLevelMultiplier(level: number) {
  return 1 + (pirateClampAbilityLevel(level) - 1) * 0.55
}

/**
 * Cooldown for an ability at a given level, interpolated linearly from its
 * level-1 ceiling down to its level-5 floor. Upgrades therefore buy both a
 * bigger hit and a faster one — but the floors stay long enough that no
 * ability approaches permanent uptime.
 */
export function pirateAbilityCooldownMs(id: string, level = 1) {
  const ability = pirateAbility(id)
  const t = (pirateClampAbilityLevel(level) - 1) / (PIRATE_ABILITY_MAX_LEVEL - 1)
  return Math.round(ability.cooldownMs + (ability.minCooldownMs - ability.cooldownMs) * t)
}

// ─── Hunter's Chain ─────────────────────────────────────────────────────────
// Eight warheads latch into orbit and fire one at a time. It is pure
// single-target damage with a long total delivery window (14s for the full
// set), so each warhead hits considerably harder than a seeker used to.
export const PIRATE_HUNTER_CHAIN_COUNT = 8
export const PIRATE_HUNTER_CHAIN_INTERVAL_MS = 2000

/** Damage per Hunter's Chain warhead. */
export function pirateHunterChainDamage(power: number, level = 1) {
  return Math.max(8, Math.round((6 + power * 0.072) * pirateAbilityLevelMultiplier(level)))
}

// ─── Powder Keg ─────────────────────────────────────────────────────────────
// The free starter ability. It keeps a wide blast and the shortest cooldown,
// so its per-hit number sits below the paid abilities at equal level.

/** Powder Keg blast damage. */
export function pirateBombDamage(power: number, level = 1) {
  return Math.max(60, Math.round((43 + power * 0.58) * pirateAbilityLevelMultiplier(level)))
}

// ─── Kraken's Maw ───────────────────────────────────────────────────────────
// Seven pulses over ~4 seconds, each hitting everything in the whirlpool while
// dragging it inward. Per-pulse damage is small; the total across a packed
// fleet is the largest of any ability.
export const PIRATE_MAELSTROM_RADIUS = 215
/** Share of the distance to the eye each pulse drags a ship. */
export const PIRATE_MAELSTROM_PULL = 0.2

/** Damage of a single Kraken's Maw pulse. */
export function pirateMaelstromPulseDamage(power: number, level = 1) {
  return Math.max(34, Math.round((30 + power * 0.38) * pirateAbilityLevelMultiplier(level)))
}

// ─── Ghostly Consort ────────────────────────────────────────────────────────
// The escort starts as a half-strength shadow of the captain and grows into a
// full mirror of their accuracy and armour. Its hull stays deliberately thin at
// every level, so it is always something the fleet can shoot down — and unlike
// the other abilities its cooldown does not start on cast, it starts when the
// escort sinks. Only one may be at sea at a time.
export const PIRATE_CONSORT_FOLLOW_DISTANCE = 88

/** Fraction of the captain's attack rating and defense the escort inherits. */
export function pirateConsortStatFraction(level = 1) {
  return 0.5 + (pirateClampAbilityLevel(level) - 1) * 0.125
}

/**
 * Fraction of the captain's cannon damage the escort actually deals. Held well
 * below its accuracy scaling on purpose: the consort is meant to be a durable
 * second angle of fire and a decoy that soaks aggro, never a straight
 * doubling of the player's broadside.
 */
export function pirateConsortDamageFraction(level = 1) {
  return 0.8 + (pirateClampAbilityLevel(level) - 1) * 0.05
}

/** Fraction of the captain's max hull the escort is built with. */
export function pirateConsortHpFraction(level = 1) {
  return 0.2 + (pirateClampAbilityLevel(level) - 1) * 0.05
}

/** Gun ports on the escort — a second one opens up at level 3. */
export function pirateConsortCannonCount(level = 1) {
  return 2 + Math.floor((pirateClampAbilityLevel(level) - 1) / 2)
}

export type PirateAbilityId = typeof PIRATE_ABILITIES[number]['id']
export const PIRATE_STARTER_ABILITY_ID: PirateAbilityId = 'bomb'

export function pirateAbility(id: string) {
  return PIRATE_ABILITIES.find(ability => ability.id === id) ?? PIRATE_ABILITIES[0]
}

// ─── Salvage upgrades ───────────────────────────────────────────────────────
// Crates found at sea hold one upgrade each. They last for the rest of the
// voyage, so a handful of pickups shapes the whole run into a build. There are
// deliberately few of them and every one changes how the ship plays; the
// rarity decides how often a crate rolls it and the colour it glows.

export const PIRATE_RARITIES = [
  { id: 'common', name: 'Common', color: 0xa1a1aa, weight: 44 },
  { id: 'uncommon', name: 'Uncommon', color: 0x4ade80, weight: 28 },
  { id: 'rare', name: 'Rare', color: 0x60a5fa, weight: 16 },
  { id: 'epic', name: 'Epic', color: 0xc084fc, weight: 9 },
  { id: 'legendary', name: 'Legendary', color: 0xfacc15, weight: 3 }
] as const

export type PirateRarity = typeof PIRATE_RARITIES[number]['id']

export function pirateRarity(id: PirateRarity) {
  return PIRATE_RARITIES.find(rarity => rarity.id === id)!
}

export type PiratePowerUpId =
  | 'oak-planking'
  | 'quick-hands'
  | 'following-wind'
  | 'crows-nest'
  | 'tide-ward'
  | 'blast-powder'
  | 'stormglass'
  | 'ghost-crew'
  | 'titan-shot'
  | 'krakens-heart'

export interface PiratePowerUpDefinition {
  id: PiratePowerUpId
  name: string
  rarity: PirateRarity
  /** Lucide icon shown on the crate label and the HUD chip. */
  icon: string
  /** One line per stack level, so the HUD and wiki can say exactly what the next pickup adds. */
  description: string
  maxStacks: number
}

export const PIRATE_POWER_UPS: PiratePowerUpDefinition[] = [
  { id: 'oak-planking', name: 'Oak Planking', rarity: 'common', icon: 'i-lucide-shield-plus', description: '+25% max hull, repaired on pickup', maxStacks: 3 },
  { id: 'quick-hands', name: 'Quick Hands', rarity: 'common', icon: 'i-lucide-timer-reset', description: 'Cannons reload 20% faster', maxStacks: 3 },
  { id: 'following-wind', name: 'Following Wind', rarity: 'common', icon: 'i-lucide-wind', description: '+20% sailing speed; under full sail 15% of cannon fire misses you', maxStacks: 2 },
  { id: 'crows-nest', name: "Crow's Nest", rarity: 'uncommon', icon: 'i-lucide-telescope', description: '+20% cannon range and +25% accuracy', maxStacks: 2 },
  { id: 'tide-ward', name: 'Tide Ward', rarity: 'uncommon', icon: 'i-lucide-shield', description: 'A shield worth 20% of max hull that refills after 5s unhit', maxStacks: 2 },
  { id: 'blast-powder', name: 'Blast Powder', rarity: 'rare', icon: 'i-lucide-bomb', description: 'Hits deal +20% damage and splash 60% of it around the target', maxStacks: 2 },
  { id: 'stormglass', name: 'Stormglass', rarity: 'epic', icon: 'i-lucide-zap', description: 'Hits may arc lightning through up to 4 nearby ships', maxStacks: 2 },
  { id: 'ghost-crew', name: 'Ghost Crew', rarity: 'epic', icon: 'i-lucide-ghost', description: 'A spectral sloop sails with you, firing your best cannon', maxStacks: 2 },
  { id: 'titan-shot', name: 'Titan Shot', rarity: 'legendary', icon: 'i-lucide-circle-dot', description: 'Every 5th shot is a titan ball: 5x damage and a shockwave', maxStacks: 1 },
  { id: 'krakens-heart', name: "Kraken's Heart", rarity: 'legendary', icon: 'i-lucide-heart-pulse', description: '+35% damage, sinking ships mends your hull, abilities recharge 30% faster', maxStacks: 1 }
]

export function piratePowerUp(id: PiratePowerUpId) {
  return PIRATE_POWER_UPS.find(powerUp => powerUp.id === id)!
}

// Per-stack effect sizes. The engine and the wiki both read these, so the
// numbers a player reads are the numbers the game uses.
export const PIRATE_UPGRADE_EFFECTS = {
  oakHullPerStack: 0.25,
  quickHandsReloadPerStack: 0.2,
  followingWindSpeedPerStack: 0.2,
  /** Share of enemy cannonballs that miss a ship sailing at 60%+ of its top speed, per stack. */
  followingWindEvasionPerStack: 0.15,
  crowsNestRangePerStack: 0.2,
  crowsNestAccuracyPerStack: 0.25,
  tideWardShieldPerStack: 0.2,
  tideWardRechargeDelayMs: 5000,
  /** Splash damage fraction and radius at 1 and 2 stacks. */
  blastSplash: [0.6, 0.9] as const,
  /** Extra damage on the struck hull itself, at 1 and 2 stacks. */
  blastDirect: [0.2, 0.35] as const,
  blastRadius: [100, 130] as const,
  /** Chance a hit arcs, jumps and damage fraction per jump at 1 and 2 stacks. */
  stormChance: [0.5, 0.75] as const,
  stormJumps: 4,
  stormDamage: 1,
  stormRange: 400,
  ghostCrewDamage: 0.7,
  /** Barrels on each Ghost Crew sloop. */
  ghostCrewGuns: 2,
  titanEvery: 5,
  titanDamage: 5,
  titanRadius: 120,
  heartDamage: 0.35,
  // Healing is measured in ships, not raw damage: dealing a whole hull's worth
  // of damage to enemies mends this share of your own max hull. Plain damage
  // lifesteal scaled with the broadside, so on a maxed ship it out-healed a
  // difficulty-1000 fleet outright.
  heartLifesteal: 0.012,
  heartCooldown: 0.3
} as const

/**
 * Roll a crate: pick a rarity by weight among rarities that still have an
 * upgrade below its stack cap, then an upgrade within it. `minRarity` lifts
 * the floor (bosses always drop epic or better). Null once everything is maxed.
 */
export function pirateRollPowerUp(stacks: Partial<Record<PiratePowerUpId, number>>, minRarity: PirateRarity = 'common', rng: () => number = randomFloat): PiratePowerUpDefinition | null {
  const floor = PIRATE_RARITIES.findIndex(rarity => rarity.id === minRarity)
  const open = (rarity: PirateRarity) => PIRATE_POWER_UPS.filter(p => p.rarity === rarity && (stacks[p.id] ?? 0) < p.maxStacks)
  const rarities = PIRATE_RARITIES.filter((rarity, index) => index >= floor && open(rarity.id).length > 0)
  if (!rarities.length) {
    if (floor > 0) return pirateRollPowerUp(stacks, 'common', rng)
    return null
  }
  const rarity = randomWeighted(rarities, r => r.weight, rng)
  const pool = open(rarity.id)
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
}

// A 6-minute real-time roguelike skirmish. Ship-level upgrades (hull, speed,
// defense, ammo capacity) are bought directly; attack power instead comes from
// equipping cannons (up to 8 gun ports) bought from the armory, each with its
// own accuracy, damage, reload speed and range — and each fires on its own
// independent timer rather than the whole ship volleying together. Combat
// accuracy is RuneScape-style: an attack roll vs a defense roll decides hit or
// miss (a heavily-armored target can shrug off a hit entirely), and only a
// successful hit rolls 1..maxDamage. Every ship has unlimited basic cannonballs.
// Purchased ammo is a consumable premium stock (capacity is upgradeable) that
// adds range and damage; once it is gone, cannons keep firing basic shots.

export const PIRATE_SHIP_STAT_IDS = ['hull', 'speed', 'defense', 'ammoCapacity', 'regen'] as const
export type PirateShipStatId = typeof PIRATE_SHIP_STAT_IDS[number]

export const PIRATE_MAX_STAT_LEVEL = 10
// Life regen is a shorter track than the other stats: it starts at +1 hull per
// regen cycle (every captain owns level 1 for free) and tops out at +5.
export const PIRATE_REGEN_MAX_LEVEL = 5
// Regen kicks in once the ship has gone this long without TAKING a hit. Firing
// your own cannons no longer resets it — a captain who keeps their distance
// and never gets touched should still be topping up.
export const PIRATE_REGEN_DELAY_MS = 6000
// Repairs are slow: one full cycle heals `regenRate` hull, and each cycle is
// this long. Level 1 is therefore +1 hull every 5s rather than the old +1/sec.
export const PIRATE_REGEN_CYCLE_MS = 5000

/** Max upgrade level for a given ship stat — regen caps early, everything else at 10. */
export function pirateStatMaxLevel(statId: PirateShipStatId) {
  return statId === 'regen' ? PIRATE_REGEN_MAX_LEVEL : PIRATE_MAX_STAT_LEVEL
}
export const PIRATE_DIFFICULTY_STEP = 50
export const PIRATE_MAX_DIFFICULTY = 1000
/** A salvage crate drifts in on this clock; kills and bosses add more. */
export const PIRATE_POWER_UP_INTERVAL_MS = 32_000
export const PIRATE_POWER_UP_LIFESPAN_MS = 22_000
/** Chance an ordinary sinking leaves a crate behind. Bosses always drop an epic or better. */
export const PIRATE_POWER_UP_KILL_DROP_CHANCE = 0.04
export const PIRATE_HEALTH_PACK_KILL_DROP_CHANCE = 0.05
export const PIRATE_HEALTH_PACK_INTERVAL_MS = pirateTimelineMs(45_000)
export const PIRATE_HEALTH_PACK_LIFESPAN_MS = pirateTimelineMs(22_000)
export const PIRATE_SEA_MINE_INTERVAL_MS = pirateTimelineMs(10_000)
export const PIRATE_SEA_MINE_LIFESPAN_MS = pirateTimelineMs(30_000)

// ─── Upgrade cost curve — identical shape for every ship stat ─────────────
// Steep exponential sink: the first upgrade sits in the "extra spending
// money" range, the last (level 9 → 10) lands around 24-26m — a proper
// end-game money sink relative to the other ways to earn on the site. Base
// cost was raised 20% alongside the wider economy rebalance.
export const PIRATE_UPGRADE_BASE_COST = 24_000
export const PIRATE_UPGRADE_GROWTH = 2.4

/** Coin cost to go from `level` to `level + 1`. Null once at max level. */
export function pirateUpgradeCost(level: number, maxLevel: number = PIRATE_MAX_STAT_LEVEL): number | null {
  if (level >= maxLevel) return null
  return Math.round(PIRATE_UPGRADE_BASE_COST * Math.pow(PIRATE_UPGRADE_GROWTH, level - 1))
}

// Life regen is the strongest stat and only a 5-level track, so it would total
// far less than the 10-level stats on the shared curve. Doubling each step keeps
// it a meaningful investment rather than a cheap must-buy.
export const PIRATE_REGEN_COST_MULTIPLIER = 2

/** Coin cost to level a specific ship stat, accounting for its own cap and any per-stat price multiplier. */
export function pirateStatUpgradeCost(statId: PirateShipStatId, level: number): number | null {
  const base = pirateUpgradeCost(level, pirateStatMaxLevel(statId))
  if (base === null) return null
  return statId === 'regen' ? base * PIRATE_REGEN_COST_MULTIPLIER : base
}

function clampLevel(level: number) {
  return Math.max(1, Math.min(level, PIRATE_MAX_STAT_LEVEL))
}

/**
 * Hull repaired per PIRATE_REGEN_CYCLE_MS at a given regen level (level 1 =
 * +1 per cycle, max = +5). The engine spreads a cycle's healing evenly across
 * its duration, so level 5 reads as one hull per second rather than a lump.
 */
export function pirateRegenRate(level: number) {
  return Math.max(1, Math.min(level, PIRATE_REGEN_MAX_LEVEL))
}

/** Seconds between individual +1 hull ticks at a given regen level. */
export function pirateRegenTickIntervalMs(level: number) {
  return PIRATE_REGEN_CYCLE_MS / pirateRegenRate(level)
}

export function pirateMaxHp(level: number) {
  return 100 + (clampLevel(level) - 1) * 30
}

export function pirateShipSpeed(level: number) {
  return 220 + (clampLevel(level) - 1) * 18
}

/** Defense rating — the defense roll ceiling used in accuracy checks against this ship. */
export function pirateDefenseRating(level: number) {
  return 10 + (clampLevel(level) - 1) * 8
}

/** Max ammo the hold can carry. */
export function pirateAmmoCapacity(level: number) {
  return 240 + (clampLevel(level) - 1) * 90
}

// ─── Cannons ────────────────────────────────────────────────────────────────
export const PIRATE_MAX_CANNON_SLOTS = 8
export const PIRATE_STARTER_CANNON_TIER = 'swivel'
export const PIRATE_CANNON_SELL_REFUND_RATE = 0.2

export interface PirateCannonTier {
  id: string
  name: string
  cost: number
  attackRating: number
  maxDamage: number
  reloadMs: number
  range: number
  /** Contribution to the ship's displayed power and difficulty recommendations. */
  powerRating: number
  /** In-game muzzle, impact, and projectile accent. */
  shotColor: number
  /** Top-tier cannonballs leave a subtle colored trail. */
  shotTrail?: boolean
  /**
   * The three highest tiers fire charged shot that leaves a soft, blooming
   * "mutated" plasma wake instead of a plain trail — a purely visual marker
   * that the captain is running end-game hardware.
   */
  mutatedTrail?: boolean
}

// Costs step up ~2.6x per tier, topping out at 14m for the Leviathan's Wrath
// — the armory's own equivalent of the ship-stat/slot money sinks. Prices were
// raised ~40% across the board: cannons are the main progression lever, so with
// run payouts tripled they need to cost more to stay a meaningful money sink.
export const PIRATE_CANNON_TIERS: PirateCannonTier[] = [
  { id: 'swivel', name: 'Swivel Gun', cost: 0, attackRating: 20, maxDamage: 16, reloadMs: 1900, range: 240, powerRating: 2, shotColor: 0xa8a29e },
  { id: 'carronade', name: 'Bronze Carronade', cost: 42_000, attackRating: 22, maxDamage: 18, reloadMs: 2000, range: 250, powerRating: 4, shotColor: 0xf59e0b },
  { id: 'culverin', name: 'Iron Culverin', cost: 110_000, attackRating: 32, maxDamage: 26, reloadMs: 1800, range: 280, powerRating: 7, shotColor: 0xcbd5e1 },
  { id: 'longgun', name: 'Steel Long Gun', cost: 290_000, attackRating: 45, maxDamage: 36, reloadMs: 1600, range: 320, powerRating: 11, shotColor: 0x38bdf8 },
  { id: 'basilisk', name: 'Reinforced Basilisk', cost: 765_000, attackRating: 60, maxDamage: 48, reloadMs: 1400, range: 360, powerRating: 16, shotColor: 0xa78bfa },
  { id: 'mythril', name: 'Mythril Broadside', cost: 2_020_000, attackRating: 80, maxDamage: 65, reloadMs: 1200, range: 400, powerRating: 24, shotColor: 0x34d399, shotTrail: true, mutatedTrail: true },
  { id: 'adamantite', name: 'Adamantite Bombard', cost: 5_320_000, attackRating: 100, maxDamage: 85, reloadMs: 1050, range: 440, powerRating: 36, shotColor: 0xe879f9, shotTrail: true, mutatedTrail: true },
  { id: 'leviathan', name: "Leviathan's Wrath", cost: 14_000_000, attackRating: 130, maxDamage: 115, reloadMs: 900, range: 480, powerRating: 55, shotColor: 0xfb7185, shotTrail: true, mutatedTrail: true }
]

export function pirateCannonTier(id: string): PirateCannonTier {
  return PIRATE_CANNON_TIERS.find(t => t.id === id) ?? PIRATE_CANNON_TIERS[0]!
}

// Same steep shape as the stat upgrades — unlocking the 8th port (the last
// of 7 purchases) lands around 15m.
export const PIRATE_SLOT_UNLOCK_BASE_COST = 15_000
export const PIRATE_SLOT_UNLOCK_GROWTH = 3.16

/** Coin cost to unlock the next gun port, given the number currently unlocked. */
export function pirateSlotUnlockCost(currentSlots: number): number | null {
  if (currentSlots >= PIRATE_MAX_CANNON_SLOTS) return null
  return Math.round(PIRATE_SLOT_UNLOCK_BASE_COST * Math.pow(PIRATE_SLOT_UNLOCK_GROWTH, currentSlots - 1))
}

/** Expected damage per second, accuracy-weighted, vs a given defense rating — used for shop comparisons. */
export function pirateCannonDps(tier: PirateCannonTier, defenseRating: number) {
  const hitChance = pirateHitChance(tier.attackRating, defenseRating)
  const avgDamage = (tier.maxDamage + 1) / 2
  return (hitChance * avgDamage) / (tier.reloadMs / 1000)
}

// ─── Ammo ───────────────────────────────────────────────────────────────────
export const PIRATE_AMMO_BASE_PRICE_PER_UNIT = 12.5
export const PIRATE_AMMO_PRICE_PER_POWER = 0.5
export const PIRATE_AMMO_RANGE_MULT = 1.1
export const PIRATE_AMMO_DAMAGE_MULT = 1.2

/** Premium cannonball price. Stronger ships pay more for the same relative combat boost. */
export function pirateAmmoPricePerUnit(power: number) {
  return Math.max(1, Math.round(PIRATE_AMMO_BASE_PRICE_PER_UNIT + Math.max(0, power) * PIRATE_AMMO_PRICE_PER_POWER))
}

export function pirateNormalizeDifficulty(value: number) {
  const finite = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(PIRATE_MAX_DIFFICULTY, Math.round(finite / PIRATE_DIFFICULTY_STEP) * PIRATE_DIFFICULTY_STEP))
}

export function pirateRecommendedDifficulty(highestCompletedDifficulty: number) {
  return pirateNormalizeDifficulty(Math.max(0, highestCompletedDifficulty + PIRATE_DIFFICULTY_STEP))
}

export function pirateDifficultyOptions(maxRelevantDifficulty: number) {
  const ceiling = pirateNormalizeDifficulty(Math.max(200, maxRelevantDifficulty + PIRATE_DIFFICULTY_STEP * 2))
  const options: number[] = []
  for (let difficulty = 0; difficulty <= ceiling; difficulty += PIRATE_DIFFICULTY_STEP) options.push(difficulty)
  return options
}

// ─── Gem ammo ───────────────────────────────────────────────────────────────
// Premium powder bought with gems (much rarer than coins). Each gem buys a
// small bundle of charged shots that hit harder and more accurately — and burn
// blue. Stored in its own separate magazine with a fixed capacity.
export const PIRATE_GEM_AMMO_CAPACITY = 60
export const PIRATE_GEM_AMMO_BUNDLE_SIZE = 2
export const PIRATE_GEM_AMMO_BUNDLE_PRICE_GEMS = 1
export const PIRATE_GEM_AMMO_ATTACK_MULT = 1.5
export const PIRATE_GEM_AMMO_DAMAGE_MULT = 1.75

// ─── Power level ────────────────────────────────────────────────────────────
export interface PirateLoadout {
  levels: Record<PirateShipStatId, number>
  cannonTierIds: string[]
  cannonSlots: number
}

/** Defense rating the power formula measures loadout DPS against. */
export const PIRATE_POWER_REFERENCE_DEFENSE = 20
export const PIRATE_POWER_REFERENCE_ATTACK = 50

/**
 * Power level measures what the loadout actually DOES rather than what it
 * cost: real accuracy-weighted DPS dominates (that's what melts enemies),
 * with smaller terms for effective survivability and utility. This drives
 * recommendations and player-powered abilities, but never changes the enemy
 * curve or payout of a selected difficulty. A ship with eight Mythrils still
 * reads dramatically stronger than one with eight Swivels even though both
 * fill every port.
 */
export function piratePowerLevel(loadout: PirateLoadout) {
  const dps = loadout.cannonTierIds.reduce(
    (sum, id) => sum + pirateCannonDps(pirateCannonTier(id), PIRATE_POWER_REFERENCE_DEFENSE),
    0
  )
  const maxHp = pirateMaxHp(loadout.levels.hull)
  const defense = pirateDefenseRating(loadout.levels.defense)
  const speed = pirateShipSpeed(loadout.levels.speed)
  const ammoCap = pirateAmmoCapacity(loadout.levels.ammoCapacity)
  // Defense has to carry real weight in matchmaking too. Effective hull uses
  // the same accuracy curve as combat against a representative enemy attack,
  // so investing in both hull and armor raises power substantially instead of
  // letting a tank build stay in a rookie bracket. DPS still dominates a true
  // glass cannon, which deliberately gives that build nastier waves without
  // secretly protecting its small hull.
  const incomingHitChance = pirateHitChance(PIRATE_POWER_REFERENCE_ATTACK, defense)
  const effectiveHull = maxHp / Math.max(0.15, incomingHitChance)
  return Math.round(
    dps * 1.65
    + effectiveHull / 4.5
    + speed / 50
    + ammoCap / 40
    + loadout.cannonSlots
  )
}

/** All stats at level 1, one starter cannon, one slot — the baseline every new captain starts at. */
export const PIRATE_BASE_POWER = piratePowerLevel({
  levels: { hull: 1, speed: 1, defense: 1, ammoCapacity: 1, regen: 1 },
  cannonTierIds: [PIRATE_STARTER_CANNON_TIER],
  cannonSlots: 1
})

// ─── Combat rolls (RuneScape-style accuracy) ───────────────────────────────
export function pirateHitChance(attackRating: number, defenseRating: number) {
  const a = Math.max(0, attackRating)
  const d = Math.max(0, defenseRating)
  // Closed-form probability that a Uniform(0,a) roll beats a Uniform(0,d) roll —
  // the same shape as the classic accuracy formula: a huge defense stat can
  // still be cracked sometimes, and a huge attack stat is never a guaranteed hit.
  if (a > d) return 1 - (d + 1) / (2 * (a + 1))
  return a / (2 * (d + 1))
}

export interface PirateAttackRoll {
  hit: boolean
  dmg: number
  crit: boolean
}

/** One shot: accuracy roll first, then (only on a hit) a 1..maxDamage damage roll. */
export function pirateRollAttack(attackRating: number, defenseRating: number, maxDamage: number, rng: () => number = randomFloat): PirateAttackRoll {
  const attackRoll = rng() * (attackRating + 1)
  const defenseRoll = rng() * (defenseRating + 1)
  if (attackRoll < defenseRoll) return { hit: false, dmg: 0, crit: false }

  const dmg = Math.max(1, Math.floor(rng() * maxDamage) + 1)
  const margin = attackRating > 0 ? (attackRoll - defenseRoll) / (attackRating + 1) : 0
  const crit = margin > 0.6 && rng() < 0.35
  return { hit: true, dmg: crit ? Math.min(maxDamage, Math.round(dmg * 1.5)) : dmg, crit }
}

// ─── Enemy tiers ────────────────────────────────────────────────────────────

/**
 * Special attacks, each on its own cooldown alongside the tier's cannons.
 * - skiffs: three small ramming skiffs aimed around the player.
 * - bomb: a lobbed frenzy bomb with a wide telegraphed blast.
 * - mine: a slow drift mine homing on the player's position.
 * - sniper: a telegraphed long-range shot at a fixed, dodgeable point.
 * - ram: the hull itself is the weapon. It lights its fuse near the player,
 *   charges and explodes on contact (or when sunk close by).
 * - harpoon: a telegraphed line; a hit tethers the player, slowing them.
 * - mortar: three shells lobbed at marked spots around the player.
 * - ward: shields every nearby enemy hull for a share of its max hull.
 * - tentacles / ink / whirlpool: the Kraken's slams, blinding ink and drag.
 * - blink / summon / spiral: the Phantom Admiral's teleport, ghost escorts
 *   and a spiralling ring of spectral shot.
 */
export type PirateEnemyAbility =
  | 'skiffs' | 'bomb' | 'mine' | 'sniper'
  | 'ram' | 'harpoon' | 'mortar' | 'ward'
  | 'tentacles' | 'ink' | 'whirlpool'
  | 'blink' | 'summon' | 'spiral'

export type PirateBossKind = 'dreadnought' | 'kraken' | 'phantom'

export interface PirateEnemyTier {
  id: string
  name: string
  /** Elapsed run time (ms) before this tier can spawn. For bosses, the earliest it may surface. */
  unlockAtMs: number
  hp: number
  defense: number
  attackRating: number
  /** Cannon damage ceiling. 0 for hulls without cannons (fire ships). */
  maxDamage: number
  range: number
  speed: number
  reloadMs: number
  color: number
  /** Relative spawn weight once unlocked (elites use a low weight). */
  weight: number
  /** Cannonballs per volley (default 1) — corsairs and bosses fire spreads. */
  volley?: number
  /** Visual scale of the ship art (default 1). */
  sizeScale?: number
  /** Bosses spawn on their own timer, never from the regular weighted pool. */
  boss?: PirateBossKind
  /** Special attacks this tier rolls between (empty for plain gunships). */
  abilities: PirateEnemyAbility[]
  /** One line for the wiki and the boss banner. */
  role: string
}

// No kill pays coins any more (the voyage pays by the second), so tiers only
// describe the fight. Hull damage still gates how often a captain can sail
// again (see the repair system below).
export const PIRATE_ENEMY_TIERS: PirateEnemyTier[] = [
  { id: 'sloop', name: 'Sloop', unlockAtMs: 0, hp: 30, defense: 5, attackRating: 14, maxDamage: 10, range: 160, speed: 90, reloadMs: 2300, color: 0x8b8f96, weight: 10, sizeScale: 0.82, abilities: ['skiffs'], role: 'Light raider that swarms in numbers.' },
  { id: 'razorskiff', name: 'Razor Skiff', unlockAtMs: pirateTimelineMs(25_000), hp: 55, defense: 8, attackRating: 28, maxDamage: 12, range: 145, speed: 390, reloadMs: 1750, color: 0xf97316, weight: 3.5, sizeScale: 0.76, abilities: ['skiffs'], role: 'Blisteringly fast knife-fighter.' },
  { id: 'fireship', name: 'Fire Ship', unlockAtMs: pirateTimelineMs(35_000), hp: 45, defense: 6, attackRating: 30, maxDamage: 0, range: 0, speed: 200, reloadMs: 99_000, color: 0xdc2626, weight: 2.6, sizeScale: 0.84, abilities: ['ram'], role: 'A burning hulk packed with powder. Sink it before it reaches you.' },
  { id: 'corsair', name: 'Crimson Corsair', unlockAtMs: pirateTimelineMs(50_000), hp: 50, defense: 8, attackRating: 24, maxDamage: 11, range: 250, speed: 135, reloadMs: 2700, color: 0xef4444, weight: 5, volley: 3, sizeScale: 0.9, abilities: ['bomb'], role: 'Rattles off three-shot spreads.' },
  { id: 'brigantine', name: 'Brigantine', unlockAtMs: pirateTimelineMs(85_000), hp: 80, defense: 12, attackRating: 24, maxDamage: 18, range: 220, speed: 110, reloadMs: 1900, color: 0x5b7a9e, weight: 8, sizeScale: 0.94, abilities: ['mine'], role: 'The fleet workhorse. Seeds drift mines.' },
  { id: 'sniper', name: 'Longshot Schooner', unlockAtMs: pirateTimelineMs(95_000), hp: 35, defense: 5, attackRating: 62, maxDamage: 55, range: 560, speed: 72, reloadMs: 4800, color: 0xa855f7, weight: 2, sizeScale: 0.8, abilities: ['sniper'], role: 'Fragile, but its marked shots hit like a truck.' },
  { id: 'ironclad', name: 'Cobalt Ironclad', unlockAtMs: pirateTimelineMs(110_000), hp: 300, defense: 32, attackRating: 20, maxDamage: 12, range: 200, speed: 70, reloadMs: 2100, color: 0x3b82f6, weight: 4, sizeScale: 1.14, abilities: ['mine'], role: 'Armoured tank that shrugs off weak guns.' },
  { id: 'harpooner', name: 'Harpooner', unlockAtMs: pirateTimelineMs(125_000), hp: 95, defense: 14, attackRating: 34, maxDamage: 14, range: 260, speed: 115, reloadMs: 2200, color: 0x0d9488, weight: 3, sizeScale: 0.96, abilities: ['harpoon'], role: 'Tethers your ship with a harpoon line, slowing you to a crawl.' },
  { id: 'frigate', name: 'Frigate', unlockAtMs: pirateTimelineMs(130_000), hp: 160, defense: 20, attackRating: 36, maxDamage: 30, range: 300, speed: 125, reloadMs: 1600, color: 0xc06a2c, weight: 6, sizeScale: 1.05, abilities: ['bomb'], role: 'Heavy guns and frenzy bombs.' },
  { id: 'mortar', name: 'Mortar Barge', unlockAtMs: pirateTimelineMs(160_000), hp: 150, defense: 16, attackRating: 40, maxDamage: 22, range: 540, speed: 58, reloadMs: 3900, color: 0x78716c, weight: 2.4, sizeScale: 1.08, abilities: ['mortar'], role: 'Lobs marked mortar shells from far away. Keep moving.' },
  { id: 'tidecaller', name: 'Tidecaller', unlockAtMs: pirateTimelineMs(190_000), hp: 120, defense: 18, attackRating: 26, maxDamage: 12, range: 280, speed: 95, reloadMs: 2400, color: 0x22d3ee, weight: 2, sizeScale: 0.98, abilities: ['ward'], role: 'Shields the ships around it. Sink it first.' },
  { id: 'manowar', name: "Man-o'-War", unlockAtMs: pirateTimelineMs(215_000), hp: 260, defense: 30, attackRating: 50, maxDamage: 42, range: 380, speed: 105, reloadMs: 1400, color: 0x8b2635, weight: 4, sizeScale: 1.2, abilities: ['bomb'], role: 'A floating fortress with a long reach.' },
  { id: 'ghostship', name: 'Ghost Ship', unlockAtMs: pirateTimelineMs(260_000), hp: 200, defense: 26, attackRating: 58, maxDamage: 48, range: 340, speed: 155, reloadMs: 1100, color: 0x2ecc9c, weight: 1.5, sizeScale: 1.02, abilities: ['bomb'], role: 'Fast, spectral and relentless.' },
  { id: 'dreadnought', name: 'The Dreadnought', unlockAtMs: 0, hp: 560, defense: 30, attackRating: 52, maxDamage: 32, range: 310, speed: 78, reloadMs: 2000, color: 0x991b1b, weight: 0, volley: 3, sizeScale: 1.55, boss: 'dreadnought', abilities: ['sniper', 'mine', 'bomb', 'skiffs'], role: 'A massive warship that throws every trick in the fleet at you.' },
  { id: 'kraken', name: 'The Kraken', unlockAtMs: pirateTimelineMs(200_000), hp: 820, defense: 26, attackRating: 48, maxDamage: 30, range: 330, speed: 0, reloadMs: 2600, color: 0x7c3aed, weight: 0, sizeScale: 1.7, boss: 'kraken', abilities: ['tentacles', 'ink', 'whirlpool'], role: 'Surfaces beneath the fleet, slams tentacles down on marked water and dives to strike elsewhere.' },
  { id: 'phantom', name: 'The Phantom Admiral', unlockAtMs: pirateTimelineMs(280_000), hp: 640, defense: 34, attackRating: 58, maxDamage: 26, range: 380, speed: 120, reloadMs: 1800, color: 0x5eead4, weight: 0, volley: 2, sizeScale: 1.5, boss: 'phantom', abilities: ['blink', 'summon', 'spiral'], role: 'A spectral flagship that blinks across the sea, raises ghost escorts and fires spiralling rings of shot.' }
]

export const PIRATE_BOSS_TIERS = PIRATE_ENEMY_TIERS.filter(tier => tier.boss)

/**
 * Which boss surfaces next: any boss unlocked by now, never the same one twice
 * in a row while there is a choice. Difficulty unlocks the later bosses a
 * little sooner, the same head start regular tiers get.
 */
export function pirateRollBoss(elapsedMs: number, difficulty: number, previous: string | null, rng: () => number = randomFloat): PirateEnemyTier {
  const effectiveElapsedMs = elapsedMs + pirateDifficultyT(difficulty) * pirateTimelineMs(40_000)
  const unlocked = PIRATE_BOSS_TIERS.filter(tier => effectiveElapsedMs >= tier.unlockAtMs)
  const fresh = unlocked.filter(tier => tier.id !== previous)
  const pool = fresh.length ? fresh : unlocked.length ? unlocked : [PIRATE_BOSS_TIERS[0]!]
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!
}

// ─── Boss cadence ───────────────────────────────────────────────────────────
// A Dreadnought surfaces on its own clock (independent of the concurrency
// cap). Higher selected difficulties bring it forward slightly.
export const PIRATE_BOSS_FIRST_SPAWN_MS = pirateTimelineMs(150_000)
export const PIRATE_BOSS_RESPAWN_MS = pirateTimelineMs(80_000)
export const PIRATE_BOSS_DAMAGE_MULT = 0.3
export const PIRATE_DOUBLE_BOSS_DIFFICULTY = 600
export const PIRATE_BOSS_ABILITY_INITIAL_MIN_MS = pirateTimelineMs(2200)
export const PIRATE_BOSS_ABILITY_INITIAL_MAX_MS = pirateTimelineMs(3500)
export const PIRATE_BOSS_ABILITY_COOLDOWN_MIN_MS = pirateTimelineMs(3800)
export const PIRATE_BOSS_ABILITY_COOLDOWN_MAX_MS = pirateTimelineMs(5400)

/** First Dreadnought sighting — pulled earlier at higher difficulties. */
export function pirateBossFirstSpawnMs(difficulty: number) {
  return Math.round(PIRATE_BOSS_FIRST_SPAWN_MS - pirateDifficultyT(difficulty) * pirateTimelineMs(20_000))
}

/**
 * Difficulty ramp. An upgraded ship should be able to complete the full voyage
 * when it sits roughly 100–200 power above the selected difficulty, while
 * higher selections keep adding enough pressure to remain aspirational.
 *
 * The per-difficulty coefficients below are intentionally uncapped (unlike the
 * spawn-rate/concurrency curves, which cap out at a sane swarm size), so the
 * top difficulty selections remain dangerous even when map population has
 * reached its useful limit.
 *
 * - Enemy HP tracks the chosen difficulty immediately, with a gentler
 *   super-linear time ramp kicking in past the ~40% mark.
 * - Enemy damage ramps with time and difficulty, but low difficulty no longer
 *   becomes deliberately lethal solely because the timer approaches eight.
 * - Accuracy/defense ratings scale at a damped rate with a hard cap, because
 *   the hit-chance formula degenerates (always-miss / always-hit) when
 *   ratings run away at the upper end of the selector.
 */
export const PIRATE_OPENING_GRACE_MS = 120_000
export const PIRATE_OPENING_GRACE_DMG = 0.6

export function pirateDifficultyMultiplier(elapsedMs: number, difficulty: number) {
  const t = Math.min(1.05, elapsedMs / PIRATE_RUN_DURATION_MS)
  const overBase = Math.max(0, difficulty - PIRATE_BASE_POWER)

  // Preserve the selected difficulty's opening resistance, but soften the
  // elapsed-time multiplier so the final minute is survivable on low tiers.
  const timeHpMult = 1 + t * 0.32 + Math.pow(Math.max(0, t - 0.42), 2) * 0.5
  const difficultyHpMult = 1 + overBase * 0.0105
  const hpMult = timeHpMult * difficultyHpMult

  // Incoming damage still ramps throughout the voyage, without the old
  // deliberately lethal end-of-run spike.
  const timeDmgMult = 1 + t * 0.38 + Math.pow(Math.max(0, t - 0.4), 2) * 0.35
  // Per-hit damage grows sub-linearly with difficulty. High-tier fleets still
  // produce much more incoming DPS through accuracy, population, and faster
  // reloads, but an ordinary cannonball no longer scales into a one-shot.
  const difficultyDmgMult = 1 + Math.sqrt(overBase) * 0.02
  // Opening grace: ships that sail out in the first two minutes hit softer, so
  // a fresh captain gets a moment to learn the helm before the fleet bites.
  // Survival pays by the second, and this is where a new ship earns it.
  const openingGrace = PIRATE_OPENING_GRACE_DMG + (1 - PIRATE_OPENING_GRACE_DMG) * Math.min(1, elapsedMs / PIRATE_OPENING_GRACE_MS)
  const dmgMult = timeDmgMult * difficultyDmgMult * openingGrace

  const statMult = Math.min(2.3, 1 + (hpMult - 1) * 0.1)

  return { hpMult, dmgMult, statMult }
}

/** More frequent, smaller enemy hits as the run and selected difficulty rise. */
export function pirateEnemyReloadMultiplier(elapsedMs: number, difficulty: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  const pT = pirateDifficultyT(difficulty)
  return Math.max(0.66, 0.96 - pT * 0.1 - t * 0.12)
}

// Global multiplier on survival pay. Keeps a Pirate voyage near a comparable
// six-minute Shapezz run.
export const PIRATE_PAYOUT_SCALE = 3.2

/**
 * Normalized 0..1 position across the full difficulty selector. Population
 * and cadence scale throughout the 0–1000 range instead of reaching maximum
 * pressure near the midpoint; enemy stats still rise independently.
 */
export function pirateDifficultyT(difficulty: number) {
  return Math.min(1, Math.max(0, difficulty / PIRATE_MAX_DIFFICULTY))
}

/**
 * Spawn cadence — the opening receives slightly faster reinforcements so it
 * stays lively, while the final quarter keeps a restrained overrun.
 */
export function pirateSpawnIntervalMs(elapsedMs: number, difficulty: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = pirateDifficultyT(difficulty)
  const overrun = Math.min(1, Math.max(0, (elapsedMs - PIRATE_OVERRUN_START_MS) / (PIRATE_RUN_DURATION_MS - PIRATE_OVERRUN_START_MS)))
  const start = 6500 - pT * 2200 // 6.5s at difficulty 0 → 4.3s at difficulty 1000
  const end = 2600 - pT * 1700 // 2.6s → 0.9s by the end of the run
  // The opening boost fades out over three minutes, leaving difficulty-based
  // spawn differences and the normal midgame ramp intact.
  const ramp = Math.pow(t, 1.35)
  const earlySpawnFactor = 0.92 + Math.min(1, elapsedMs / (PIRATE_RUN_DURATION_MS * 0.375)) * 0.08
  return Math.max(600, Math.round((start - ramp * (start - end)) * (1 - overrun * 0.15) * earlySpawnFactor * PIRATE_TIMELINE_SCALE))
}

/**
 * Concurrent enemy cap — a modest difficulty-scaled opening group grows
 * through the run, with a restrained surge in the final quarter.
 */
export function pirateMaxConcurrentEnemies(elapsedMs: number, difficulty: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = pirateDifficultyT(difficulty)
  const overrun = Math.min(1, Math.max(0, (elapsedMs - PIRATE_OVERRUN_START_MS) / (PIRATE_RUN_DURATION_MS - PIRATE_OVERRUN_START_MS)))
  const base = 2 + pT
  const growth = 2.5 + pT * 3
  const timeWeight = 0.08 + Math.pow(t, 1.25) * 0.92
  return Math.round(base + growth * timeWeight + overrun * (1.5 + pT * 2))
}

/** Ships already bearing down on the player when a voyage begins. */
export function pirateInitialEnemyCount(difficulty: number) {
  return 2 + Math.round(pirateDifficultyT(difficulty) * 1.5)
}

/**
 * Reinforcement size. Rookie runs mostly add one hull at a time; higher-tier
 * and later runs frequently add two, with an occasional late third hull.
 */
export function pirateSpawnBatchSize(elapsedMs: number, difficulty: number, rng: () => number = randomFloat) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = pirateDifficultyT(difficulty)
  const overrun = Math.min(1, Math.max(0, (elapsedMs - PIRATE_OVERRUN_START_MS) / (PIRATE_RUN_DURATION_MS - PIRATE_OVERRUN_START_MS)))
  let count = 1
  if (rng() < 0.06 + pT * 0.18 + Math.pow(t, 1.4) * 0.45) count += 1
  if (pT > 0.55 && rng() < (pT - 0.55) * 0.35 + Math.pow(t, 1.5) * 0.15) count += 1
  if (rng() < overrun * (0.4 + pT * 0.3)) count += 1
  return count
}

/** Sea-mine damage rises from 10% to 30% of max hull over the voyage. */
export function pirateSeaMineDamageFraction(elapsedMs: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  return 0.1 + Math.pow(t, 1.35) * 0.2
}

/**
 * Weighted-random pick among non-boss tiers unlocked at `elapsedMs`. Difficulty
 * grants up to a 30-second tier head start, enough to vary early waves without
 * compressing the entire midgame into the first minute.
 */
export function pirateRollEnemyTier(elapsedMs: number, difficulty = 0, rng: () => number = randomFloat): PirateEnemyTier {
  const effectiveElapsedMs = elapsedMs + pirateDifficultyT(difficulty) * pirateTimelineMs(30_000)
  const available = PIRATE_ENEMY_TIERS.filter(t => !t.boss && t.weight > 0 && effectiveElapsedMs >= t.unlockAtMs)
  const pool = available.length ? available : [PIRATE_ENEMY_TIERS[0]!]
  return randomWeighted(pool, t => t.weight, rng)
}

// ─── Survival pay ───────────────────────────────────────────────────────────
// A voyage pays by the second, not by the kill. The rate starts low and climbs
// the longer the ship stays afloat, so the money is heavily back-loaded: a
// captain who sets out on an oversized voyage and sinks early takes home very
// little, while one who survives the whole thing earns the full haul plus the
// completion bonus. Because the payout is a pure function of survival time
// and the difficulty snapshotted at start-run, the server computes it itself;
// the client's own coin counter is only a display.

/** Full-voyage average rate, per second, before the completion bonus. */
function pirateRunPayoutRatePerSecond(difficulty: number) {
  return (80 + pirateNormalizeDifficulty(difficulty) * 2.4) * PIRATE_PAYOUT_SCALE / PIRATE_TIMELINE_SCALE
}

/**
 * Cumulative share of a full voyage's pay banked after `elapsedMs`. Only about
 * 4% arrives in the first minute, 13% after two and 69% after five.
 */
export function pirateRunPayoutProgress(elapsedMs: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  return t * 0.15 + Math.pow(t, 2.2) * 0.85
}

/** Coins banked by surviving `elapsedMs` of a voyage at this difficulty. */
export function pirateSurvivalCoins(elapsedMs: number, difficulty: number) {
  return Math.floor(pirateAverageRunPayoutEstimate(difficulty) * pirateRunPayoutProgress(elapsedMs))
}

/** The current pay rate in coins per second, for the HUD. */
export function pirateSurvivalCoinRate(elapsedMs: number, difficulty: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  const progressPerT = 0.15 + 0.85 * 2.2 * Math.pow(t, 1.2)
  return pirateAverageRunPayoutEstimate(difficulty) * progressPerT / (PIRATE_RUN_DURATION_MS / 1000)
}

/** Expected pay for one full voyage, before its completion bonus. */
export function pirateAverageRunPayoutEstimate(difficulty: number) {
  return Math.round(pirateRunPayoutRatePerSecond(difficulty) * (PIRATE_RUN_DURATION_MS / 1000))
}

// Surviving the whole six-minute voyage pays a lump completion bonus on top of
// the coins collected during it. At 90% of a typical haul it nearly doubles a
// clean clear, making the dangerous final minute worth finishing. Awarded
// server-side, so it is never clipped by the anti-cheat cap.
export const PIRATE_COMPLETION_BONUS_RATE = 0.9

/** Flat coin bonus for completing a full voyage at this difficulty. */
export function pirateCompletionBonus(difficulty: number) {
  return Math.round(pirateAverageRunPayoutEstimate(difficulty) * PIRATE_COMPLETION_BONUS_RATE)
}

// ─── Hull repair ────────────────────────────────────────────────────────────
// Taking damage isn't free anymore: coming back from a voyage puts the ship
// in dry dock for a stretch proportional to how badly it was shot up, up to
// a full 2 hours for a total loss. This is what actually stops a strong ship
// from just re-running the same 6 minutes forever for easy money — the
// bigger per-kill payouts above only make sense because of this cap.
export const PIRATE_REPAIR_MAX_MS = 2 * 60 * 60 * 1000

/** Repair time owed for a given fraction of hull damage taken (0 = pristine, 1 = sunk). */
export function pirateRepairDurationMs(hullDamageFraction: number) {
  const frac = Math.min(1, Math.max(0, hullDamageFraction))
  return Math.round(PIRATE_REPAIR_MAX_MS * frac)
}

export const PIRATE_REPAIR_RUSH_MS_PER_GEM = 10 * 60 * 1000

/** One gem clears each started ten-minute block of remaining dry-dock time. */
export function pirateRepairRushGemCost(remainingMs: number) {
  return Math.max(0, Math.ceil(Math.max(0, remainingMs) / PIRATE_REPAIR_RUSH_MS_PER_GEM))
}

// ─── Letters of Marque ──────────────────────────────────────────────────────
// A permanent investment in the voyage itself: every level raises the pay for
// each second at sea (and the completion bonus) by 20%, up to ×3 at level 10.
// Each level is priced at five times the extra pay it adds to a full clear at
// the difficulty a captain typically sails by then (100 per level), so it pays
// for itself in about five voyages there. Because pay itself grows with
// difficulty, the prices climb steeply, from 233k to 6.5m (33m for the set).
// A maxed charter on a difficulty-1000 clear lands near 22m, inside the
// site-wide ceiling of 20-50m for a single game.
export const PIRATE_MARQUE_MAX_LEVEL = 10
export const PIRATE_MARQUE_STEP = 0.2
export const PIRATE_MARQUE_PAYBACK_VOYAGES = 5
export const PIRATE_MARQUE_DIFFICULTY_PER_LEVEL = 100

/** Pay multiplier at a Letters of Marque level (×1 at 0, ×3 at 10). */
export function pirateMarqueMultiplier(level: number) {
  const clamped = Math.max(0, Math.min(PIRATE_MARQUE_MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 0)))
  return 1 + clamped * PIRATE_MARQUE_STEP
}

/** Coin cost to go from `level` to `level + 1`, rounded to three significant figures. Null at max. */
export function pirateMarqueUpgradeCost(level: number): number | null {
  if (level >= PIRATE_MARQUE_MAX_LEVEL) return null
  const difficulty = Math.max(0, level) * PIRATE_MARQUE_DIFFICULTY_PER_LEVEL
  const fullClear = pirateAverageRunPayoutEstimate(difficulty) + pirateCompletionBonus(difficulty)
  const raw = fullClear * PIRATE_MARQUE_STEP * PIRATE_MARQUE_PAYBACK_VOYAGES
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 2)
  return Math.round(raw / magnitude) * magnitude
}
