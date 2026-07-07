import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, index, numeric, integer, unique, jsonb } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
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
  table => [index('transactions_userId_idx').on(table.userId)]
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
  itemLevel: integer('item_level').notNull(),
  rarity: text('rarity').notNull(),
  mods: jsonb('mods').notNull().default([]),
  equippedBy: text('equipped_by'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, t => [index('hack_items_userId_idx').on(t.userId)])

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
  minerState: one(minerState)
}))

export const minerStateRelations = relations(minerState, ({ one }) => ({
  user: one(user, { fields: [minerState.userId], references: [user.id] })
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
