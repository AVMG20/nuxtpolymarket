// ─── Pirate Raid ────────────────────────────────────────────────────────────
// A 5-minute real-time roguelike skirmish. Ship-level upgrades (hull, speed,
// defense, ammo capacity) are bought directly; attack power instead comes from
// equipping cannons (up to 8 gun ports) bought from the armory, each with its
// own accuracy, damage, reload speed and range — and each fires on its own
// independent timer rather than the whole ship volleying together. Combat
// accuracy is RuneScape-style: an attack roll vs a defense roll decides hit or
// miss (a heavily-armored target can shrug off a hit entirely), and only a
// successful hit rolls 1..maxDamage. Ammo is a consumable stock (capacity is
// upgradeable) — running dry mid-voyage ends the run.

export const PIRATE_SHIP_STAT_IDS = ['hull', 'speed', 'defense', 'ammoCapacity'] as const
export type PirateShipStatId = typeof PIRATE_SHIP_STAT_IDS[number]

export const PIRATE_MAX_STAT_LEVEL = 10
export const PIRATE_RUN_DURATION_MS = 5 * 60 * 1000

// ─── Upgrade cost curve — identical shape for every ship stat ─────────────
export const PIRATE_UPGRADE_BASE_COST = 40
export const PIRATE_UPGRADE_GROWTH = 1.55

/** Coin cost to go from `level` to `level + 1`. Null once at max level. */
export function pirateUpgradeCost(level: number): number | null {
  if (level >= PIRATE_MAX_STAT_LEVEL) return null
  return Math.round(PIRATE_UPGRADE_BASE_COST * Math.pow(PIRATE_UPGRADE_GROWTH, level - 1))
}

function clampLevel(level: number) {
  return Math.max(1, Math.min(level, PIRATE_MAX_STAT_LEVEL))
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
  return 40 + (clampLevel(level) - 1) * 15
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
  /** Contribution to the ship's power level used for difficulty scaling. */
  powerRating: number
}

export const PIRATE_CANNON_TIERS: PirateCannonTier[] = [
  { id: 'swivel', name: 'Swivel Gun', cost: 0, attackRating: 15, maxDamage: 12, reloadMs: 2200, range: 220, powerRating: 2 },
  { id: 'carronade', name: 'Bronze Carronade', cost: 150, attackRating: 22, maxDamage: 18, reloadMs: 2000, range: 250, powerRating: 4 },
  { id: 'culverin', name: 'Iron Culverin', cost: 400, attackRating: 32, maxDamage: 26, reloadMs: 1800, range: 280, powerRating: 7 },
  { id: 'longgun', name: 'Steel Long Gun', cost: 900, attackRating: 45, maxDamage: 36, reloadMs: 1600, range: 320, powerRating: 11 },
  { id: 'basilisk', name: 'Reinforced Basilisk', cost: 1800, attackRating: 60, maxDamage: 48, reloadMs: 1400, range: 360, powerRating: 16 },
  { id: 'mythril', name: 'Mythril Broadside', cost: 3500, attackRating: 80, maxDamage: 65, reloadMs: 1200, range: 400, powerRating: 24 }
]

export function pirateCannonTier(id: string): PirateCannonTier {
  return PIRATE_CANNON_TIERS.find(t => t.id === id) ?? PIRATE_CANNON_TIERS[0]!
}

/** Coin cost to unlock the next gun port, given the number currently unlocked. */
export function pirateSlotUnlockCost(currentSlots: number): number | null {
  if (currentSlots >= PIRATE_MAX_CANNON_SLOTS) return null
  return Math.round(300 * Math.pow(1.7, currentSlots - 1))
}

/** Expected damage per second, accuracy-weighted, vs a given defense rating — used for shop comparisons. */
export function pirateCannonDps(tier: PirateCannonTier, defenseRating: number) {
  const hitChance = pirateHitChance(tier.attackRating, defenseRating)
  const avgDamage = (tier.maxDamage + 1) / 2
  return (hitChance * avgDamage) / (tier.reloadMs / 1000)
}

// ─── Ammo ───────────────────────────────────────────────────────────────────
export const PIRATE_AMMO_PRICE_PER_UNIT = 2

// ─── Power level ────────────────────────────────────────────────────────────
export interface PirateLoadout {
  levels: Record<PirateShipStatId, number>
  cannonTierIds: string[]
  cannonSlots: number
}

/** All stats at level 1, one starter cannon, one slot — the baseline every new captain starts at. */
export const PIRATE_BASE_POWER = PIRATE_SHIP_STAT_IDS.length + pirateCannonTier(PIRATE_STARTER_CANNON_TIER).powerRating + 1

export function piratePowerLevel(loadout: PirateLoadout) {
  const statSum = PIRATE_SHIP_STAT_IDS.reduce((sum, id) => sum + clampLevel(loadout.levels[id]), 0)
  const cannonSum = loadout.cannonTierIds.reduce((sum, id) => sum + pirateCannonTier(id).powerRating, 0)
  return statSum + cannonSum + loadout.cannonSlots
}

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
export function pirateRollAttack(attackRating: number, defenseRating: number, maxDamage: number, rng: () => number = Math.random): PirateAttackRoll {
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
}

export const PIRATE_ENEMY_TIERS: PirateEnemyTier[] = [
  { id: 'sloop', name: 'Sloop', unlockAtMs: 0, hp: 40, defense: 8, attackRating: 18, maxDamage: 14, range: 160, speed: 90, reloadMs: 2200, coinMin: 15, coinMax: 25, color: 0x8b8f96, weight: 10 },
  { id: 'brigantine', name: 'Brigantine', unlockAtMs: 55_000, hp: 90, defense: 14, attackRating: 26, maxDamage: 20, range: 220, speed: 110, reloadMs: 1900, coinMin: 30, coinMax: 45, color: 0x5b7a9e, weight: 8 },
  { id: 'frigate', name: 'Frigate', unlockAtMs: 130_000, hp: 160, defense: 20, attackRating: 36, maxDamage: 30, range: 300, speed: 125, reloadMs: 1600, coinMin: 55, coinMax: 80, color: 0xc06a2c, weight: 6 },
  { id: 'manowar', name: "Man-o'-War", unlockAtMs: 215_000, hp: 260, defense: 30, attackRating: 50, maxDamage: 42, range: 380, speed: 105, reloadMs: 1400, coinMin: 90, coinMax: 130, color: 0x8b2635, weight: 4 },
  { id: 'ghostship', name: 'Ghost Ship', unlockAtMs: 260_000, hp: 200, defense: 26, attackRating: 58, maxDamage: 48, range: 340, speed: 155, reloadMs: 1100, coinMin: 150, coinMax: 220, color: 0x2ecc9c, weight: 1.5 }
]

/**
 * Enemies get tougher over the run (hp/damage scale fully; accuracy/defense
 * scale at half rate so the hit-chance formula never degenerates toward
 * always-hit or always-miss) AND scale up with the player's power level, so a
 * fully-upgraded ship still faces a ~5-minute fight instead of trivializing
 * early game content.
 */
export function pirateDifficultyMultiplier(elapsedMs: number, power: number) {
  const timeT = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const timeMult = 1 + timeT * 0.9
  const powerMult = 1 + Math.max(0, power - PIRATE_BASE_POWER) * 0.006
  const fullMult = timeMult * powerMult
  return { hpMult: fullMult, dmgMult: fullMult, statMult: 1 + (fullMult - 1) * 0.5 }
}

export function pirateSpawnIntervalMs(elapsedMs: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  return Math.round(7000 - t * (7000 - 3200))
}

export function pirateMaxConcurrentEnemies(elapsedMs: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  return Math.round(3 + t * 4)
}

/** Weighted-random pick among tiers unlocked at `elapsedMs`. */
export function pirateRollEnemyTier(elapsedMs: number, rng: () => number = Math.random): PirateEnemyTier {
  const available = PIRATE_ENEMY_TIERS.filter(t => elapsedMs >= t.unlockAtMs)
  const pool = available.length ? available : [PIRATE_ENEMY_TIERS[0]!]
  const totalWeight = pool.reduce((sum, t) => sum + t.weight, 0)
  let roll = rng() * totalWeight
  for (const t of pool) {
    roll -= t.weight
    if (roll <= 0) return t
  }
  return pool[pool.length - 1]!
}

// ─── Treasure ───────────────────────────────────────────────────────────────
export const PIRATE_TREASURE_MIN_INTERVAL_MS = 25_000
export const PIRATE_TREASURE_MAX_INTERVAL_MS = 40_000
export const PIRATE_TREASURE_LIFESPAN_MS = 20_000

export function pirateTreasureReward(elapsedMs: number, rng: () => number = Math.random) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const base = 80 + t * 70
  const variance = 0.8 + rng() * 0.4
  return Math.round(base * variance)
}

// ─── Server-side anti-cheat clamp ──────────────────────────────────────────
// The combat itself is simulated client-side (it's a real-time skill game), so
// finish-run can't be fully re-verified server-side. Instead we bound the
// payout to what's plausible for the elapsed wall-clock time and the power
// level snapshotted at run start, with generous slack over the expected
// average haul so skilled/lucky runs are never clipped in practice.
export function pirateMaxPayoutForRun(elapsedMs: number, power: number) {
  const seconds = Math.max(0, elapsedMs / 1000)
  const ratePerSecond = 8 + Math.max(0, power - PIRATE_BASE_POWER) * 0.35
  return Math.round(ratePerSecond * seconds * 1.4)
}

export const PIRATE_MIN_RUN_MS_FOR_PAYOUT = 3000
