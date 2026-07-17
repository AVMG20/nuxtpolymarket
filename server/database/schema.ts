import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, index, numeric, integer, unique, jsonb } from 'drizzle-orm/pg-core'

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
  gems: integer('gems').notNull().default(0),
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
  // Set when a voyage starts, cleared on finish. Server computes elapsed time
  // from this instead of trusting the client, and snapshots the power level
  // so mid-run upgrades can't raise the finish-run payout ceiling.
  runStartedAt: timestamp('run_started_at'),
  runPowerSnapshot: integer('run_power_snapshot'),
  runDifficultySnapshot: integer('run_difficulty_snapshot'),
  // Only full six-minute clears advance this value. Difficulty 0 is the
  // universal starting tier, so -50 means a new captain has no clear yet.
  highestCompletedDifficulty: integer('highest_completed_difficulty').notNull().default(-50),
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
}, t => [
  index('pirate_cannons_userId_idx').on(t.userId),
  unique('pirate_cannons_slot_unique').on(t.userId, t.slotIndex)
])

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
  weaponType: text('weapon_type').notNull().default('blaster'), // equipped weapon type
  blasterRarity: text('blaster_rarity').notNull().default('common'),
  blasterPurchasePrice: integer('blaster_purchase_price').notNull().default(0),
  launcherRarity: text('launcher_rarity'), // null = not owned
  launcherPurchasePrice: integer('launcher_purchase_price').notNull().default(0),
  shotgunRarity: text('shotgun_rarity'), // null = not owned
  shotgunPurchasePrice: integer('shotgun_purchase_price').notNull().default(0),
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

export const gemMarketState = pgTable('gem_market_state', {
  id: text('id').primaryKey(), // always 'market'
  price: numeric('price', { precision: 19, scale: 8 }).notNull(),
  lastUpdatedAt: timestamp('last_updated_at').defaultNow().notNull()
})

export const gemPriceHistory = pgTable('gem_price_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  price: numeric('price', { precision: 19, scale: 8 }).notNull(),
  action: text('action').notNull(), // 'buy' | 'sell' | 'init'
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  gems: integer('gems').notNull().default(0),
  totalAmount: numeric('total_amount', { precision: 19, scale: 4 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('gem_price_history_created_at_idx').on(t.createdAt)])

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
  lastSettledAt: timestamp('last_settled_at').defaultNow().notNull()
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

export const blackjackSessions = pgTable('blackjack_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull(),
  bet: numeric('bet', { precision: 19, scale: 4 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull()
})

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
}, t => [
  index('xeno_plants_unlocked_userId_idx').on(t.userId),
  unique('xeno_plants_unlocked_unique').on(t.userId, t.typeId)
])

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
}, t => [
  index('xeno_grid_userId_idx').on(t.userId),
  unique('xeno_grid_slot_unique').on(t.userId, t.slotIndex)
])

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
}, t => [
  index('xeno_breeder_userId_idx').on(t.userId),
  unique('xeno_breeder_slot_unique').on(t.userId, t.slotIndex)
])

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
  lastSettledAt: timestamp('last_settled_at').defaultNow().notNull(),
  /** The single builder's current job, if any — cleared on collect. */
  builderTrackId: text('builder_track_id'),
  builderStartedAt: timestamp('builder_started_at')
})

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
  unique('colony_loot_unique').on(t.userId, t.itemTypeId)
])

/** Claimed item inventory — spendable in the market and toward item-gated upgrades. */
export const colonyItems = pgTable('colony_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  itemTypeId: text('item_type_id').notNull(),
  quantity: integer('quantity').notNull().default(0)
}, t => [
  index('colony_items_userId_idx').on(t.userId),
  unique('colony_items_unique').on(t.userId, t.itemTypeId)
])

/** Leveled builder upgrade tracks (capacity, yield, speed, nutrition storage/efficiency). One row per track. */
export const colonyUpgrades = pgTable('colony_upgrades', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  trackId: text('track_id').notNull(),
  level: integer('level').notNull().default(0)
}, t => [
  index('colony_upgrades_userId_idx').on(t.userId),
  unique('colony_upgrades_unique').on(t.userId, t.trackId)
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
  unique('colony_bug_research_unique').on(t.userId, t.typeId)
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
}, t => [
  index('hack_artifacts_userId_idx').on(t.userId),
  unique('hack_artifacts_user_type_rarity').on(t.userId, t.traitType, t.rarity)
])

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
  shapezzState: one(shapezzState)
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

export const gemPriceHistoryRelations = relations(gemPriceHistory, ({ one }) => ({
  user: one(user, { fields: [gemPriceHistory.userId], references: [user.id] })
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
