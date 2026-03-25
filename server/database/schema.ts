import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, numeric, integer, jsonb } from "drizzle-orm/pg-core";


export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  balance: numeric("balance", { precision: 19, scale: 4 }).notNull().default("0"),
  gems: integer("gems").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
    type: text("type").notNull(),
    category: text("category"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("transactions_userId_idx").on(table.userId)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const minerState = pgTable('miner_state', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  rigLevel: integer('rig_level').notNull().default(1),
  vaultLevel: integer('vault_level').notNull().default(1),
  lastCollectedAt: timestamp('last_collected_at').defaultNow().notNull(),
  factoryLevel: integer('factory_level').notNull().default(1),
  factoryLastCollectedAt: timestamp('factory_last_collected_at').defaultNow().notNull(),
  minesCount: integer('mines_count').notNull().default(1),
  minesTodayPlays: integer('mines_today_plays').notNull().default(0),
  minesPlaysDate: text('mines_plays_date').notNull().default(''),
})

export const gemMarketState = pgTable('gem_market_state', {
    id: text('id').primaryKey(), // always 'market'
    price: numeric('price', { precision: 19, scale: 8 }).notNull(),
    lastUpdatedAt: timestamp('last_updated_at').defaultNow().notNull(),
})

export const gemPriceHistory = pgTable('gem_price_history', {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    price: numeric('price', { precision: 19, scale: 8 }).notNull(),
    action: text('action').notNull(), // 'buy' | 'sell' | 'init'
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    gems: integer('gems').notNull().default(0),
    totalAmount: numeric('total_amount', { precision: 19, scale: 4 }).notNull().default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('gem_price_history_created_at_idx').on(t.createdAt)])


export const blackjackSessions = pgTable('blackjack_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull(),
  bet: numeric('bet', { precision: 19, scale: 4 }).notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
})

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(user, { fields: [transactions.userId], references: [user.id] }),
}));

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  transactions: many(transactions),
  minerState: one(minerState),
}));

export const minerStateRelations = relations(minerState, ({ one }) => ({
  user: one(user, { fields: [minerState.userId], references: [user.id] }),
}))

export const gemPriceHistoryRelations = relations(gemPriceHistory, ({ one }) => ({
  user: one(user, { fields: [gemPriceHistory.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
