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

function pirateTimelineMs(ms: number) {
  return Math.round(ms * PIRATE_TIMELINE_SCALE)
}

export const PIRATE_SHIP_SKINS = [
  { id: 'starter', name: 'Golden Brigantine', cost: 0, sprite: '/pirates/sprites/player-ship.png', description: 'The dependable brig every captain starts with.' },
  { id: 'crimson-privateer', name: 'Crimson Privateer', cost: 50, sprite: '/pirates/sprites/skin-crimson-privateer.png', description: 'Polished mahogany, silver trim, and privateer-red sails.' },
  { id: 'emerald-serpent', name: 'Emerald Serpent', cost: 250, sprite: '/pirates/sprites/skin-emerald-serpent.png', description: 'Jade lacquer, silver scales, and an ornate serpent prow.' },
  { id: 'royal-aether', name: 'Royal Aether', cost: 1000, sprite: '/pirates/sprites/skin-royal-aether.png', description: 'A regal warship lined with luminous violet crystals.' },
  { id: 'crown-of-tides', name: 'Crown of Tides', cost: 10_000, sprite: '/pirates/sprites/skin-crown-of-tides.png', description: 'Pure gold and sapphire excess. The ultimate captain flex.' }
] as const

export type PirateShipSkinId = typeof PIRATE_SHIP_SKINS[number]['id']

export function pirateShipSkin(id: string) {
  return PIRATE_SHIP_SKINS.find(skin => skin.id === id) ?? PIRATE_SHIP_SKINS[0]
}

// One right-click ability may be equipped at a time. The powder keg remains
// the free starter option; the other techniques are permanent coin unlocks.
export const PIRATE_ABILITIES = [
  { id: 'bomb', name: 'Powder Keg', cost: 0, cooldownMs: pirateTimelineMs(15_000), icon: 'i-lucide-bomb', accent: 'warning', description: 'Lob a heavy keg that explodes in a wide area.' },
  { id: 'seekers', name: "Hunter's Salvo", cost: 250_000, cooldownMs: pirateTimelineMs(18_000), icon: 'i-lucide-rocket', accent: 'error', description: 'Launch three spectral missiles that hunt down separate enemy ships.' },
  { id: 'stormchain', name: 'Stormchain', cost: 250_000, cooldownMs: pirateTimelineMs(20_000), icon: 'i-lucide-zap', accent: 'info', description: 'Call lightning onto the nearest target, then chain it through the fleet.' },
  { id: 'maelstrom', name: "Kraken's Maw", cost: 250_000, cooldownMs: pirateTimelineMs(24_000), icon: 'i-lucide-tornado', accent: 'primary', description: 'Open a damaging whirlpool that drags nearby ships toward its center.' },
  { id: 'firestorm', name: 'Hellfire Barrage', cost: 250_000, cooldownMs: pirateTimelineMs(22_000), icon: 'i-lucide-flame', accent: 'warning', description: 'Rain seven explosive cannon shells across the targeted area.' }
] as const

export type PirateAbilityId = typeof PIRATE_ABILITIES[number]['id']
export const PIRATE_STARTER_ABILITY_ID: PirateAbilityId = 'bomb'

export function pirateAbility(id: string) {
  return PIRATE_ABILITIES.find(ability => ability.id === id) ?? PIRATE_ABILITIES[0]
}

export type PiratePowerUpId =
  | 'broadside-fury'
  | 'quick-fuse'
  | 'eagle-eye'
  | 'iron-plating'
  | 'tide-shield'
  | 'titan-shot'
  | 'blast-powder'
  | 'deadeye'
  | 'rapid-loader'
  | 'keen-sights'
  | 'reinforced-keel'
  | 'lucky-shot'
  | 'razor-orbit'
  | 'starburst-battery'
  | 'chain-tempest'
  | 'ghost-armada'
  | 'blood-tide'

export interface PiratePowerUpDefinition {
  id: PiratePowerUpId
  name: string
  description: string
  icon: string
  color: number
  durationMs: number | null
  maxStacks: number
}

export const PIRATE_POWER_UPS: PiratePowerUpDefinition[] = [
  { id: 'broadside-fury', name: 'Broadside Fury', description: '+20% cannon damage per stack', icon: '🔥', color: 0xf97316, durationMs: pirateTimelineMs(45_000), maxStacks: 4 },
  { id: 'quick-fuse', name: 'Quick Fuse', description: 'Cannons reload 20% faster per stack', icon: '⚡', color: 0xfacc15, durationMs: pirateTimelineMs(40_000), maxStacks: 3 },
  { id: 'eagle-eye', name: "Eagle's Eye", description: '+25% cannon range per stack', icon: '🔭', color: 0x60a5fa, durationMs: pirateTimelineMs(60_000), maxStacks: 3 },
  { id: 'iron-plating', name: 'Iron Plating', description: '+30% defense per stack', icon: '⚓', color: 0x94a3b8, durationMs: pirateTimelineMs(60_000), maxStacks: 3 },
  { id: 'tide-shield', name: 'Tide Shield', description: '+20 rechargeable shield per stack', icon: '🛡️', color: 0x22d3ee, durationMs: null, maxStacks: 5 },
  { id: 'titan-shot', name: 'Titan Shot', description: 'Stacks make massive shots more frequent', icon: '💥', color: 0xa78bfa, durationMs: pirateTimelineMs(90_000), maxStacks: 4 },
  { id: 'blast-powder', name: 'Blast Powder', description: 'Stacks make explosive shots more frequent', icon: '🧨', color: 0xef4444, durationMs: pirateTimelineMs(72_000), maxStacks: 3 },
  { id: 'deadeye', name: 'Deadeye', description: '+22% cannon accuracy per stack', icon: '🎯', color: 0x4ade80, durationMs: pirateTimelineMs(60_000), maxStacks: 3 },
  { id: 'rapid-loader', name: 'Rapid Loader', description: '+10% reload speed per stack', icon: '⏱️', color: 0xfde047, durationMs: pirateTimelineMs(120_000), maxStacks: 5 },
  { id: 'keen-sights', name: 'Keen Sights', description: '+10% range per stack', icon: '👁️', color: 0x7dd3fc, durationMs: pirateTimelineMs(155_000), maxStacks: 5 },
  { id: 'reinforced-keel', name: 'Reinforced Keel', description: '+10% sailing speed per stack', icon: '⛵', color: 0x34d399, durationMs: pirateTimelineMs(155_000), maxStacks: 5 },
  { id: 'lucky-shot', name: 'Lucky Shot', description: '+8% cannon damage per stack', icon: '🍀', color: 0x86efac, durationMs: pirateTimelineMs(130_000), maxStacks: 5 },
  { id: 'razor-orbit', name: 'Razor Orbit', description: 'Spinning blades shred nearby ships', icon: '🪚', color: 0xf87171, durationMs: pirateTimelineMs(65_000), maxStacks: 4 },
  { id: 'starburst-battery', name: 'Starburst Battery', description: 'Fires ten cannonballs in every direction', icon: '☀️', color: 0xfbbf24, durationMs: pirateTimelineMs(42_000), maxStacks: 4 },
  { id: 'chain-tempest', name: 'Chain Tempest', description: 'Automatic lightning tears through fleets', icon: '🌩️', color: 0x38bdf8, durationMs: pirateTimelineMs(55_000), maxStacks: 4 },
  { id: 'ghost-armada', name: 'Ghost Armada', description: 'Spectral escorts orbit and fire for you', icon: '👻', color: 0xc4b5fd, durationMs: pirateTimelineMs(105_000), maxStacks: 4 },
  { id: 'blood-tide', name: 'Blood Tide', description: 'Every enemy hit restores 1 hull', icon: '🩸', color: 0xfb7185, durationMs: pirateTimelineMs(32_000), maxStacks: 1 }
]
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
// Life regen is a shorter track than the other stats: it starts at +1 hull/sec
// (every captain owns level 1 for free) and tops out at +5 hull/sec.
export const PIRATE_REGEN_MAX_LEVEL = 5
// Regen only kicks in once the ship has been out of combat this long — no hits
// taken and no cannon shots fired.
export const PIRATE_REGEN_DELAY_MS = 6000

/** Max upgrade level for a given ship stat — regen caps early, everything else at 10. */
export function pirateStatMaxLevel(statId: PirateShipStatId) {
  return statId === 'regen' ? PIRATE_REGEN_MAX_LEVEL : PIRATE_MAX_STAT_LEVEL
}
export const PIRATE_DIFFICULTY_STEP = 50
export const PIRATE_MAX_DIFFICULTY = 1000
export const PIRATE_POWER_UP_INTERVAL_MS = pirateTimelineMs(25_000)
export const PIRATE_POWER_UP_LIFESPAN_MS = pirateTimelineMs(22_000)
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

/** Passive hull regeneration in HP/sec at a given regen level (level 1 = +1, max = +5). */
export function pirateRegenRate(level: number) {
  return Math.max(1, Math.min(level, PIRATE_REGEN_MAX_LEVEL))
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
  { id: 'mythril', name: 'Mythril Broadside', cost: 2_020_000, attackRating: 80, maxDamage: 65, reloadMs: 1200, range: 400, powerRating: 24, shotColor: 0x34d399 },
  { id: 'adamantite', name: 'Adamantite Bombard', cost: 5_320_000, attackRating: 100, maxDamage: 85, reloadMs: 1050, range: 440, powerRating: 36, shotColor: 0xe879f9, shotTrail: true },
  { id: 'leviathan', name: "Leviathan's Wrath", cost: 14_000_000, attackRating: 130, maxDamage: 115, reloadMs: 900, range: 480, powerRating: 55, shotColor: 0xfb7185, shotTrail: true }
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
export interface PirateEnemyTier {
  id: string
  name: string
  /** Elapsed run time (ms) before this tier can spawn. */
  unlockAtMs: number
  hp: number
  defense: number
  attackRating: number
  maxDamage: number
  range: number
  speed: number
  reloadMs: number
  coinMin: number
  coinMax: number
  color: number
  /** Relative spawn weight once unlocked (elites use a low weight). */
  weight: number
  /** Cannonballs per volley (default 1) — corsairs and bosses fire spreads. */
  volley?: number
  /** Visual scale of the ship art (default 1). */
  sizeScale?: number
  /** Bosses spawn on their own timer, never from the regular weighted pool. */
  boss?: boolean
  /** Snipers telegraph a high-damage shot at a fixed, dodgeable impact point. */
  sniper?: boolean
}

// Kill payouts got bumped again (roughly another 2x on top of the earlier
// order-of-magnitude increase) now that hull damage gates how often you can
// go back out (see the repair system below) — a run can no longer be
// repeated back-to-back indefinitely, so it's fine for each one to pay out
// more without turning into an infinite money farm.
export const PIRATE_ENEMY_TIERS: PirateEnemyTier[] = [
  { id: 'sloop', name: 'Sloop', unlockAtMs: 0, hp: 30, defense: 5, attackRating: 14, maxDamage: 10, range: 160, speed: 90, reloadMs: 2300, coinMin: 300, coinMax: 500, color: 0x8b8f96, weight: 10, sizeScale: 0.82 },
  { id: 'razorskiff', name: 'Razor Skiff', unlockAtMs: pirateTimelineMs(25_000), hp: 55, defense: 8, attackRating: 28, maxDamage: 12, range: 145, speed: 390, reloadMs: 1750, coinMin: 650, coinMax: 950, color: 0xf97316, weight: 3.5, sizeScale: 0.76 },
  { id: 'corsair', name: 'Crimson Corsair', unlockAtMs: pirateTimelineMs(40_000), hp: 50, defense: 8, attackRating: 24, maxDamage: 11, range: 250, speed: 135, reloadMs: 2700, coinMin: 800, coinMax: 1200, color: 0xef4444, weight: 5, volley: 3, sizeScale: 0.9 },
  { id: 'brigantine', name: 'Brigantine', unlockAtMs: pirateTimelineMs(55_000), hp: 80, defense: 12, attackRating: 24, maxDamage: 18, range: 220, speed: 110, reloadMs: 1900, coinMin: 600, coinMax: 900, color: 0x5b7a9e, weight: 8, sizeScale: 0.94 },
  { id: 'sniper', name: 'Longshot Schooner', unlockAtMs: pirateTimelineMs(70_000), hp: 35, defense: 5, attackRating: 62, maxDamage: 55, range: 560, speed: 72, reloadMs: 4800, coinMin: 1500, coinMax: 2200, color: 0xa855f7, weight: 2, sizeScale: 0.8, sniper: true },
  { id: 'ironclad', name: 'Cobalt Ironclad', unlockAtMs: pirateTimelineMs(90_000), hp: 300, defense: 32, attackRating: 20, maxDamage: 12, range: 200, speed: 70, reloadMs: 2100, coinMin: 1400, coinMax: 2000, color: 0x3b82f6, weight: 4, sizeScale: 1.14 },
  { id: 'frigate', name: 'Frigate', unlockAtMs: pirateTimelineMs(130_000), hp: 160, defense: 20, attackRating: 36, maxDamage: 30, range: 300, speed: 125, reloadMs: 1600, coinMin: 1100, coinMax: 1600, color: 0xc06a2c, weight: 6, sizeScale: 1.05 },
  { id: 'manowar', name: "Man-o'-War", unlockAtMs: pirateTimelineMs(215_000), hp: 260, defense: 30, attackRating: 50, maxDamage: 42, range: 380, speed: 105, reloadMs: 1400, coinMin: 1800, coinMax: 2600, color: 0x8b2635, weight: 4, sizeScale: 1.2 },
  { id: 'ghostship', name: 'Ghost Ship', unlockAtMs: pirateTimelineMs(260_000), hp: 200, defense: 26, attackRating: 58, maxDamage: 48, range: 340, speed: 155, reloadMs: 1100, coinMin: 3000, coinMax: 4400, color: 0x2ecc9c, weight: 1.5, sizeScale: 1.02 },
  { id: 'dreadnought', name: 'The Dreadnought', unlockAtMs: 0, hp: 560, defense: 30, attackRating: 52, maxDamage: 32, range: 310, speed: 78, reloadMs: 2000, coinMin: 7600, coinMax: 11000, color: 0x991b1b, weight: 0, volley: 3, sizeScale: 1.55, boss: true }
]

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
  const dmgMult = timeDmgMult * difficultyDmgMult

  const statMult = Math.min(2.3, 1 + (hpMult - 1) * 0.1)

  return { hpMult, dmgMult, statMult }
}

/** More frequent, smaller enemy hits as the run and selected difficulty rise. */
export function pirateEnemyReloadMultiplier(elapsedMs: number, difficulty: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  const pT = pirateDifficultyT(difficulty)
  return Math.max(0.66, 0.96 - pT * 0.1 - t * 0.12)
}

// Global multiplier on the coins earned *during* a run (kill rewards, treasure
// and the anti-cheat payout cap all key off it). Set to 3.75x; surviving the
// full voyage adds a separate completion bonus on top (see pirateCompletionBonus)
// that lifts a finished run to roughly 5.25x of the original baseline.
export const PIRATE_PAYOUT_SCALE = 3.75

/**
 * Loot inflation — kill rewards (and treasure) climb with run time and selected
 * difficulty so the risk of harder voyages keeps paying.
 */
export function pirateRewardMultiplier(elapsedMs: number, difficulty: number) {
  const t = Math.min(1.05, elapsedMs / PIRATE_RUN_DURATION_MS)
  const overBase = Math.max(0, difficulty - PIRATE_BASE_POWER)
  return (1 + t * 1.6 + overBase * 0.01) * PIRATE_PAYOUT_SCALE
}

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

// ─── Kill combos ────────────────────────────────────────────────────────────
// Sinking ships back-to-back chains a combo: each link adds a coin bonus on
// top of the kill reward, capped so it stays a nice ramp rather than the
// dominant income source.
export const PIRATE_COMBO_WINDOW_MS = pirateTimelineMs(6000)
export const PIRATE_COMBO_BONUS_PER_STACK = 0.1
export const PIRATE_COMBO_MAX_STACKS = 5

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

// ─── Treasure ───────────────────────────────────────────────────────────────
export const PIRATE_TREASURE_MIN_INTERVAL_MS = pirateTimelineMs(25_000)
export const PIRATE_TREASURE_MAX_INTERVAL_MS = pirateTimelineMs(40_000)
export const PIRATE_TREASURE_LIFESPAN_MS = pirateTimelineMs(20_000)

export function pirateTreasureReward(elapsedMs: number, difficulty = 0, rng: () => number = randomFloat) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const base = (1600 + t * 1400) * (1 + Math.max(0, difficulty - PIRATE_BASE_POWER) * 0.005)
  const variance = 0.8 + rng() * 0.4
  return Math.round(base * variance * PIRATE_PAYOUT_SCALE)
}

// ─── Server-side anti-cheat clamp ──────────────────────────────────────────
// The combat itself is simulated client-side (it's a real-time skill game), so
// finish-run can't be fully re-verified server-side. Instead we bound the
// payout to what's plausible for the elapsed wall-clock time and the power
// level snapshotted at run start, with generous slack over the expected
// average haul so skilled/lucky runs are never clipped in practice.

/** Plausible average coins-per-second at this selected difficulty. */
function pirateRunPayoutRatePerSecond(difficulty: number) {
  return (80 + pirateNormalizeDifficulty(difficulty) * 6.8) * PIRATE_PAYOUT_SCALE / PIRATE_TIMELINE_SCALE
}

export function pirateMaxPayoutForRun(elapsedMs: number, difficulty: number, gemAmmoUsed = 0) {
  const seconds = Math.max(0, elapsedMs / 1000)
  // Gem shots noticeably accelerate the kill rate, so each one spent raises
  // the plausible-haul ceiling a little (combo bonuses and the late-run
  // reward multiplier live inside the 1.8 slack factor).
  return Math.round(pirateRunPayoutRatePerSecond(difficulty) * seconds * 1.8 + gemAmmoUsed * 100)
}

/** Rough expected average haul for one full voyage — the payout cap above is this same rate with generous slack layered on top, so dividing that slack back out gives a reasonable "typical run" estimate. */
export function pirateAverageRunPayoutEstimate(difficulty: number) {
  return Math.round(pirateRunPayoutRatePerSecond(difficulty) * (PIRATE_RUN_DURATION_MS / 1000))
}

// Surviving the whole six-minute voyage pays a lump completion bonus on top of
// the coins collected during it. It's sized as a fraction of a typical haul so
// that a finished run earns roughly 3.5x the original baseline (2.5x in-run take
// + ~1x bonus), turning "just survive to the end" into a real payoff rather than
// bailing early with a partial bag. Awarded server-side, so it's never clipped
// by the anti-cheat cap.
export const PIRATE_COMPLETION_BONUS_RATE = 0.4

/** Flat coin bonus for completing a full voyage at this difficulty. */
export function pirateCompletionBonus(difficulty: number) {
  return Math.round(pirateAverageRunPayoutEstimate(difficulty) * PIRATE_COMPLETION_BONUS_RATE)
}

export const PIRATE_MIN_RUN_MS_FOR_PAYOUT = 3000

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
