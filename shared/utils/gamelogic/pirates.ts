// ─── Pirate Raid ────────────────────────────────────────────────────────────
// A 5-minute real-time roguelike skirmish. Five permanent ship upgrades (hull,
// speed, damage, range, reload) are bought with coins between voyages. Enemy
// ships scale with both elapsed run time AND the player's power level, so the
// run stays roughly 5 minutes long no matter how upgraded the player is.

export const PIRATE_STAT_IDS = ['hull', 'speed', 'damage', 'range', 'reload'] as const
export type PirateStatId = typeof PIRATE_STAT_IDS[number]

export const PIRATE_MAX_STAT_LEVEL = 10
export const PIRATE_BASE_POWER = PIRATE_STAT_IDS.length * 1 // all stats at level 1
export const PIRATE_MAX_POWER = PIRATE_STAT_IDS.length * PIRATE_MAX_STAT_LEVEL

export const PIRATE_RUN_DURATION_MS = 5 * 60 * 1000

// ─── Upgrade cost curve — identical shape for every stat ──────────────────
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

// ─── Per-stat effective values ─────────────────────────────────────────────
export function pirateMaxHp(level: number) {
  return 100 + (clampLevel(level) - 1) * 30
}

export function pirateShipSpeed(level: number) {
  return 220 + (clampLevel(level) - 1) * 18
}

export interface PirateCannonStats { min: number, max: number, balls: number }

export function pirateCannonStats(level: number): PirateCannonStats {
  const l = clampLevel(level)
  return {
    min: Math.round(18 + (l - 1) * 3.5),
    max: Math.round(28 + (l - 1) * 5),
    balls: 3 + Math.floor((l - 1) / 3)
  }
}

export function pirateCannonRange(level: number) {
  return 260 + (clampLevel(level) - 1) * 22
}

export function pirateReloadMs(level: number) {
  return 1800 - (clampLevel(level) - 1) * 120
}

/** Sum of all five stat levels — displayed as the ship's "Power Level". */
export function piratePowerLevel(levels: Record<PirateStatId, number>) {
  return PIRATE_STAT_IDS.reduce((sum, id) => sum + clampLevel(levels[id]), 0)
}

// ─── Enemy tiers ────────────────────────────────────────────────────────────
export interface PirateEnemyTier {
  id: string
  name: string
  /** Elapsed run time (ms) before this tier can spawn. */
  unlockAtMs: number
  hp: number
  dmgMin: number
  dmgMax: number
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
  { id: 'sloop', name: 'Sloop', unlockAtMs: 0, hp: 40, dmgMin: 5, dmgMax: 10, range: 160, speed: 90, reloadMs: 2200, coinMin: 15, coinMax: 25, color: 0x8b8f96, weight: 10 },
  { id: 'brigantine', name: 'Brigantine', unlockAtMs: 55_000, hp: 90, dmgMin: 8, dmgMax: 16, range: 220, speed: 110, reloadMs: 1900, coinMin: 30, coinMax: 45, color: 0x5b7a9e, weight: 8 },
  { id: 'frigate', name: 'Frigate', unlockAtMs: 130_000, hp: 160, dmgMin: 12, dmgMax: 24, range: 300, speed: 125, reloadMs: 1600, coinMin: 55, coinMax: 80, color: 0xc06a2c, weight: 6 },
  { id: 'manowar', name: "Man-o'-War", unlockAtMs: 215_000, hp: 260, dmgMin: 18, dmgMax: 34, range: 380, speed: 105, reloadMs: 1400, coinMin: 90, coinMax: 130, color: 0x8b2635, weight: 4 },
  { id: 'ghostship', name: 'Ghost Ship', unlockAtMs: 260_000, hp: 200, dmgMin: 22, dmgMax: 40, range: 340, speed: 155, reloadMs: 1100, coinMin: 150, coinMax: 220, color: 0x2ecc9c, weight: 1.5 }
]

/**
 * Enemies get tougher over the run (hp/dmg only — range and speed stay tier-fixed
 * so "outranging" reads as a distinct enemy type rather than a smooth curve) AND
 * scale up with the player's power level, so a fully-upgraded ship still faces a
 * ~5-minute fight instead of trivializing early game content.
 */
export function pirateDifficultyMultiplier(elapsedMs: number, power: number) {
  const timeT = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const timeMult = 1 + timeT * 0.9
  const powerMult = 1 + Math.max(0, power - PIRATE_BASE_POWER) * 0.018
  return { hpMult: timeMult * powerMult, dmgMult: timeMult * powerMult }
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
  const ratePerSecond = 8 + Math.max(0, power - PIRATE_BASE_POWER) * 1.2
  return Math.round(ratePerSecond * seconds * 1.4)
}

export const PIRATE_MIN_RUN_MS_FOR_PAYOUT = 3000
