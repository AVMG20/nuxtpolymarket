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
export const PIRATE_POWER_UP_INTERVAL_MS = 30_000
export const PIRATE_POWER_UP_LIFESPAN_MS = 22_000
export const PIRATE_HEALTH_PACK_INTERVAL_MS = 45_000
export const PIRATE_HEALTH_PACK_LIFESPAN_MS = 22_000
export const PIRATE_SEA_MINE_INTERVAL_MS = 10_000
export const PIRATE_SEA_MINE_LIFESPAN_MS = 30_000

// ─── Upgrade cost curve — identical shape for every ship stat ─────────────
// Steep exponential sink: the first upgrade sits in the "extra spending
// money" range, the last (level 9 → 10) lands around 20-22m — a proper
// end-game money sink relative to the other ways to earn on the site.
export const PIRATE_UPGRADE_BASE_COST = 20_000
export const PIRATE_UPGRADE_GROWTH = 2.4

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
  /** In-game muzzle, impact, and projectile accent. */
  shotColor: number
  /** Top-tier cannonballs leave a subtle colored trail. */
  shotTrail?: boolean
}

// Costs step up ~2.6x per tier, topping out at 10m for the Leviathan's Wrath
// — the armory's own equivalent of the ship-stat/slot money sinks.
export const PIRATE_CANNON_TIERS: PirateCannonTier[] = [
  { id: 'swivel', name: 'Swivel Gun', cost: 0, attackRating: 20, maxDamage: 16, reloadMs: 1900, range: 240, powerRating: 2, shotColor: 0xa8a29e },
  { id: 'carronade', name: 'Bronze Carronade', cost: 30_000, attackRating: 22, maxDamage: 18, reloadMs: 2000, range: 250, powerRating: 4, shotColor: 0xf59e0b },
  { id: 'culverin', name: 'Iron Culverin', cost: 79_000, attackRating: 32, maxDamage: 26, reloadMs: 1800, range: 280, powerRating: 7, shotColor: 0xcbd5e1 },
  { id: 'longgun', name: 'Steel Long Gun', cost: 208_000, attackRating: 45, maxDamage: 36, reloadMs: 1600, range: 320, powerRating: 11, shotColor: 0x38bdf8 },
  { id: 'basilisk', name: 'Reinforced Basilisk', cost: 548_000, attackRating: 60, maxDamage: 48, reloadMs: 1400, range: 360, powerRating: 16, shotColor: 0xa78bfa },
  { id: 'mythril', name: 'Mythril Broadside', cost: 1_440_000, attackRating: 80, maxDamage: 65, reloadMs: 1200, range: 400, powerRating: 24, shotColor: 0x34d399 },
  { id: 'adamantite', name: 'Adamantite Bombard', cost: 3_800_000, attackRating: 100, maxDamage: 85, reloadMs: 1050, range: 440, powerRating: 36, shotColor: 0xe879f9, shotTrail: true },
  { id: 'leviathan', name: "Leviathan's Wrath", cost: 10_000_000, attackRating: 130, maxDamage: 115, reloadMs: 900, range: 480, powerRating: 55, shotColor: 0xfb7185, shotTrail: true }
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
export const PIRATE_AMMO_PRICE_PER_UNIT = 2

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
 * with smaller terms for effective survivability and utility. Difficulty,
 * spawn pressure, rewards and the payout cap all key off this, so a ship
 * with eight Mythrils reads dramatically stronger than one with eight
 * Swivels even though both fill every port.
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
  levels: { hull: 1, speed: 1, defense: 1, ammoCapacity: 1 },
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
  { id: 'razorskiff', name: 'Razor Skiff', unlockAtMs: 25_000, hp: 55, defense: 8, attackRating: 28, maxDamage: 12, range: 145, speed: 390, reloadMs: 1750, coinMin: 650, coinMax: 950, color: 0xf97316, weight: 3.5, sizeScale: 0.76 },
  { id: 'corsair', name: 'Crimson Corsair', unlockAtMs: 40_000, hp: 50, defense: 8, attackRating: 24, maxDamage: 11, range: 250, speed: 135, reloadMs: 2700, coinMin: 800, coinMax: 1200, color: 0xef4444, weight: 5, volley: 3, sizeScale: 0.9 },
  { id: 'brigantine', name: 'Brigantine', unlockAtMs: 55_000, hp: 80, defense: 12, attackRating: 24, maxDamage: 18, range: 220, speed: 110, reloadMs: 1900, coinMin: 600, coinMax: 900, color: 0x5b7a9e, weight: 8, sizeScale: 0.94 },
  { id: 'sniper', name: 'Longshot Schooner', unlockAtMs: 70_000, hp: 35, defense: 5, attackRating: 62, maxDamage: 55, range: 560, speed: 72, reloadMs: 4800, coinMin: 1500, coinMax: 2200, color: 0xa855f7, weight: 2, sizeScale: 0.8, sniper: true },
  { id: 'ironclad', name: 'Cobalt Ironclad', unlockAtMs: 90_000, hp: 300, defense: 32, attackRating: 20, maxDamage: 12, range: 200, speed: 70, reloadMs: 2100, coinMin: 1400, coinMax: 2000, color: 0x3b82f6, weight: 4, sizeScale: 1.14 },
  { id: 'frigate', name: 'Frigate', unlockAtMs: 130_000, hp: 160, defense: 20, attackRating: 36, maxDamage: 30, range: 300, speed: 125, reloadMs: 1600, coinMin: 1100, coinMax: 1600, color: 0xc06a2c, weight: 6, sizeScale: 1.05 },
  { id: 'manowar', name: "Man-o'-War", unlockAtMs: 215_000, hp: 260, defense: 30, attackRating: 50, maxDamage: 42, range: 380, speed: 105, reloadMs: 1400, coinMin: 1800, coinMax: 2600, color: 0x8b2635, weight: 4, sizeScale: 1.2 },
  { id: 'ghostship', name: 'Ghost Ship', unlockAtMs: 260_000, hp: 200, defense: 26, attackRating: 58, maxDamage: 48, range: 340, speed: 155, reloadMs: 1100, coinMin: 3000, coinMax: 4400, color: 0x2ecc9c, weight: 1.5, sizeScale: 1.02 },
  { id: 'dreadnought', name: 'The Dreadnought', unlockAtMs: 0, hp: 850, defense: 30, attackRating: 52, maxDamage: 36, range: 380, speed: 78, reloadMs: 2000, coinMin: 7600, coinMax: 11000, color: 0x991b1b, weight: 0, volley: 3, sizeScale: 1.55, boss: true }
]

// ─── Boss cadence ───────────────────────────────────────────────────────────
// A Dreadnought surfaces on its own clock (independent of the concurrency
// cap). A strong ship gets it sooner — otherwise the scariest thing in the
// game never shows up until the fight's basically over for a well-built crew.
export const PIRATE_BOSS_FIRST_SPAWN_MS = 85_000
export const PIRATE_BOSS_RESPAWN_MS = 80_000
export const PIRATE_BOSS_DAMAGE_MULT = 0.65

/** First Dreadnought sighting — pulled earlier the stronger the ship. */
export function pirateBossFirstSpawnMs(power: number) {
  return Math.round(PIRATE_BOSS_FIRST_SPAWN_MS - piratePowerT(power) * 30_000)
}

/**
 * Difficulty ramp. Design goal: nobody comfortably survives the full 5
 * minutes — the sea always wins eventually, and the question is how deep you
 * get and how much loot you extract first. Crucially, a strong ship should
 * feel real pressure from minute one — the old curve leaned almost entirely
 * on elapsed time, which left the opening stretch trivial for anyone with a
 * kitted-out broadside since the power-based bite hadn't caught up yet.
 *
 * The per-power coefficients below are intentionally uncapped (unlike the
 * spawn-rate/concurrency curves, which cap out at a sane swarm size) — the
 * armory now runs up to Leviathan's Wrath (power ~1075 fully kitted, roughly
 * double the old Mythril-only ceiling), and stat difficulty needs to keep
 * climbing right along with it rather than plateauing once someone's
 * squeezed everything out of the old top tier.
 *
 * - Enemy HP tracks the player's power (which is DPS-dominated) immediately,
 *   not just as time goes on — a maxed broadside faces bulky targets from
 *   the first shot, while a rookie still pops early ships quickly. A
 *   super-linear time ramp still kicks in on top of that past the ~40% mark.
 * - Enemy damage ramps with time and with power so the late run is lethal
 *   for everyone, and strong ships get chip-damaged from the start too.
 * - Accuracy/defense ratings scale at a damped rate with a hard cap, because
 *   the hit-chance formula degenerates (always-miss / always-hit) when
 *   ratings run away — but the cap itself is a bit higher now so it doesn't
 *   choke off scaling as early into the new, wider power range.
 */
export function pirateDifficultyMultiplier(elapsedMs: number, power: number) {
  const t = Math.min(1.05, elapsedMs / PIRATE_RUN_DURATION_MS)
  const overBase = Math.max(0, power - PIRATE_BASE_POWER)

  const timeHpMult = 1 + t * 1.05 + Math.pow(Math.max(0, t - 0.42), 2) * 3.2
  const powerHpMult = 1 + overBase * 0.024
  const hpMult = timeHpMult * powerHpMult

  // Keep the first two minutes survivable, then let damage accelerate hard.
  // This moves the usual failure point toward minutes 3–5 without flattening
  // the endgame or making high-power glass cannons safe.
  const timeDmgMult = 1 + t * 0.9 + Math.pow(Math.max(0, t - 0.4), 2) * 1.8
  // Per-hit damage grows sub-linearly with power. High-power fleets still
  // produce much more incoming DPS through accuracy, population, and faster
  // reloads, but an ordinary cannonball no longer scales into a one-shot.
  const powerDmgMult = 1 + Math.sqrt(overBase) * 0.035
  const dmgMult = timeDmgMult * powerDmgMult

  const statMult = Math.min(2.3, 1 + (hpMult - 1) * 0.1)

  return { hpMult, dmgMult, statMult }
}

/** More frequent, smaller enemy hits as the run and matchmaking power rise. */
export function pirateEnemyReloadMultiplier(elapsedMs: number, power: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  const pT = piratePowerT(power)
  return Math.max(0.58, 0.96 - pT * 0.1 - t * 0.26)
}

/**
 * Loot inflation — kill rewards (and treasure) climb with run time and player
 * power so the risk of staying out longer keeps paying, and strong ships
 * facing spongier, harder-hitting enemies aren't earning rookie rates.
 */
export function pirateRewardMultiplier(elapsedMs: number, power: number) {
  const t = Math.min(1.05, elapsedMs / PIRATE_RUN_DURATION_MS)
  const overBase = Math.max(0, power - PIRATE_BASE_POWER)
  return 1 + t * 1.6 + overBase * 0.01
}

/**
 * Normalized 0..1 progression of the player's power level, used to scale how
 * crowded the map gets and how fast enemies spawn. This deliberately caps out
 * well before the theoretical max (a full Leviathan's Wrath broadside runs
 * power ~1075) — there's a sane ceiling on how many hulls can usefully be on
 * screen and how fast they can arrive. Past that ceiling, difficulty keeps
 * climbing anyway through pirateDifficultyMultiplier's uncapped per-power HP
 * and damage scaling below, so min-maxing the armory never plateaus into an
 * easy game, it just stops meaning "more enemies" and starts meaning
 * "nastier ones".
 */
export function piratePowerT(power: number) {
  return Math.min(1, Math.max(0, (power - PIRATE_BASE_POWER) / 500))
}

/**
 * Spawn cadence — weak ships see a relaxed trickle, strong ships get
 * swarmed hard from the opening seconds. A maxed broadside two-shots
 * individual hulls, so the actual challenge has to come from volume: more
 * hulls, arriving faster — and a strong ship shouldn't have to wait out the
 * clock to see that pressure, it should be there from minute one.
 */
export function pirateSpawnIntervalMs(elapsedMs: number, power: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = piratePowerT(power)
  const start = 6500 - pT * 4500 // 6.5s at base power → 2s fully kitted, from second one
  const end = 2600 - pT * 1700 // 2.6s → 0.9s by the end of the run
  // Most of the cadence squeeze happens after two minutes.
  const ramp = Math.pow(t, 1.35)
  return Math.round(start - ramp * (start - end))
}

/**
 * Concurrent enemy cap — grows with both run time and player power. The
 * power-driven `growth` term intentionally isn't fully gated behind `t`
 * (only `timeWeight` scales it down, and even at t=0 a third of it still
 * applies) — otherwise a heavily-kitted ship would see almost nothing extra
 * in the opening seconds, which is exactly the "first few minutes are zero
 * challenge" problem this is meant to fix.
 */
export function pirateMaxConcurrentEnemies(elapsedMs: number, power: number) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = piratePowerT(power)
  const base = 2 + pT * 4 // 2 at the start for a rookie, 6 for a veteran
  const growth = 3 + pT * 6 // late pressure still reaches the old swarm ceiling
  const timeWeight = 0.2 + Math.pow(t, 1.25) * 0.8
  return Math.round(base + growth * timeWeight)
}

/** Ships already bearing down on the player when a voyage begins. */
export function pirateInitialEnemyCount(power: number) {
  return 2 + Math.round(piratePowerT(power) * 3)
}

/**
 * Reinforcement size. Rookie runs mostly add one hull at a time; higher-power
 * and later runs frequently add two, with a late veteran chance of three.
 */
export function pirateSpawnBatchSize(elapsedMs: number, power: number, rng: () => number = Math.random) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const pT = piratePowerT(power)
  let count = 1
  if (rng() < 0.08 + pT * 0.42 + Math.pow(t, 1.4) * 0.3) count += 1
  if (pT > 0.55 && rng() < (pT - 0.55) * 0.35 + Math.pow(t, 1.5) * 0.15) count += 1
  return count
}

/** Sea-mine damage rises from 10% to 45% of max hull over the voyage. */
export function pirateSeaMineDamageFraction(elapsedMs: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / PIRATE_RUN_DURATION_MS))
  return 0.1 + Math.pow(t, 1.35) * 0.35
}

// ─── Kill combos ────────────────────────────────────────────────────────────
// Sinking ships back-to-back chains a combo: each link adds a coin bonus on
// top of the kill reward, capped so it stays a nice ramp rather than the
// dominant income source.
export const PIRATE_COMBO_WINDOW_MS = 6000
export const PIRATE_COMBO_BONUS_PER_STACK = 0.1
export const PIRATE_COMBO_MAX_STACKS = 5

/**
 * Weighted-random pick among non-boss tiers unlocked at `elapsedMs`. A strong
 * ship gets an "unlock head start" of up to 90s at full power — otherwise the
 * opening stretch of every run is nothing but sloops and corsairs regardless
 * of how kitted the player is, which is a big part of why the early game
 * used to feel trivial no matter how strong the ship.
 */
export function pirateRollEnemyTier(elapsedMs: number, power = PIRATE_BASE_POWER, rng: () => number = Math.random): PirateEnemyTier {
  const effectiveElapsedMs = elapsedMs + piratePowerT(power) * 90_000
  const available = PIRATE_ENEMY_TIERS.filter(t => !t.boss && t.weight > 0 && effectiveElapsedMs >= t.unlockAtMs)
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

export function pirateTreasureReward(elapsedMs: number, power = PIRATE_BASE_POWER, rng: () => number = Math.random) {
  const t = Math.min(1, elapsedMs / PIRATE_RUN_DURATION_MS)
  const base = (1600 + t * 1400) * (1 + Math.max(0, power - PIRATE_BASE_POWER) * 0.005)
  const variance = 0.8 + rng() * 0.4
  return Math.round(base * variance)
}

// ─── Server-side anti-cheat clamp ──────────────────────────────────────────
// The combat itself is simulated client-side (it's a real-time skill game), so
// finish-run can't be fully re-verified server-side. Instead we bound the
// payout to what's plausible for the elapsed wall-clock time and the power
// level snapshotted at run start, with generous slack over the expected
// average haul so skilled/lucky runs are never clipped in practice.

/** Plausible average coins-per-second for a run at this power — the baseline both the payout cap and the repair-rush price are built from. */
function pirateRunPayoutRatePerSecond(power: number) {
  return 80 + Math.max(0, power - PIRATE_BASE_POWER) * 6.8
}

export function pirateMaxPayoutForRun(elapsedMs: number, power: number, gemAmmoUsed = 0) {
  const seconds = Math.max(0, elapsedMs / 1000)
  // Gem shots noticeably accelerate the kill rate, so each one spent raises
  // the plausible-haul ceiling a little (combo bonuses and the late-run
  // reward multiplier live inside the 1.8 slack factor).
  return Math.round(pirateRunPayoutRatePerSecond(power) * seconds * 1.8 + gemAmmoUsed * 100)
}

/** Rough expected average haul for one full voyage — the payout cap above is this same rate with generous slack layered on top, so dividing that slack back out gives a reasonable "typical run" estimate. */
export function pirateAverageRunPayoutEstimate(power: number) {
  return Math.round(pirateRunPayoutRatePerSecond(power) * (PIRATE_RUN_DURATION_MS / 1000))
}

export const PIRATE_MIN_RUN_MS_FOR_PAYOUT = 3000

// ─── Hull repair ────────────────────────────────────────────────────────────
// Taking damage isn't free anymore: coming back from a voyage puts the ship
// in dry dock for a stretch proportional to how badly it was shot up, up to
// a full 2 hours for a total loss. This is what actually stops a strong ship
// from just re-running the same 5 minutes forever for easy money — the
// bigger per-kill payouts above only make sense because of this cap.
export const PIRATE_REPAIR_MAX_MS = 2 * 60 * 60 * 1000

/** Repair time owed for a given fraction of hull damage taken (0 = pristine, 1 = sunk). */
export function pirateRepairDurationMs(hullDamageFraction: number) {
  const frac = Math.min(1, Math.max(0, hullDamageFraction))
  return Math.round(PIRATE_REPAIR_MAX_MS * frac)
}

// A full-length rush (skipping the entire 2h a total loss would cost) is
// priced a bit above one voyage's expected average haul, so paying to skip
// the wait is never quietly more profitable than just playing — it's there
// for players who'd rather spend coin than time, not a loophole around the
// repair timer.
export const PIRATE_REPAIR_RUSH_MULTIPLIER = 1.25

/** Coin cost to instantly clear `remainingMs` of repair time at the given power level. */
export function pirateRepairRushCost(power: number, remainingMs: number) {
  const clampedRemaining = Math.min(PIRATE_REPAIR_MAX_MS, Math.max(0, remainingMs))
  if (clampedRemaining <= 0) return 0
  const fullRushCost = pirateAverageRunPayoutEstimate(power) * PIRATE_REPAIR_RUSH_MULTIPLIER
  return Math.round(fullRushCost * (clampedRemaining / PIRATE_REPAIR_MAX_MS))
}
