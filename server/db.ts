import { eq, and, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { 
  InsertUser, 
  users,
  stores,
  InsertStore,
  shopifyConnections,
  InsertShopifyConnection,
  facebookConnections,
  InsertFacebookConnection,
  cogsConfig,
  InsertCogsConfig,
  shippingConfig,
  InsertShippingConfig,
  shippingProfiles,
  InsertShippingProfile,
  productShippingProfiles,
  InsertProductShippingProfile,
  operationalExpenses,
  InsertOperationalExpense,
  processingFeesConfig,
  InsertProcessingFeesConfig,
} from "../drizzle/schema";
import { decryptToken, encryptToken } from "./token-crypto";
import { getConfiguredShopifyToken } from "./shopify-client-credentials";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;
let didWarnAboutMissingDatabase = false;

// Lazily create the PostgreSQL client so commands that do not use the database
// (for example local type checking) do not require DATABASE_URL.
export async function getDb() {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (!didWarnAboutMissingDatabase) {
      console.warn("[Database] DATABASE_URL is not configured");
      didWarnAboutMissingDatabase = true;
    }
    return null;
  }

  try {
    _client = postgres(connectionString, { max: 5, ssl: "require" });
    _db = drizzle(_client);
    return _db;
  } catch {
    // Do not log connection details, which may contain the DATABASE_URL.
    console.error("[Database] Failed to initialize PostgreSQL client");
    return null;
  }
}

export async function closeDb() {
  const client = _client;
  _db = null;
  _client = null;
  if (client) await client.end({ timeout: 5 });
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.email) {
    throw new Error("User email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      email: user.email,
    };
    const updateSet: Record<string, unknown> = {};

    // Handle optional fields
    if (user.openId !== undefined) {
      values.openId = user.openId ?? null;
      updateSet.openId = user.openId ?? null;
    }
    if (user.name !== undefined) {
      values.name = user.name ?? null;
      updateSet.name = user.name ?? null;
    }
    if (user.loginMethod !== undefined) {
      values.loginMethod = user.loginMethod ?? null;
      updateSet.loginMethod = user.loginMethod ?? null;
    }
    if (user.passwordHash !== undefined) {
      values.passwordHash = user.passwordHash ?? null;
      updateSet.passwordHash = user.passwordHash ?? null;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    // Role changes are an admin-only action. Never copy a role provided by a
    // login or OAuth payload into either a new or existing account.

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.email,
      set: updateSet,
    });
  } catch (error) {
    // SQL errors can contain values such as password hashes; never log them.
    console.error("[Database] Failed to upsert user");
    throw error;
  }
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================================================
// STORE OPERATIONS
// ============================================================================

export async function createStore(store: InsertStore) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(stores).values(store).returning({ id: stores.id });
  const insertedStore = result[0];
  if (!insertedStore) throw new Error("Failed to create store");
  return insertedStore;
}

export async function getStoresByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(stores).where(eq(stores.userId, userId));
}

export async function getStoreById(storeId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateStore(storeId: number, updates: Partial<InsertStore>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(stores).set(updates).where(eq(stores.id, storeId));
}

export async function deleteStore(storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(stores).where(eq(stores.id, storeId));
}

export async function getAllStores() {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(stores);
}

// ============================================================================
// SHOPIFY CONNECTION OPERATIONS
// ============================================================================

export async function upsertShopifyConnection(connection: InsertShopifyConnection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // encryptToken throws before this query when TOKEN_ENCRYPTION_KEY is missing
  // or invalid, so provider credentials are never persisted in plaintext.
  const accessToken = encryptToken(connection.accessToken);

  await db.insert(shopifyConnections).values({ ...connection, accessToken }).onConflictDoUpdate({
    target: shopifyConnections.storeId,
    set: {
      shopDomain: connection.shopDomain,
      accessToken,
      scopes: connection.scopes,
      apiVersion: connection.apiVersion,
      connectedAt: new Date(),
    },
  });
}

export async function getShopifyConnectionByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select({ ...getTableColumns(shopifyConnections), ownerId: stores.userId })
    .from(shopifyConnections).innerJoin(stores, eq(stores.id, shopifyConnections.storeId))
    .where(eq(shopifyConnections.storeId, storeId)).limit(1);
  if (!result[0]) return undefined;
  const { ownerId, ...connection } = result[0];
  const renewed = await getConfiguredShopifyToken(connection.shopDomain, ownerId);
  return { ...connection, accessToken: renewed?.accessToken ?? decryptToken(connection.accessToken), scopes: renewed?.scopes ?? connection.scopes };
}

export async function deleteShopifyConnection(storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(shopifyConnections).where(eq(shopifyConnections.storeId, storeId));
}

// ============================================================================
// FACEBOOK CONNECTION OPERATIONS
// ============================================================================

export async function upsertFacebookConnection(connection: InsertFacebookConnection) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // encryptToken throws before this query when TOKEN_ENCRYPTION_KEY is missing
  // or invalid, so provider credentials are never persisted in plaintext.
  const accessToken = encryptToken(connection.accessToken);

  await db.insert(facebookConnections).values({ ...connection, accessToken }).onConflictDoUpdate({
    target: [facebookConnections.storeId, facebookConnections.adAccountId],
    set: {
      accessToken,
      tokenExpiresAt: connection.tokenExpiresAt,
      adAccountName: connection.adAccountName,
      tokenType: connection.tokenType,
      apiVersion: connection.apiVersion,
      timezoneOffset: connection.timezoneOffset,
      connectedAt: new Date(),
    },
  });
}

export async function getFacebookConnectionsByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  const connections = await db.select().from(facebookConnections).where(eq(facebookConnections.storeId, storeId));
  return connections.map((connection) => ({
    ...connection,
    accessToken: decryptToken(connection.accessToken),
  }));
}

export async function getFacebookConnectionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: facebookConnections.id, storeId: stores.id, storeName: stores.name,
    adAccountId: facebookConnections.adAccountId, adAccountName: facebookConnections.adAccountName,
    tokenExpiresAt: facebookConnections.tokenExpiresAt, tokenType: facebookConnections.tokenType })
    .from(facebookConnections).innerJoin(stores, eq(facebookConnections.storeId, stores.id)).where(eq(stores.userId, userId));
}

export async function getFacebookConnectionById(connectionId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(facebookConnections).where(eq(facebookConnections.id, connectionId)).limit(1);
  const connection = result[0];
  return connection ? { ...connection, accessToken: decryptToken(connection.accessToken) } : undefined;
}

export async function deleteFacebookConnection(connectionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(facebookConnections).where(eq(facebookConnections.id, connectionId));
}

// ============================================================================
// COGS CONFIG OPERATIONS
// ============================================================================

export async function upsertCogsConfig(config: InsertCogsConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(cogsConfig).values(config).onConflictDoUpdate({
    target: [cogsConfig.storeId, cogsConfig.variantId],
    set: {
      cogsValue: config.cogsValue,
      productTitle: config.productTitle,
      currency: config.currency,
    },
  });
}

export async function getCogsConfigByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(cogsConfig).where(eq(cogsConfig.storeId, storeId));
}

export async function deleteCogsConfig(configId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(cogsConfig).where(eq(cogsConfig.id, configId));
}

// ============================================================================
// SHIPPING CONFIG OPERATIONS
// ============================================================================

export async function upsertShippingConfig(config: InsertShippingConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(shippingConfig).values(config).onConflictDoUpdate({
    target: [shippingConfig.storeId, shippingConfig.variantId],
    set: {
      configJson: config.configJson,
      productTitle: config.productTitle,
    },
  });
}

export async function getShippingConfigByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  // First get direct shipping configs (old method)
  const directConfigs = await db.select().from(shippingConfig).where(eq(shippingConfig.storeId, storeId));
  
  // Then get shipping configs from assigned profiles (new method)
  // JOIN product_shipping_profiles with shipping_profiles to get the config for each variant
  const profileConfigs = await db
    .select({
      id: productShippingProfiles.id,
      storeId: productShippingProfiles.storeId,
      variantId: productShippingProfiles.variantId,
      profileId: shippingProfiles.id,
      productTitle: productShippingProfiles.productTitle,
      configJson: shippingProfiles.configJson,
      createdAt: productShippingProfiles.createdAt,
      updatedAt: productShippingProfiles.updatedAt,
    })
    .from(productShippingProfiles)
    .innerJoin(shippingProfiles, and(
      eq(productShippingProfiles.profileId, shippingProfiles.id),
      eq(productShippingProfiles.storeId, shippingProfiles.storeId),
    ))
    .where(eq(productShippingProfiles.storeId, storeId));
  
  // Combine both sources (profile configs take precedence over direct configs)
  const variantMap = new Map<string, any>();
  
  // Add direct configs first
  for (const config of directConfigs) {
    variantMap.set(config.variantId, config);
  }
  
  // Override with profile configs (newer method)
  for (const config of profileConfigs) {
    variantMap.set(config.variantId, config);
  }
  
  return Array.from(variantMap.values());
}

export async function deleteShippingConfig(configId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(shippingConfig).where(eq(shippingConfig.id, configId));
}

// ============================================================================
// OPERATIONAL EXPENSES OPERATIONS
// ============================================================================

export async function createOperationalExpense(expense: InsertOperationalExpense) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(operationalExpenses).values(expense);
  return result;
}

export async function getOperationalExpensesByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(operationalExpenses).where(eq(operationalExpenses.storeId, storeId));
}

export async function getOperationalExpenseById(expenseId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(operationalExpenses).where(eq(operationalExpenses.id, expenseId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateOperationalExpense(expenseId: number, updates: Partial<InsertOperationalExpense>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(operationalExpenses)
    .set(updates)
    .where(eq(operationalExpenses.id, expenseId));
}

export async function deleteOperationalExpense(expenseId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(operationalExpenses).where(eq(operationalExpenses.id, expenseId));
}

// ============================================================================
// PROCESSING FEES CONFIG OPERATIONS
// ============================================================================

export async function upsertProcessingFeesConfig(config: InsertProcessingFeesConfig) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(processingFeesConfig).values(config).onConflictDoUpdate({
    target: processingFeesConfig.storeId,
    set: {
      percentFee: config.percentFee,
      fixedFee: config.fixedFee,
      currency: config.currency,
    },
  });
}

export async function getProcessingFeesConfigByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(processingFeesConfig).where(eq(processingFeesConfig.storeId, storeId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================================
// SHIPPING PROFILES OPERATIONS
// ============================================================================

export async function createShippingProfile(profile: InsertShippingProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(shippingProfiles).values(profile);
  return result;
}

export async function getShippingProfilesByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(shippingProfiles).where(eq(shippingProfiles.storeId, storeId));
}

export async function getShippingProfileById(profileId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(shippingProfiles).where(eq(shippingProfiles.id, profileId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateShippingProfile(profileId: number, updates: Partial<InsertShippingProfile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(shippingProfiles).set(updates).where(eq(shippingProfiles.id, profileId));
}

export async function deleteShippingProfile(profileId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete all product assignments first
  await db.delete(productShippingProfiles).where(eq(productShippingProfiles.profileId, profileId));
  // Then delete the profile
  await db.delete(shippingProfiles).where(eq(shippingProfiles.id, profileId));
}

// ============================================================================
// PRODUCT SHIPPING PROFILES OPERATIONS
// ============================================================================

export async function assignShippingProfile(assignment: InsertProductShippingProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(productShippingProfiles).values(assignment).onConflictDoUpdate({
    target: [productShippingProfiles.storeId, productShippingProfiles.variantId],
    set: {
      profileId: assignment.profileId,
      productTitle: assignment.productTitle,
    },
  });
}

export async function getProductShippingProfilesByStoreId(storeId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db.select().from(productShippingProfiles).where(eq(productShippingProfiles.storeId, storeId));
}

export async function getProductShippingProfileByVariant(storeId: number, variantId: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select()
    .from(productShippingProfiles)
    .where(
      and(
        eq(productShippingProfiles.storeId, storeId),
        eq(productShippingProfiles.variantId, variantId)
      )
    )
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function removeProductShippingProfile(storeId: number, variantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(productShippingProfiles).where(
    and(
      eq(productShippingProfiles.storeId, storeId),
      eq(productShippingProfiles.variantId, variantId)
    )
  );
}
