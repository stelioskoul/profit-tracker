import {
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);
export const operationalExpenseType = pgEnum("operational_expense_type", [
  "one_time",
  "monthly",
  "yearly",
]);

/**
 * Core user table backing the existing Express email/password auth flow.
 * This is intentionally not linked to Supabase Auth.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: text("passwordHash"),
  name: text("name"),
  loginMethod: varchar("loginMethod", { length: 64 }).default("email"),
  role: userRole("role").default("user").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Stores - each user can have multiple e-commerce stores.
 */
export const stores = pgTable(
  "stores",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 50 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    timezone: varchar("timezone", { length: 50 }).default("America/New_York"),
    timezoneOffset: integer("timezoneOffset").default(-300),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [index("stores_userId_idx").on(table.userId)]
);

export type Store = typeof stores.$inferSelect;
export type InsertStore = typeof stores.$inferInsert;

/**
 * Shopify OAuth connections.
 */
export const shopifyConnections = pgTable("shopify_connections", {
  id: serial("id").primaryKey(),
  storeId: integer("storeId")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  shopDomain: varchar("shopDomain", { length: 255 }).notNull(),
  accessToken: text("accessToken").notNull(),
  scopes: text("scopes"),
  apiVersion: varchar("apiVersion", { length: 20 }).default("2026-07"),
  connectedAt: timestamp("connectedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSyncAt: timestamp("lastSyncAt", { withTimezone: true }),
});

export type ShopifyConnection = typeof shopifyConnections.$inferSelect;
export type InsertShopifyConnection = typeof shopifyConnections.$inferInsert;

/**
 * Facebook Ad Account connections.
 */
export const facebookConnections = pgTable(
  "facebook_connections",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    adAccountId: varchar("adAccountId", { length: 255 }).notNull(),
    adAccountName: varchar("adAccountName", { length: 255 }),
    tokenType: varchar("tokenType", { length: 32 }),
    accessToken: text("accessToken").notNull(),
    tokenExpiresAt: timestamp("tokenExpiresAt", { withTimezone: true }),
    apiVersion: varchar("apiVersion", { length: 20 }).default("v25.0"),
    timezoneOffset: integer("timezoneOffset").default(-300),
    connectedAt: timestamp("connectedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSyncAt: timestamp("lastSyncAt", { withTimezone: true }),
  },
  table => [
    unique("facebook_connections_storeId_adAccountId_unique").on(
      table.storeId,
      table.adAccountId
    ),
  ]
);

export type FacebookConnection = typeof facebookConnections.$inferSelect;
export type InsertFacebookConnection = typeof facebookConnections.$inferInsert;

/**
 * COGS (Cost of Goods Sold) configuration per store variant.
 */
export const cogsConfig = pgTable(
  "cogs_config",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    variantId: varchar("variantId", { length: 255 }).notNull(),
    productTitle: text("productTitle"),
    cogsValue: numeric("cogsValue", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    unique("cogs_config_storeId_variantId_unique").on(
      table.storeId,
      table.variantId
    ),
  ]
);

export type CogsConfig = typeof cogsConfig.$inferSelect;
export type InsertCogsConfig = typeof cogsConfig.$inferInsert;

/**
 * Shipping cost configuration per store and product variant.
 */
export const shippingConfig = pgTable(
  "shipping_config",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    variantId: varchar("variantId", { length: 255 }).notNull(),
    productTitle: text("productTitle"),
    configJson: text("configJson").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    unique("shipping_config_storeId_variantId_unique").on(
      table.storeId,
      table.variantId
    ),
  ]
);

export type ShippingConfig = typeof shippingConfig.$inferSelect;
export type InsertShippingConfig = typeof shippingConfig.$inferInsert;

/**
 * Operational expenses per store.
 */
export const operationalExpenses = pgTable(
  "operational_expenses",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    type: operationalExpenseType("type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    date: date("date", { mode: "date" }),
    startDate: date("startDate", { mode: "date" }),
    endDate: date("endDate", { mode: "date" }),
    isActive: integer("isActive").default(1),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [index("operational_expenses_storeId_idx").on(table.storeId)]
);

export type OperationalExpense = typeof operationalExpenses.$inferSelect;
export type InsertOperationalExpense = typeof operationalExpenses.$inferInsert;

/**
 * Payment processing fee configuration per store.
 */
export const processingFeesConfig = pgTable("processing_fees_config", {
  id: serial("id").primaryKey(),
  storeId: integer("storeId")
    .notNull()
    .unique()
    .references(() => stores.id, { onDelete: "cascade" }),
  percentFee: numeric("percentFee", { precision: 5, scale: 4 }).default(
    "0.0280"
  ),
  fixedFee: numeric("fixedFee", { precision: 10, scale: 2 }).default("0.29"),
  currency: varchar("currency", { length: 3 }).default("USD"),
  createdAt: timestamp("createdAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type ProcessingFeesConfig = typeof processingFeesConfig.$inferSelect;
export type InsertProcessingFeesConfig =
  typeof processingFeesConfig.$inferInsert;

/**
 * Currency exchange rates.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    fromCurrency: varchar("fromCurrency", { length: 3 }).notNull(),
    toCurrency: varchar("toCurrency", { length: 3 }).notNull(),
    rate: numeric("rate", { precision: 10, scale: 6 }).notNull(),
    effectiveDate: date("effectiveDate", { mode: "date" }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    unique("exchange_rates_fromCurrency_toCurrency_effectiveDate_unique").on(
      table.fromCurrency,
      table.toCurrency,
      table.effectiveDate
    ),
  ]
);

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type InsertExchangeRate = typeof exchangeRates.$inferInsert;

/**
 * Reusable shipping configuration templates.
 */
export const shippingProfiles = pgTable(
  "shipping_profiles",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    configJson: text("configJson").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    // Required as the target key for productShippingProfiles' tenant-safe composite FK.
    unique("shipping_profiles_storeId_id_unique").on(table.storeId, table.id),
    index("shipping_profiles_storeId_idx").on(table.storeId),
  ]
);

export type ShippingProfile = typeof shippingProfiles.$inferSelect;
export type InsertShippingProfile = typeof shippingProfiles.$inferInsert;

/**
 * Junction table linking product variants to shipping profiles.
 */
export const productShippingProfiles = pgTable(
  "product_shipping_profiles",
  {
    id: serial("id").primaryKey(),
    storeId: integer("storeId")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    variantId: varchar("variantId", { length: 255 }).notNull(),
    profileId: integer("profileId").notNull(),
    productTitle: text("productTitle"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  table => [
    unique("product_shipping_profiles_storeId_variantId_unique").on(
      table.storeId,
      table.variantId
    ),
    index("product_shipping_profiles_storeId_profileId_idx").on(
      table.storeId,
      table.profileId
    ),
    foreignKey({
      columns: [table.storeId, table.profileId],
      foreignColumns: [shippingProfiles.storeId, shippingProfiles.id],
      name: "product_shipping_profiles_storeId_profileId_shipping_profiles_fk",
    }).onDelete("cascade"),
  ]
);

export type ProductShippingProfile =
  typeof productShippingProfiles.$inferSelect;
export type InsertProductShippingProfile =
  typeof productShippingProfiles.$inferInsert;
