import { relations, sql } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, index, numeric, integer, unique, jsonb, bigint } from 'drizzle-orm/pg-core'
import type {
  PathwardenGameState,
  PathwardenMapPlan
} from '#shared/types/pathwarden-save'
import type { FirewallRunSave } from '#shared/utils/gamelogic/firewall'
import type {
  TcgSheetLayout,
  TcgPackTemplateSlot,
  TcgPackCut,
  TcgRestockEntry,
  TcgCardRaw,
  TcgCondition
} from '#shared/types/tcg-db'
import type { RateTemplate } from '#shared/utils/tcg/rate-fitter'
import type { TcgGradeResult } from '#shared/utils/tcg/grading-model-types'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  emblem: text('emblem'),
  balance: numeric('balance', { precision: 19, scale: 4 }).notNull().default('0'),
  rake: numeric('rake', { precision: 19, scale: 4 }).notNull().default('0'),
  rakebackUnlocked: boolean('rakeback_unlocked').notNull().default(false),
  isPokemonAdmin: boolean('is_pokemon_admin').notNull().default(false),
  gems: integer('gems').notNull().default(0),
  // Account-wide reset tier, 0-4. Raised only by server/utils/prestige.ts,
  // which wipes every game table in the same transaction.
  prestige: integer('prestige').notNull().default(0),
  // Paid out on each ascent (5/10/15/20) and spent in the prestige shop.
  prestigeTokens: integer('prestige_tokens').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const emblemHistory = pgTable(
  'emblem_history',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    emblem: text('emblem').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [index('emblem_history_userId_createdAt_idx').on(table.userId, table.createdAt)]
)

export const transactions = pgTable(
  'transactions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    type: text('type').notNull(),
    category: text('category'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [index('transactions_userId_createdAt_idx').on(table.userId, table.createdAt)]
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  table => [index('session_userId_idx').on(table.userId)]
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [index('account_userId_idx').on(table.userId)]
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [index('verification_identifier_idx').on(table.identifier)]
)

export const minerState = pgTable('miner_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  rigLevel: integer('rig_level').notNull().default(1),
  vaultLevel: integer('vault_level').notNull().default(1),
  lastCollectedAt: timestamp('last_collected_at').defaultNow().notNull(),
  factoryLevel: integer('factory_level').notNull().default(1),
  factoryLastCollectedAt: timestamp('factory_last_collected_at').defaultNow().notNull(),
  lootboxSlots: integer('lootbox_slots').notNull().default(1),
  lootboxTodayOpens: integer('lootbox_today_opens').notNull().default(0),
  lootboxOpensDate: text('lootbox_opens_date').notNull().default(''),
  overclockLevel: integer('overclock_level').notNull().default(0),
  catalystLevel: integer('catalyst_level').notNull().default(0)
})

// ─── Pirates ──────────────────────────────────────────────────────────────

export const pirateState = pgTable('pirate_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  hullLevel: integer('hull_level').notNull().default(1),
  speedLevel: integer('speed_level').notNull().default(1),
  defenseLevel: integer('defense_level').notNull().default(1),
  ammoCapacityLevel: integer('ammo_capacity_level').notNull().default(1),
  // Passive hull regeneration track — every captain owns level 1 (+1 hull/sec)
  // for free; regen only ticks after PIRATE_REGEN_DELAY_MS without being hit.
  regenLevel: integer('regen_level').notNull().default(1),
  // Unlocked gun ports. Slot 0 starts equipped with a free starter cannon
  // (see pirateCannons) so a brand new player isn't defenseless.
  cannonSlots: integer('cannon_slots').notNull().default(1),
  ammoCount: integer('ammo_count').notNull().default(60),
  // Premium gem-bought shots, tracked separately from the coin-bought stock.
  gemAmmoCount: integer('gem_ammo_count').notNull().default(0),
  runsPlayed: integer('runs_played').notNull().default(0),
  totalCoinsEarned: integer('total_coins_earned').notNull().default(0),
  bestSurvivalMs: integer('best_survival_ms').notNull().default(0),
  bestRunPower: integer('best_run_power').notNull().default(0),
  bestRunLoot: integer('best_run_loot').notNull().default(0),
  ownedSkinIds: jsonb('owned_skin_ids').$type<string[]>().notNull().default(['starter']),
  equippedSkinId: text('equipped_skin_id').notNull().default('starter'),
  ownedAbilityIds: jsonb('owned_ability_ids').$type<string[]>().notNull().default(['bomb']),
  equippedAbilityId: text('equipped_ability_id').notNull().default('bomb'),
  // Per-ability upgrade track, keyed by ability id. A missing key means level
  // 1 — every owned ability starts there, so the map only stores what has
  // actually been paid for.
  abilityLevels: jsonb('ability_levels').$type<Record<string, number>>().notNull().default({}),
  // Set when a voyage starts, cleared on finish. Server computes elapsed time
  // from this instead of trusting the client, and snapshots the power level
  // so mid-run upgrades can't raise the finish-run payout ceiling.
  runStartedAt: timestamp('run_started_at'),
  runPowerSnapshot: integer('run_power_snapshot'),
  runDifficultySnapshot: integer('run_difficulty_snapshot'),
  // Only full six-minute clears advance this value. Difficulty 0 is the
  // universal starting tier, so -50 means a new captain has no clear yet.
  highestCompletedDifficulty: integer('highest_completed_difficulty').notNull().default(sql`'-50'`),
  bestCompletedLoot: integer('best_completed_loot').notNull().default(0),
  bestCompletedPower: integer('best_completed_power').notNull().default(0),
  bestCompletedSkinId: text('best_completed_skin_id').notNull().default('starter'),
  // Hull damage from the last voyage puts the ship in dry dock — up to 2h for
  // a total loss, proportional for a partial one. Set on finish-run, cleared
  // naturally once it elapses or immediately via the repair-rush endpoint.
  // hullRepairTotalMs is kept alongside so the client can render a progress
  // bar (it's the original duration this repair was scheduled for).
  hullRepairUntil: timestamp('hull_repair_until'),
  hullRepairTotalMs: integer('hull_repair_total_ms').notNull().default(0)
})

// Equipped cannons, one row per occupied gun port (0..cannonSlots-1). Selling
// removes the row; purchasePrice is stored per-instance (rather than re-read
// from the tier config) so the 20% sell refund stays correct even if tier
// prices are rebalanced later.
export const pirateCannons = pgTable('pirate_cannons', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  slotIndex: integer('slot_index').notNull(),
  tierId: text('tier_id').notNull(),
  purchasePrice: integer('purchase_price').notNull()
}, t => [index('pirate_cannons_userId_idx').on(t.userId)])

export const pirateRunHistory = pgTable('pirate_run_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  loot: integer('loot').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  power: integer('power').notNull().default(0),
  difficulty: integer('difficulty').notNull().default(0),
  survived: boolean('survived').notNull().default(false),
  reason: text('reason').notNull(),
  kills: integer('kills').notNull().default(0),
  shotsFired: integer('shots_fired').notNull().default(0),
  skinId: text('skin_id').notNull().default('starter'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [
  index('pirate_run_history_userId_createdAt_idx').on(t.userId, t.createdAt)
])

// ─── SHAPEZZ ─────────────────────────────────────────────────────────────

export const shapezzState = pgTable('shapezz_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  coreLevel: integer('core_level').notNull().default(0),
  overclockLevel: integer('overclock_level').notNull().default(0),
  armorLevel: integer('armor_level').notNull().default(0),
  thrustersLevel: integer('thrusters_level').notNull().default(0),
  magnetLevel: integer('magnet_level').notNull().default(0),
  killHealLevel: integer('kill_heal_level').notNull().default(0),
  // Gem-bought, consumed the moment a run starts (see shapezzHeadStartCost) — not a permanent chassis level.
  headStartLevel: integer('head_start_level').notNull().default(0),
  weaponType: text('weapon_type').notNull().default('blaster'), // equipped weapon type
  blasterRarity: text('blaster_rarity').notNull().default('common'),
  blasterPurchasePrice: integer('blaster_purchase_price').notNull().default(0),
  launcherRarity: text('launcher_rarity'), // null = not owned
  launcherPurchasePrice: integer('launcher_purchase_price').notNull().default(0),
  shotgunRarity: text('shotgun_rarity'), // null = not owned
  shotgunPurchasePrice: integer('shotgun_purchase_price').notNull().default(0),
  arcCoilRarity: text('arc_coil_rarity'), // null = not owned
  arcCoilPurchasePrice: integer('arc_coil_purchase_price').notNull().default(0),
  runsPlayed: integer('runs_played').notNull().default(0),
  totalCoinsEarned: integer('total_coins_earned').notNull().default(0),
  bestSurvivalMs: integer('best_survival_ms').notNull().default(0),
  bestKills: integer('best_kills').notNull().default(0),
  bestCheckpoint: integer('best_checkpoint').notNull().default(0),
  runStartedAt: timestamp('run_started_at'),
  runDifficultySnapshot: text('run_difficulty_snapshot'),
  runPowerSnapshot: integer('run_power_snapshot'),
  // Set when a run settles as cashout or defeat (not abandoned) — the arena
  // cooldown is derived from this at read time, never stored.
  lastRunFinishedAt: timestamp('last_run_finished_at')
})

export const pathwardenState = pgTable('pathwarden_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  bulwarkLevel: integer('bulwark_level').notNull().default(0),
  artificerLevel: integer('artificer_level').notNull().default(0),
  lensLevel: integer('lens_level').notNull().default(0),
  reservoirLevel: integer('reservoir_level').notNull().default(0),
  bannerLevel: integer('banner_level').notNull().default(0),
  bountyLevel: integer('bounty_level').notNull().default(0),
  arcanistLevel: integer('arcanist_level').notNull().default(0),
  surgeCharges: integer('surge_charges').notNull().default(0),
  skipIntro: boolean('skip_intro').notNull().default(false),
  keyboardPan: boolean('keyboard_pan').notNull().default(false),
  claimedCheckpointWaves: jsonb('claimed_checkpoint_waves').$type<number[]>().notNull().default([]),
  ambientStoryIds: jsonb('ambient_story_ids').$type<number[]>().notNull().default([]),
  ambientRewardClaimed: boolean('ambient_reward_claimed').notNull().default(false),
  freeBoostCredits: integer('free_boost_credits').notNull().default(0),
  ownedDefenseIds: jsonb('owned_defense_ids').$type<string[]>().notNull().default(['bolt', 'mortar', 'frost']),
  ownedSkinIds: jsonb('owned_skin_ids').$type<string[]>().notNull().default(['warden-stone']),
  equippedSkinId: text('equipped_skin_id').notNull().default('warden-stone'),
  runsPlayed: integer('runs_played').notNull().default(0),
  totalCoinsEarned: numeric('total_coins_earned', { precision: 19, scale: 4 }).notNull().default('0'),
  bestWave: integer('best_wave').notNull().default(0),
  bestScore: integer('best_score').notNull().default(0),
  bestRealm: integer('best_realm').notNull().default(0),
  bestFlawless: integer('best_flawless').notNull().default(0),
  highestCompletedRealm: integer('highest_completed_realm').notNull().default(0),
  runStartedAt: timestamp('run_started_at'),
  runRealmSnapshot: integer('run_realm_snapshot'),
  runPowerSnapshot: integer('run_power_snapshot'),
  runSurgedSnapshot: boolean('run_surged_snapshot'),
  lastRunFinishedAt: timestamp('last_run_finished_at'),
  lastAmbientStoryAt: timestamp('last_ambient_story_at')
})

export const pathwardenRuns = pgTable('pathwarden_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  saveVersion: integer('save_version').notNull(),
  generatorVersion: integer('generator_version').notNull(),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  realm: integer('realm').notNull(),
  mapPlan: jsonb('map_plan').$type<PathwardenMapPlan>().notNull(),
  gameState: jsonb('game_state').$type<PathwardenGameState>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
})

/**
 * Grand-exchange-style limit orders. Placing a buy order escrows
 * `quantity × price` coins; placing a sell order escrows `quantity` gems.
 * `filled` advances as opposing orders match (partial fills allowed) and the
 * escrow for the unfilled remainder is returned on cancel. Matching runs under
 * a Postgres advisory lock (see server/utils/gem-exchange.ts) so the book is
 * only ever mutated by one request at a time.
 */
// ─── FIREWALL ────────────────────────────────────────────────────────────

// Permanent, coin-bought Mainframe levels plus the account records the
// difficulty gate reads. A run in progress is the `runStartedAt` lock here and
// the save blob in `firewallRuns` — the two are always written together.
export const firewallState = pgTable('firewall_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  bulwarkLevel: integer('bulwark_level').notNull().default(0),
  munitionsLevel: integer('munitions_level').notNull().default(0),
  foundryLevel: integer('foundry_level').notNull().default(0),
  grantLevel: integer('grant_level').notNull().default(0),
  salvageLevel: integer('salvage_level').notNull().default(0),
  capacitorLevel: integer('capacitor_level').notNull().default(0),
  charterLevel: integer('charter_level').notNull().default(0),
  arsenalLevel: integer('arsenal_level').notNull().default(0),
  runsPlayed: integer('runs_played').notNull().default(0),
  totalCoinsEarned: numeric('total_coins_earned', { precision: 19, scale: 4 }).notNull().default('0'),
  // Gates the higher difficulties. Only ever raised by a settled run.
  bestWave: integer('best_wave').notNull().default(0),
  bestKills: integer('best_kills').notNull().default(0),
  bestPayout: integer('best_payout').notNull().default(0),
  victories: integer('victories').notNull().default(0),
  runStartedAt: timestamp('run_started_at'),
  runDifficultySnapshot: text('run_difficulty_snapshot'),
  runPowerSnapshot: integer('run_power_snapshot'),
  // Salvage Rig is snapshotted at deploy so a level bought mid-run cannot
  // retroactively multiply coins the run already banked.
  runCoinMultiplierSnapshot: numeric('run_coin_multiplier_snapshot', { precision: 10, scale: 4 }),
  lastRunFinishedAt: timestamp('last_run_finished_at')
})

// One saved run per user, replaced wholesale on every uplink. `revision` is a
// compare-and-swap guard so two tabs cannot interleave saves.
export const firewallRuns = pgTable('firewall_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull().default(0),
  saveVersion: integer('save_version').notNull(),
  runState: jsonb('run_state').$type<FirewallRunSave>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
})

export const gemOrders = pgTable('gem_orders', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  side: text('side').notNull(), // 'buy' | 'sell'
  price: numeric('price', { precision: 19, scale: 4 }).notNull(), // coins per gem
  quantity: integer('quantity').notNull(),
  filled: integer('filled').notNull().default(0),
  status: text('status').notNull().default('open'), // 'open' | 'filled' | 'cancelled'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
}, t => [
  index('gem_orders_book_idx').on(t.status, t.side, t.price),
  index('gem_orders_userId_createdAt_idx').on(t.userId, t.createdAt)
])

/** One row per executed match — doubles as the exchange's price history. */
export const gemTrades = pgTable('gem_trades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  buyerId: text('buyer_id').references(() => user.id, { onDelete: 'set null' }),
  sellerId: text('seller_id').references(() => user.id, { onDelete: 'set null' }),
  takerId: text('taker_id').references(() => user.id, { onDelete: 'set null' }),
  price: numeric('price', { precision: 19, scale: 4 }).notNull(),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('gem_trades_createdAt_idx').on(t.createdAt)])

/**
 * A bank position is settled lazily whenever it is read or changed. `principal`
 * tracks user-funded savings only (earned interest is deliberately excluded),
 * while `maxPrincipal` is its all-time high-water mark for loan eligibility.
 */
export const bankState = pgTable('bank_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  balance: numeric('balance', { precision: 19, scale: 4 }).notNull().default('0'),
  principal: numeric('principal', { precision: 19, scale: 4 }).notNull().default('0'),
  maxPrincipal: numeric('max_principal', { precision: 19, scale: 4 }).notNull().default('0'),
  loanPrincipal: numeric('loan_principal', { precision: 19, scale: 4 }).notNull().default('0'),
  lastSettledAt: timestamp('last_settled_at').defaultNow().notNull(),
  // Bail-out ledger. The debt is lifted off `balance` and parked here: the 40%
  // levy pays it down into `bailoutRepaid`, and the penalty ends at whichever
  // comes first — `bailoutUntil` lapsing or the two meeting. `bailoutUntil` is
  // nulled the moment it is settled, which is also the flag for "no penalty".
  bailoutAt: timestamp('bailout_at'),
  bailoutUntil: timestamp('bailout_until'),
  bailoutDebt: numeric('bailout_debt', { precision: 19, scale: 4 }).notNull().default('0'),
  bailoutRepaid: numeric('bailout_repaid', { precision: 19, scale: 4 }).notNull().default('0')
})

/** Snapshot only at bank actions; the UI projects the latest point in real time. */
export const bankHistory = pgTable('bank_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  balance: numeric('balance', { precision: 19, scale: 4 }).notNull(),
  action: text('action').notNull(),
  amount: numeric('amount', { precision: 19, scale: 4 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('bank_history_userId_createdAt_idx').on(t.userId, t.createdAt)])

/**
 * Escrow for the live table. Every stake — opening bet, double, split, insurance
 * — writes a row in the same transaction as its debit, and settlement marks the
 * row settled in the same transaction as the payout. A process that dies
 * mid-round therefore leaves its unsettled stakes visible, and the recovery
 * sweep in server/plugins refunds them instead of pocketing the player's money.
 */
export const liveBlackjackWagers = pgTable(
  'live_blackjack_wagers',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    roundId: integer('round_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    kind: text('kind').notNull(),
    settled: boolean('settled').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [index('live_blackjack_wagers_settled_createdAt_idx').on(table.settled, table.createdAt)]
)

/**
 * Escrow for every table game built on the shared LiveTable base — roulette,
 * baccarat, three card poker, casino hold'em. Same contract as the blackjack
 * table above, with a `game` column instead of a table per game, so one
 * recovery sweep covers all of them.
 */
export const tableWagers = pgTable(
  'table_wagers',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    game: text('game').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    roundId: integer('round_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    kind: text('kind').notNull(),
    settled: boolean('settled').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [index('table_wagers_settled_createdAt_idx').on(table.settled, table.createdAt)]
)

// ─── Xeno ──────────────────────────────────────────────────────────────────

/**
 * One row = one plant instance. typeId links to PLANT_TYPES config for
 * name/emoji/tier/baseTime/value. speed/yield are per-instance and can
 * differ from config defaults after breeding. Inventory groups by (typeId, speed, yield).
 */

export const xenoPlants = pgTable('xeno_plants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull(),
  speed: integer('speed').notNull(),
  yield: integer('yield').notNull()
}, t => [index('xeno_plants_userId_idx').on(t.userId)])

/**
 * Permanent record of every plant type a user has ever obtained. Unlocks are
 * never removed, so selling or breeding away every instance of a plant does not
 * soft-lock the player out of buying it again or seeing it in the encyclopedia.
 * Written via addPlants whenever plants are acquired.
 */

export const xenoPlantsUnlocked = pgTable('xeno_plants_unlocked', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull(),
  unlockedAt: timestamp('unlocked_at').defaultNow().notNull()
}, t => [index('xeno_plants_unlocked_userId_idx').on(t.userId)])

/** Permanent account-wide Xeno market upgrades. */
export const xenoUpgrades = pgTable('xeno_upgrades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  mutationLevel: integer('mutation_level').notNull().default(0),
  yieldLevel: integer('yield_level').notNull().default(0),
  speedLevel: integer('speed_level').notNull().default(0)
})

/** Artifact instances: each row is one artifact with its remaining charges */
export const xenoArtifacts = pgTable('xeno_artifacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull(),
  chargesRemaining: integer('charges_remaining').notNull(),
  /** Crafted with gems for +1 level on every one of its effects. */
  gemCrafted: boolean('gem_crafted').notNull().default(false)
}, t => [index('xeno_artifacts_userId_idx').on(t.userId)])

/** Grid slots: plantId references the specific plant instance growing. */
export const xenoGridSlots = pgTable('xeno_grid_slots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  slotIndex: integer('slot_index').notNull(),
  plantId: text('plant_id').references(() => xenoPlants.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at'),
  artifactId: text('artifact_id').references(() => xenoArtifacts.id, { onDelete: 'set null' })
}, t => [index('xeno_grid_userId_idx').on(t.userId)])

/**
 * Breeder slots. Parents are consumed (deleted from xenoPlants) when breeding starts;
 * their type/speed/yield stored here for display. Result stats stored for deterministic collect.
 */
export const xenoBreederSlots = pgTable('xeno_breeder_slots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  slotIndex: integer('slot_index').notNull(),
  plant1TypeId: text('plant1_type_id'),
  plant1Speed: integer('plant1_speed'),
  plant1Yield: integer('plant1_yield'),
  plant2TypeId: text('plant2_type_id'),
  plant2Speed: integer('plant2_speed'),
  plant2Yield: integer('plant2_yield'),
  startedAt: timestamp('started_at'),
  artifactId: text('artifact_id').references(() => xenoArtifacts.id, { onDelete: 'set null' }),
  resultTypeId: text('result_type_id'),
  resultSpeed: integer('result_speed'),
  resultYield: integer('result_yield'),
  resultQuantity: integer('result_quantity'),
  wasMutation: boolean('was_mutation'),
  collected: boolean('collected').notNull().default(false)
}, t => [index('xeno_breeder_userId_idx').on(t.userId)])

// ─── Colony ───────────────────────────────────────────────────────────────────

/**
 * One row per user. Bugs forage continuously rather than XENO's single-shot
 * grow cycle, so production is settled analytically from elapsed real time
 * (see server/utils/colony.ts:settleColony) every time state is read or a
 * colony action runs — there is no server-side interval/loop. lastSettledAt
 * is the anchor nutrition decay (and each bug's tick progress) is computed
 * from. Settling never credits items directly to the player — it only fills
 * colonyLoot, which must be claimed manually via the loot chest.
 */
export const colonyState = pgTable('colony_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  /** Gates which bug tiers are purchasable (tier N species require habitatLevel >= N). */
  habitatLevel: integer('habitat_level').notNull().default(1),
  /** Current nutrition units, capped by the derived nutrition_storage track max; bugs stop producing at 0 */
  nutrition: integer('nutrition').notNull().default(150),
  /**
   * Premium nutrition bought with gems (at least 200 points per gem, scaling
   * with tank size) instead of
   * coins — always drained BEFORE regular nutrition, and grants +1 yield
   * and +20% speed colony-wide (every non-gem bug) for as long as any is
   * left. Shares the same tank ceiling as `nutrition` (gemNutrition +
   * nutrition <= nutritionMax).
   */
  gemNutrition: integer('gem_nutrition').notNull().default(0),
  lastSettledAt: timestamp('last_settled_at').defaultNow().notNull()
})

/**
 * One row = one builder currently working. A colony has BASE_BUILDER_COUNT
 * builders plus whatever the prestige shop's Labour Contract granted, so the
 * number of concurrent rows is capped by the caller, not the schema.
 *
 * The unique (user, track) constraint is the real guard, not a convenience:
 * two builders on the same track would each collect "level N+1" and the
 * player would pay once for a level they got twice. HABITAT_BUILDER_JOB_ID
 * occupies the same namespace, so the habitat can also only ever have one
 * builder on it.
 */
export const colonyBuilderJobs = pgTable('colony_builder_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** An UpgradeTrackId, or HABITAT_BUILDER_JOB_ID for a habitat level-up. */
  trackId: text('track_id').notNull(),
  startedAt: timestamp('started_at').defaultNow().notNull()
}, t => [
  index('colony_builder_jobs_userId_idx').on(t.userId),
  unique('colony_builder_jobs_unique').on(t.userId, t.trackId)
])

/**
 * One row = one bug instance. Buying a bug puts it in the player's inventory
 * (inTerrarium: false) — it only forages once manually placed into the
 * terrarium (up to capacity), mirroring XENO's buy-then-plant flow.
 * speed is a randomly-rolled percentage trait (0-25) that cuts tick time.
 * yield and eat are both fixed levels (not percentages) rolled once within
 * the species' range on purchase: yield is the exact item quantity dropped
 * per tick, eat is the exact nutrition spent per COMPLETED tick (so a
 * shorter effective tick from the speed trait means more meals per hour).
 */
export const colonyBugs = pgTable('colony_bugs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull(),
  speed: integer('speed').notNull(),
  yield: integer('yield').notNull(),
  /** Nutrition spent per completed production tick — rolled once on purchase, like speed/yield. Defaults cover any pre-existing rows from before this column existed. */
  eat: integer('eat').notNull().default(8),
  /** Whether this bug is placed in the terrarium (foraging) or sitting in inventory. */
  inTerrarium: boolean('in_terrarium').notNull().default(false),
  /** Progress in ms toward this bug's next production tick, only advances while placed. */
  tickProgressMs: integer('tick_progress_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('colony_bugs_userId_idx').on(t.userId)])

/**
 * Loot a bug's production tick generates but the player hasn't claimed yet.
 * Settling fills this; the loot chest (loot/collect) moves it into colonyItems.
 */
export const colonyLoot = pgTable('colony_loot', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  itemTypeId: text('item_type_id').notNull(),
  quantity: integer('quantity').notNull().default(0)
}, t => [
  index('colony_loot_userId_idx').on(t.userId),
  unique('colony_loot_unique').on(t.itemTypeId, t.userId)
])

/** Claimed item inventory — spendable in the market and toward item-gated upgrades. */
export const colonyItems = pgTable('colony_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  itemTypeId: text('item_type_id').notNull(),
  quantity: integer('quantity').notNull().default(0)
}, t => [
  index('colony_items_userId_idx').on(t.userId),
  unique('colony_items_unique').on(t.itemTypeId, t.userId)
])

/** Leveled builder upgrade tracks (capacity, yield, speed, nutrition storage/efficiency). One row per track. */
export const colonyUpgrades = pgTable('colony_upgrades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull(),
  level: integer('level').notNull().default(0)
}, t => [
  index('colony_upgrades_userId_idx').on(t.userId),
  unique('colony_upgrades_unique').on(t.trackId, t.userId)
])

/**
 * Per-species research level (0-4) — sacrificing a growing number of a
 * species' own bugs on the Research page raises the roll range every FUTURE
 * purchase of that species uses (see RESEARCH_SPEED_MIN/MAX and
 * RESEARCH_YIELD_MIN/MAX in shared/utils/colony.ts). One row per species
 * the player has ever researched; missing = level 0 (base roll).
 */
export const colonyBugResearch = pgTable('colony_bug_research', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  typeId: text('type_id').notNull(),
  level: integer('level').notNull().default(0)
}, t => [
  index('colony_bug_research_userId_idx').on(t.userId),
  unique('colony_bug_research_unique').on(t.typeId, t.userId)
])

// ─── Prestige shop ────────────────────────────────────────────────────────────

/**
 * How many times this run has bought each prestige shop item. One row per
 * (user, item); missing means zero owned.
 *
 * This carries a `user_id` and is deliberately NOT on the prestige preserve
 * list, so ascending wipes it along with everything else the tokens bought.
 * That is what makes the token refund honest: the perks die in the same
 * transaction that hands the allowance back (see server/utils/prestige.ts).
 *
 * Some items apply their effect once, at purchase (plants, bugs, agents,
 * levels); others are read live from this count (the miner level ceilings,
 * see minerRigMaxLevel). Both kinds vanish here.
 */
export const prestigePurchases = pgTable('prestige_purchases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  count: integer('count').notNull().default(0)
}, t => [
  index('prestige_purchases_userId_idx').on(t.userId),
  unique('prestige_purchases_unique').on(t.userId, t.itemId)
])

// ─── Hack Ops ─────────────────────────────────────────────────────────────────

export const hackState = pgTable('hack_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  rosterSlots: integer('roster_slots').notNull().default(2),
  totalOpsCompleted: integer('total_ops_completed').notNull().default(0),
  totalRecruits: integer('total_recruits').notNull().default(0),
  shopItems: jsonb('shop_items').notNull().default([]),
  shopRefreshAt: timestamp('shop_refresh_at').notNull().defaultNow()
})

export const hackAgents = pgTable('hack_agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  class: text('class').notNull(),
  rarity: text('rarity').notNull(),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  equippedTool: text('equipped_tool'),
  equippedSoftware: text('equipped_software'),
  equippedHardware: text('equipped_hardware'),
  traits: jsonb('traits').notNull().default([]),
  // Active agents count toward power and can be deployed on ops. Inactive agents
  // sit in storage (the roster holds up to `rosterSlots` active agents; storage
  // holds the rest up to MAX_AGENTS total).
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('hack_agents_userId_idx').on(t.userId)])

export const hackItems = pgTable('hack_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slot: text('slot').notNull(),
  // Items drop at level 1 and are upgraded with gems at the Crafting Bench.
  itemLevel: integer('item_level').notNull().default(1),
  rarity: text('rarity').notNull(),
  mods: jsonb('mods').notNull().default([]),
  equippedBy: text('equipped_by'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('hack_items_userId_idx').on(t.userId)])

export const hackArtifacts = pgTable('hack_artifacts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  // One of the seven AgentTraitType values, e.g. 'power_flat'
  traitType: text('trait_type').notNull(),
  rarity: text('rarity').notNull(),
  count: integer('count').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('hack_artifacts_userId_idx').on(t.userId)])

export const hackOps = pgTable('hack_ops', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(),
  agentIds: jsonb('agent_ids').notNull().default([]),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completesAt: timestamp('completes_at').notNull(),
  collected: boolean('collected').notNull().default(false),
  reward: jsonb('reward')
}, t => [index('hack_ops_userId_idx').on(t.userId)])

// One row per collected op — a lightweight log of the outcome (success, loot, time
// taken) used by the player's history page and the leaderboard's ops-done count.
export const hackHistory = pgTable('hack_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  templateId: text('template_id').notNull(),
  success: boolean('success').notNull(),
  cash: numeric('cash', { precision: 19, scale: 4 }).notNull().default('0'),
  gems: integer('gems').notNull().default(0),
  itemName: text('item_name'),
  itemRarity: text('item_rarity'),
  agentCount: integer('agent_count').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('hack_history_userId_idx').on(t.userId)])

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('chat_messages_createdAt_idx').on(t.createdAt)])

// One row per @mention in a chat message. `seen` flips once the mentioned
// user has actually had the message on screen (or jumped to it).
export const chatMentions = pgTable('chat_mentions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  seen: boolean('seen').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('chat_mentions_userId_idx').on(t.userId)])

// ─── AI assistant ───────────────────────────────────────────────────────────

export const aiConversations = pgTable('ai_conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('New chat'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at')
}, t => [index('ai_conversations_userId_updatedAt_idx').on(t.userId, t.updatedAt)])

export const aiMessages = pgTable('ai_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  toolCalls: jsonb('tool_calls'),
  toolCallId: text('tool_call_id'),
  toolName: text('tool_name'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [
  index('ai_messages_conversationId_createdAt_idx').on(t.conversationId, t.createdAt),
  index('ai_messages_userId_role_createdAt_idx').on(t.userId, t.role, t.createdAt)
])

// ─── TCG Collector ────────────────────────────────────────────────────────────

/**
 * One authored set. Lifecycle: 'draft' (checklist/sheets/template editable) →
 * 'committed' (secretKey generated, commitmentDigest published, everything
 * frozen; packs become purchasable). `secretKey` is server-only and must NEVER
 * be serialized to any client, admin included. Pack purchase is guarded by a
 * conditional UPDATE on packsSold (mutation-is-the-guard) — packsSold only ever
 * moves forward and never exceeds targetPackCount.
 */
export const tcgSet = pgTable('tcg_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  code: text('code').notNull(),
  plaatjesSetCode: text('plaatjes_set_code'),
  /** Pricedex rate-template code this set was created from, null for manual sets. */
  templateCode: text('template_code'),
  /** The full scraped rate template — provenance for diagnostics and god fitting. */
  publishedRates: jsonb('published_rates').$type<RateTemplate>(),
  releaseDate: text('release_date'),
  status: text('status').notNull().default('draft'), // 'draft' | 'committed'
  /** N — total packs this print run can ever sell. Set before commit. */
  targetPackCount: integer('target_pack_count'),
  /** Published god-pack rate ("1 in X"). Null = the set has no god packs. */
  godPackOneIn: integer('god_pack_one_in'),
  /** G — exact god pack count, derived and frozen at commit. */
  godPackCount: integer('god_pack_count'),
  /** Hex CSPRNG key generated at commit. Server-only — never serialized. */
  secretKey: text('secret_key'),
  /** sha256 over canonical layouts + k + N + G + key, published at commit. */
  commitmentDigest: text('commitment_digest'),
  packsSold: integer('packs_sold').notNull().default(0),
  basePacksSold: integer('base_packs_sold').notNull().default(0),
  godPacksSold: integer('god_packs_sold').notNull().default(0),
  /**
   * Returned reservations awaiting random re-surfacing (admin debug returns).
   * Read-modify-write only under the set row lock (lockSetForUpdate).
   */
  restockPool: jsonb('restock_pool').$type<TcgRestockEntry[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
})

/**
 * One checklist entry (variant suffixes stripped — `plaatjesBaseId` is the
 * suffix-free id). Imported from the pokemonplaatjes sidecar; read-only after
 * import, replaced wholesale on re-import while the set is still a draft.
 */
export const tcgCard = pgTable('tcg_cards', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  plaatjesBaseId: text('plaatjes_base_id').notNull(),
  number: text('number').notNull(),
  setTotal: integer('set_total'),
  name: text('name').notNull(),
  rarity: text('rarity'),
  rarityCode: text('rarity_code'),
  category: text('category'),
  sortOrder: integer('sort_order').notNull().default(0),
  raw: jsonb('raw').$type<TcgCardRaw>().notNull()
}, t => [
  index('tcg_cards_setId_sortOrder_idx').on(t.setId, t.sortOrder),
  unique('tcg_cards_setId_plaatjesBaseId_unique').on(t.setId, t.plaatjesBaseId)
])

/**
 * One printable variant of a card (`plaatjesCardId` keeps the variant suffix,
 * e.g. `_ph`). Carries everything the WebGL foil renderer needs so pack-open
 * responses never have to re-derive render refs. Referenced by id from sheet
 * layouts; read-only after import.
 */
export const tcgPrinting = pgTable('tcg_printings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => tcgCard.id, { onDelete: 'cascade' }),
  plaatjesCardId: text('plaatjes_card_id').notNull(),
  finish: text('finish').notNull(), // 'nonholo' | 'holo' | 'reverse'
  pattern: text('pattern'), // e.g. 'pokeball' | 'masterball'
  printRunLabel: text('print_run_label').notNull().default('1st'),
  bundle: text('bundle'),
  assetNumber: text('asset_number'),
  maskKind: text('mask_kind'),
  foilEffect: text('foil_effect'),
  foilMask: text('foil_mask')
}, t => [
  index('tcg_printings_setId_idx').on(t.setId),
  index('tcg_printings_cardId_idx').on(t.cardId),
  unique('tcg_printings_setId_plaatjesCardId_unique').on(t.setId, t.plaatjesCardId)
])

/**
 * One print sheet: `layout` is the full circular slot order (length M, entries
 * are tcgPrinting ids), authored and validated as one value. Runtime fields are
 * frozen at commit: `impressions` (R), `cursorLimit` (base sheets: N−G packs;
 * god sheet: G). `cursor` counts cuts served and only ever advances via a
 * conditional UPDATE `WHERE cursor < cursor_limit` — the mutation is the guard,
 * so a sheet can never over-serve.
 */
export const tcgSheet = pgTable('tcg_sheets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role').notNull().default('base'), // 'base' | 'god'
  /** k — how many consecutive slots one pack cut takes from this sheet. */
  packSlots: integer('pack_slots').notNull().default(1),
  layout: jsonb('layout').$type<TcgSheetLayout>().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
  /** R — impressions printed, derived and frozen at commit. */
  impressions: integer('impressions'),
  cursor: integer('cursor').notNull().default(0),
  cursorLimit: integer('cursor_limit')
}, t => [index('tcg_sheets_setId_idx').on(t.setId)])

/**
 * Pack recipe: ordered slot groups, each pulling `count` cards from one sheet
 * (`count` must equal that sheet's packSlots). One template per set+kind;
 * kind 'god' is required before commit iff godPackOneIn is set.
 */
export const tcgPackTemplate = pgTable('tcg_pack_templates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'base' | 'god'
  slots: jsonb('slots').$type<TcgPackTemplateSlot[]>().notNull().default([])
}, t => [unique('tcg_pack_templates_setId_kind_unique').on(t.setId, t.kind)])

/**
 * One row per (user, Amsterdam-day) tracking packs bought toward the global
 * daily cap. The conditional upsert on this row IS the daily-cap guard
 * (mutation-is-the-guard): `INSERT … ON CONFLICT DO UPDATE SET packs_bought =
 * packs_bought + N WHERE packs_bought + N <= cap RETURNING` — no returned row
 * means the cap is hit. Old rows are simply never touched again; no reset job
 * exists or is needed.
 */
export const tcgAllowance = pgTable('tcg_allowances', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Amsterdam-local 'YYYY-MM-DD' (see shared/utils/tcg/time.ts). */
  dateKey: text('date_key').notNull(),
  packsBought: integer('packs_bought').notNull().default(0)
}, t => [unique('tcg_allowances_user_date_unique').on(t.userId, t.dateKey)])

/**
 * One claimed Friday bundle. The insert under the (ownerId, weekKey) unique
 * constraint IS the one-claim-per-week guard: `onConflictDoNothing().returning()`
 * hands back no row for a second claim in the same window. The bundle's 36
 * packs link back via tcgPack.bundleId.
 */
export const tcgBundle = pgTable('tcg_bundles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** The opening Friday's Amsterdam dateKey (see bundleWindow). */
  weekKey: text('week_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [unique('tcg_bundles_owner_week_unique').on(t.ownerId, t.weekKey)])

/**
 * One sold pack. Contents are fully reserved at purchase — `cuts` stores the
 * exact sheet cuts drawn — so opening only reveals, never rolls. `isGod` must
 * NOT be serialized to non-admins while state is 'sealed'. Opening is
 * claim-then-reward: conditional UPDATE state 'sealed' → 'opened'.
 */
export const tcgPack = pgTable('tcg_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Set when the pack was sold as part of a Friday bundle; null for loose packs. */
  bundleId: text('bundle_id').references(() => tcgBundle.id, { onDelete: 'set null' }),
  /** 0-based sell-order index within the set — feeds the god permutation. */
  packIndex: integer('pack_index').notNull(),
  isGod: boolean('is_god').notNull().default(false),
  cuts: jsonb('cuts').$type<TcgPackCut[]>().notNull(),
  state: text('state').notNull().default('sealed'), // 'sealed' | 'opened'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  openedAt: timestamp('opened_at')
}, t => [
  index('tcg_packs_ownerId_idx').on(t.ownerId),
  index('tcg_packs_bundleId_idx').on(t.bundleId),
  unique('tcg_packs_setId_packIndex_unique').on(t.setId, t.packIndex)
])

/**
 * One physical copy pulled from a pack. (sheetId, cutIndex, slotOffset) is the
 * copy's serial provenance — globally unique, so every copy is traceable to
 * the exact sheet slot it was cut from. `lifecycle` vocabulary reserved:
 * 'raw' | 'slabbed' | 'sealed' | 'destroyed' (only 'raw' is used in slice 1).
 * `condition` is rolled at mint (openPack) and immutable from then on (§6.1);
 * it must NEVER be serialized to any client — no endpoint may select it into
 * a payload. Nullable only because pre-slice-3 copies predate the column.
 */
export const tcgCopy = pgTable('tcg_copies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  printingId: text('printing_id').notNull().references(() => tcgPrinting.id, { onDelete: 'cascade' }),
  setId: text('set_id').notNull().references(() => tcgSet.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull().references(() => tcgPack.id, { onDelete: 'cascade' }),
  sheetId: text('sheet_id').notNull().references(() => tcgSheet.id, { onDelete: 'cascade' }),
  cutIndex: integer('cut_index').notNull(),
  slotOffset: integer('slot_offset').notNull(),
  lifecycle: text('lifecycle').notNull().default('raw'),
  condition: jsonb('condition').$type<TcgCondition>(),
  // Grading result (§6.4) — set when lifecycle is 'slabbed', cleared by a
  // crack. `grade` is text ('9.5') because it is an identity in popKey, not a
  // number to sum. What is populated depends on the service's report tier:
  // PSI grade only; CCC/BRK gradeSubs (4); GAG gradeSubs (8) + score + flaws.
  gradeService: text('grade_service'),
  grade: text('grade'),
  gradeScore: integer('grade_score'),
  gradeDesignation: text('grade_designation'),
  gradeSubs: jsonb('grade_subs').$type<Record<string, number>>(),
  gradeFlaws: jsonb('grade_flaws').$type<Array<{ id: string, category: number, severity: number }>>(),
  certNumber: text('cert_number').unique(),
  gradedAt: timestamp('graded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [
  index('tcg_copies_ownerId_idx').on(t.ownerId),
  index('tcg_copies_printingId_idx').on(t.printingId),
  unique('tcg_copies_serial_unique').on(t.sheetId, t.cutIndex, t.slotOffset)
])

/**
 * A grading submission (§6.4): the fee is debited on submit, the copy's
 * lifecycle claim (raw → grading) is the double-submit guard, and the grade
 * is computed at collection time — the wait is part of the design. The
 * player's own predicted grade is recorded for §6.3's lossiness telemetry.
 */
export const tcgSubmission = pgTable('tcg_submissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  copyId: text('copy_id').notNull().references(() => tcgCopy.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  /** Coins paid on submission. */
  fee: numeric('fee', { precision: 19, scale: 4 }).notNull(),
  predictedGrade: text('predicted_grade'),
  state: text('state').notNull().default('pending'),
  /** Immutable result snapshot; the copy may later be cracked or regraded. */
  gradeResult: jsonb('grade_result').$type<TcgGradeResult>(),
  certNumber: text('cert_number'),
  gradedAt: timestamp('graded_at'),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  returnsAt: timestamp('returns_at').notNull()
}, t => [
  index('tcg_submissions_userId_idx').on(t.userId),
  index('tcg_submissions_copyId_idx').on(t.copyId)
])

/**
 * A fixed-price market listing (§7.1). The partial unique index (created in
 * SQL: one active listing per copy) plus the copy row lock in the engine are
 * the concurrency guards. Sold rows ARE the sales history — the grade fields
 * are snapshotted at sale time because the copy can be cracked afterwards
 * and history must not mutate. The fee is 5%, burned: the buyer pays price,
 * the seller receives 95%, and nothing is pooled — NEVER route the fee
 * through accumulateRake (§7.6).
 */
export const tcgListing = pgTable('tcg_listings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  copyId: text('copy_id').notNull().references(() => tcgCopy.id, { onDelete: 'cascade' }),
  sellerId: text('seller_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  price: numeric('price', { precision: 19, scale: 4 }).notNull(),
  /** Seller's free-text condition claim — carries no authority (§7.1). */
  note: text('note'),
  state: text('state').notNull().default('active'), // 'active' | 'sold' | 'cancelled'
  buyerId: text('buyer_id').references(() => user.id, { onDelete: 'set null' }),
  soldGradeService: text('sold_grade_service'),
  soldGrade: text('sold_grade'),
  soldDesignation: text('sold_designation'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  soldAt: timestamp('sold_at')
}, t => [
  index('tcg_listings_copyId_idx').on(t.copyId),
  index('tcg_listings_sellerId_idx').on(t.sellerId),
  index('tcg_listings_state_idx').on(t.state)
])

/**
 * The ownership chain (§11.3) — every transfer travels with the copy and is
 * public. The mint entry is synthesized from the copy's pack (owner + opened
 * time), so only transfers are stored.
 */
export const tcgCopyTransfer = pgTable('tcg_copy_transfers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  copyId: text('copy_id').notNull().references(() => tcgCopy.id, { onDelete: 'cascade' }),
  fromUserId: text('from_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  toUserId: text('to_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'sale'
  price: numeric('price', { precision: 19, scale: 4 }),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [
  index('tcg_copy_transfers_copyId_idx').on(t.copyId)
])

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  user: one(user, { fields: [chatMessages.userId], references: [user.id] })
}))

export const chatMentionsRelations = relations(chatMentions, ({ one }) => ({
  message: one(chatMessages, { fields: [chatMentions.messageId], references: [chatMessages.id] }),
  user: one(user, { fields: [chatMentions.userId], references: [user.id] })
}))

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, { fields: [transactions.userId], references: [user.id] })
}))

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  transactions: many(transactions),
  minerState: one(minerState),
  pirateState: one(pirateState),
  pirateCannons: many(pirateCannons),
  pirateRunHistory: many(pirateRunHistory),
  shapezzState: one(shapezzState),
  pathwardenState: one(pathwardenState),
  firewallState: one(firewallState)
}))

export const minerStateRelations = relations(minerState, ({ one }) => ({
  user: one(user, { fields: [minerState.userId], references: [user.id] })
}))

export const pirateStateRelations = relations(pirateState, ({ one }) => ({
  user: one(user, { fields: [pirateState.userId], references: [user.id] })
}))

export const pirateCannonsRelations = relations(pirateCannons, ({ one }) => ({
  user: one(user, { fields: [pirateCannons.userId], references: [user.id] })
}))

export const pirateRunHistoryRelations = relations(pirateRunHistory, ({ one }) => ({
  user: one(user, { fields: [pirateRunHistory.userId], references: [user.id] })
}))

export const shapezzStateRelations = relations(shapezzState, ({ one }) => ({
  user: one(user, { fields: [shapezzState.userId], references: [user.id] })
}))

export const pathwardenStateRelations = relations(pathwardenState, ({ one }) => ({
  user: one(user, { fields: [pathwardenState.userId], references: [user.id] })
}))

export const firewallStateRelations = relations(firewallState, ({ one }) => ({
  user: one(user, { fields: [firewallState.userId], references: [user.id] })
}))

export const firewallRunsRelations = relations(firewallRuns, ({ one }) => ({
  user: one(user, { fields: [firewallRuns.userId], references: [user.id] })
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id]
  })
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id]
  })
}))
