import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { getShopifyAuthUrl, normalizeShopDomain, verifyShopifyFinancialAccess } from "./shopify-oauth";
import { configuredShopifyStoresForUser, getConfiguredShopifyToken } from "./shopify-client-credentials";
import { getFacebookAuthUrl, prepareFacebookToken, getFacebookAdAccounts, verifyFacebookAdAccount, FACEBOOK_API_VERSION } from "./facebook-oauth";
import { readPendingFacebookToken, clearPendingFacebookToken } from "./facebook-pending";
import { createOAuthState } from "./oauth-state";
import { fetchShopifyOrders, fetchShopifyDisputes, fetchShopifyBalanceTransactions, type DisputeSummary } from "./shopify-data";
import { fetchFacebookAdSpend } from "./facebook-data";
import { processOrders, calculateOperationalExpensesForPeriod } from "./profit-calculator";
import { calculateProfitBreakdown } from "./profit-formula";
import { referenceUtcOffsetMinutes, validateDateRange } from "./shopify-date";
import { assertOrderHistoryAccess } from "./shopify-order-access";
import { getEurUsdRate, getCachedRate } from "./exchange-rate";
import { adminRouter } from "./admin-router";

async function saveVerifiedFacebookConnection(storeId: number, accessToken: string, adAccountId: string) {
  const token = await prepareFacebookToken(accessToken);
  const account = await verifyFacebookAdAccount(token.accessToken, adAccountId);
  const offset = account.timezone_offset_hours_utc;
  if (offset !== undefined && (typeof offset !== "number" || !Number.isFinite(offset))) throw new Error("Facebook returned an invalid account timezone offset.");
  await db.upsertFacebookConnection({
    storeId, adAccountId: account.id, adAccountName: account.name, accessToken: token.accessToken,
    tokenType: token.type, tokenExpiresAt: token.expiresAt, apiVersion: FACEBOOK_API_VERSION,
    timezoneOffset: offset === undefined ? null : Math.round(offset * 60),
  });
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  admin: adminRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => {
      if (!ctx.user) return null;
      const { passwordHash: _passwordHash, ...safeUser } = ctx.user;
      return safeUser;
    }),
    
    signup: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(8),
          name: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { hashPassword, validatePassword, validateEmail } = await import("./auth-utils");
        const { getUserByEmail, createUser } = await import("./db-auth");

        // Validate input
        const emailError = validateEmail(input.email);
        if (emailError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: emailError });
        }

        const passwordError = validatePassword(input.password);
        if (passwordError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
        }

        // Check if user already exists
        const existingUser = await getUserByEmail(input.email.toLowerCase());
        if (existingUser) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Email already registered",
          });
        }

        // Hash password and create user
        const passwordHash = await hashPassword(input.password);
        await createUser({
          email: input.email.toLowerCase(),
          passwordHash,
          name: input.name || null,
          loginMethod: "email",
          lastSignedIn: new Date(),
        });

        // Get the created user
        const user = await getUserByEmail(input.email.toLowerCase());
        if (!user) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create user",
          });
        }

        // Create session token
        const { sdk } = await import("./_core/sdk");
        const sessionToken = await sdk.createSessionToken(user.id.toString(), {
          name: user.name || "",
          expiresInMs: 7 * 24 * 60 * 60 * 1000,
        });

        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        };
      }),

    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { verifyPassword } = await import("./auth-utils");
        const { getUserByEmail } = await import("./db-auth");

        // Get user by email
        const user = await getUserByEmail(input.email.toLowerCase());
        if (!user || !user.passwordHash) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        // Verify password
        const isValid = await verifyPassword(input.password, user.passwordHash);
        if (!isValid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }

        // Update last signed in
        await db.upsertUser({
          email: user.email,
          lastSignedIn: new Date(),
        });

        // Create session token
        const { sdk } = await import("./_core/sdk");
        const sessionToken = await sdk.createSessionToken(user.id.toString(), {
          name: user.name || "",
          expiresInMs: 7 * 24 * 60 * 60 * 1000,
        });

        // Set session cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  exchangeRate: router({
    getCurrent: publicProcedure.query(async () => {
      const rate = await getEurUsdRate();
      const cached = getCachedRate();
      return {
        rate,
        expiresAt: cached?.expiresAt || null,
      };
    }),
  }),

  stores: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await db.getStoresByUserId(ctx.user.id);
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.id);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }
        return store;
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          platform: z.string().default("shopify"),
          currency: z.string().default("USD"),
          timezone: z.string().default("America/New_York"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        let timezoneOffset: number;
        try {
          timezoneOffset = referenceUtcOffsetMinutes(input.timezone);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select a valid IANA timezone" });
        }

        const newStore = await db.createStore({
          userId: ctx.user.id,
          ...input,
          timezoneOffset,
        });
        if (newStore) {
          await db.upsertProcessingFeesConfig({
            storeId: newStore.id,
            percentFee: "0.0280",
            fixedFee: "0.29",
            currency: "USD",
          });
        }

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        await db.deleteStore(input.storeId);
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          timezone: z.string().optional(),
          timezoneOffset: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.id);
          if (!store || store.userId !== ctx.user.id) {
            throw new Error("Store not found or access denied");
          }

          if (input.timezoneOffset !== undefined && input.timezone === undefined) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Update the IANA timezone, not only its obsolete UTC offset" });
          }
          let timezoneOffset: number | undefined;
          if (input.timezone !== undefined) {
            try {
              timezoneOffset = referenceUtcOffsetMinutes(input.timezone);
            } catch {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Select a valid IANA timezone" });
            }
          }

          await db.updateStore(input.id, {
            name: input.name,
            timezone: input.timezone,
            timezoneOffset,
          });

        return { success: true };
      }),
  }),

  shopify: router({
    availableStores: protectedProcedure.query(({ ctx }) => configuredShopifyStoresForUser(ctx.user.id)),

    connectConfigured: protectedProcedure
      .input(z.object({ storeId: z.number(), shopDomain: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const domain = normalizeShopDomain(input.shopDomain);
        const token = await getConfiguredShopifyToken(domain, ctx.user.id);
        if (!token) throw new TRPCError({ code: "FORBIDDEN", message: "This Shopify store is not configured for your account" });
        const response = await fetch(`https://${domain}/admin/api/2026-07/shop.json`, {
          headers: { "X-Shopify-Access-Token": token.accessToken }, redirect: "error", signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Unable to verify the Shopify store" });
        const { shop } = await response.json();
        if (!shop || shop.myshopify_domain !== domain) throw new TRPCError({ code: "BAD_REQUEST", message: "Shopify store identity does not match" });
        const timezone = String(shop.iana_timezone);
        let timezoneOffset: number;
        try {
          timezoneOffset = referenceUtcOffsetMinutes(timezone);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Shopify returned an invalid store timezone" });
        }
        let grantedScopes: string;
        try {
          grantedScopes = await verifyShopifyFinancialAccess(domain, token.accessToken);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
        }
        await db.upsertShopifyConnection({ storeId: input.storeId, shopDomain: domain, accessToken: token.accessToken, scopes: grantedScopes, apiVersion: "2026-07" });
        await db.updateStore(store.id, { currency: shop.currency, timezone, timezoneOffset });
        return { success: true };
      }),

    getAuthUrl: protectedProcedure
      .input(z.object({ storeId: z.number(), shop: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const baseUrl = process.env.APP_URL || "http://localhost:3000";
        const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/oauth/shopify/callback`;
        const state = await createOAuthState("shopify", input.storeId, ctx.user.id);
        const authUrl = getShopifyAuthUrl(input.shop, state, redirectUri);
        return { authUrl };
      }),

    connectManual: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          shopDomain: z.string(),
          accessToken: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const domain = normalizeShopDomain(input.shopDomain);
        // Verify store identity as well as the specific financial capabilities
        // the profit calculation needs. A valid shop.json token alone is not enough.
        const testUrl = `https://${domain}/admin/api/2026-07/shop.json`;
        const response = await fetch(testUrl, {
          headers: {
            "X-Shopify-Access-Token": input.accessToken,
          },
        });

        if (!response.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid Shopify credentials or store domain",
          });
        }

        const shop = (await response.json()).shop;
        if (normalizeShopDomain(shop?.myshopify_domain || "") !== domain) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Shopify token belongs to a different store" });
        }
        let grantedScopes: string;
        try {
          grantedScopes = await verifyShopifyFinancialAccess(domain, input.accessToken);
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
        }

        await db.upsertShopifyConnection({
          storeId: input.storeId,
          shopDomain: domain,
          accessToken: input.accessToken,
          scopes: grantedScopes,
          apiVersion: "2026-07",
        });

        return { success: true };
      }),

    getConnection: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        const connection = await db.getShopifyConnectionByStoreId(input.storeId);
        if (!connection) return null;

        return {
          id: connection.id,
          shopDomain: connection.shopDomain,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
        };
      }),

    disconnect: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        await db.deleteShopifyConnection(input.storeId);
        return { success: true };
      }),

    debugTransactions: protectedProcedure
      .input(z.object({ 
        storeId: z.number(),
        orderNumber: z.number().optional()
      }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        const connection = await db.getShopifyConnectionByStoreId(input.storeId);
        if (!connection) {
          throw new Error("Shopify not connected");
        }

        // Fetch last 30 days of transactions
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);

        const baseUrl = `https://${connection.shopDomain}/admin/api/2026-07/shopify_payments/balance/transactions.json`;
        const params = new URLSearchParams({ limit: "250" });
        
        const response = await fetch(`${baseUrl}?${params.toString()}`, {
          headers: {
            "X-Shopify-Access-Token": connection.accessToken,
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const transactions = data.transactions || [];

        // If orderNumber specified, also fetch orders to find the order ID
        let targetOrderId = null;
        if (input.orderNumber) {
          const ordersUrl = `https://${connection.shopDomain}/admin/api/2026-07/orders.json?limit=250&status=any`;
          const ordersResponse = await fetch(ordersUrl, {
            headers: {
              "X-Shopify-Access-Token": connection.accessToken,
              "Content-Type": "application/json",
            },
          });
          
          if (ordersResponse.ok) {
            const ordersData = await ordersResponse.json();
            const targetOrder = ordersData.orders.find((o: any) => o.order_number === input.orderNumber);
            if (targetOrder) {
              targetOrderId = parseInt(targetOrder.id);
            }
          }
        }

        // Filter transactions if orderNumber specified
        const filteredTransactions = targetOrderId
          ? transactions.filter((t: any) => t.source_order_id === targetOrderId)
          : transactions;

        return {
          orderNumber: input.orderNumber,
          orderIdFound: targetOrderId,
          transactionCount: filteredTransactions.length,
          transactions: filteredTransactions,
        };
      }),
  }),
  facebook: router({
    getAuthUrl: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const baseUrl = process.env.APP_URL || "http://localhost:3000";
        const redirectUri = `${baseUrl.replace(/\/$/, "")}/api/oauth/facebook/callback`;
        const state = await createOAuthState("facebook", input.storeId, ctx.user.id);
        const authUrl = getFacebookAuthUrl(redirectUri, state);
        return { authUrl };
      }),
    
    pendingAccounts: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const accessToken = await readPendingFacebookToken(ctx.req, ctx.user.id, store.id);
        if (!accessToken) return null;
        const token = await prepareFacebookToken(accessToken);
        const accounts = await getFacebookAdAccounts(token.accessToken);
        return { accounts: accounts.map(({ id, name, currency }) => ({ id, name, currency })), tokenType: token.type, expiresAt: token.expiresAt };
      }),

    connectPending: protectedProcedure
      .input(z.object({ storeId: z.number(), adAccountId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        const accessToken = await readPendingFacebookToken(ctx.req, ctx.user.id, store.id);
        if (!accessToken) throw new TRPCError({ code: "BAD_REQUEST", message: "Facebook login expired. Click Connect with Facebook OAuth again." });
        await saveVerifiedFacebookConnection(store.id, accessToken, input.adAccountId);
        clearPendingFacebookToken(ctx.res, ctx.req);
        return { success: true };
      }),

    availableConnections: protectedProcedure.query(({ ctx }) => db.getFacebookConnectionsForUser(ctx.user.id)),

    connectExisting: protectedProcedure
      .input(z.object({ storeId: z.number(), connectionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const [store, connection] = await Promise.all([db.getStoreById(input.storeId), db.getFacebookConnectionById(input.connectionId)]);
        const sourceStore = connection && await db.getStoreById(connection.storeId);
        if (!store || store.userId !== ctx.user.id || !sourceStore || sourceStore.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        await saveVerifiedFacebookConnection(store.id, connection.accessToken, connection.adAccountId);
        return { success: true };
      }),

    connectManual: protectedProcedure
      .input(z.object({ storeId: z.number(), accessToken: z.string().min(1).max(4096), adAccountId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        await saveVerifiedFacebookConnection(store.id, input.accessToken.trim(), input.adAccountId);
        return { success: true };
      }),
    getConnections: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        const connections = await db.getFacebookConnectionsByStoreId(input.storeId);

        return connections.map((conn) => ({
          id: conn.id,
          adAccountId: conn.adAccountId,
          adAccountName: conn.adAccountName,
          tokenType: conn.tokenType,
          connectedAt: conn.connectedAt,
          lastSyncAt: conn.lastSyncAt,
          tokenExpiresAt: conn.tokenExpiresAt,
        }));
      }),

    disconnect: protectedProcedure
      .input(z.object({ connectionId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const connection = await db.getFacebookConnectionById(input.connectionId);
        const store = connection && await db.getStoreById(connection.storeId);
        if (!store || store.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND" });
        await db.deleteFacebookConnection(input.connectionId);
        return { success: true };
      }),
  }),

  metrics: router({
    // Debug endpoint to see all transaction types from Shopify
    debugTransactionTypes: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          fromDate: z.string(),
          toDate: z.string(),
        })
      )
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const shopifyConn = await db.getShopifyConnectionByStoreId(input.storeId);
        if (!shopifyConn) {
          return { transactions: [], types: [] };
        }

        // Fetch raw balance transactions
        const baseUrl = `https://${shopifyConn.shopDomain}/admin/api/${shopifyConn.apiVersion || "2026-07"}/shopify_payments/balance/transactions.json`;
        const allTransactions: any[] = [];
        let hasMore = true;
        let lastId: number | null = null;
        let pageCount = 0;
        const MAX_PAGES = 10;

        while (hasMore && pageCount < MAX_PAGES) {
          pageCount++;
          const params = new URLSearchParams({ limit: "250" });
          if (lastId) params.append("last_id", lastId.toString());

          const response = await fetch(`${baseUrl}?${params.toString()}`, {
            headers: {
              "X-Shopify-Access-Token": shopifyConn.accessToken,
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) break;
          const data = await response.json();
          const transactions = data.transactions || [];
          if (transactions.length === 0) break;

          // Filter by date range
          const fromDate = new Date(input.fromDate + 'T00:00:00');
          const toDate = new Date(input.toDate + 'T23:59:59');
          
          for (const txn of transactions) {
            const txnDate = new Date(txn.processed_at);
            if (txnDate >= fromDate && txnDate <= toDate) {
              allTransactions.push({
                id: txn.id,
                type: txn.type,
                source_type: txn.source_type,
                amount: txn.amount,
                fee: txn.fee,
                net: txn.net,
                currency: txn.currency,
                processed_at: txn.processed_at,
              });
            }
          }

          lastId = transactions[transactions.length - 1].id;
          hasMore = transactions.length === 250;
        }

        // Get unique transaction types
        const types = Array.from(new Set(allTransactions.map(t => t.type)));
        
        // Filter to show only non-charge transactions (disputes, reversals, refunds)
        const interestingTransactions = allTransactions.filter(t => 
          t.type.toLowerCase() !== 'charge'
        );

        return { 
          transactions: interestingTransactions,
          types,
          totalCount: allTransactions.length,
          interestingCount: interestingTransactions.length
        };
      }),

    getProfit: protectedProcedure
      .input(z.object({
        storeId: z.number(),
        fromDate: z.string(),
        toDate: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        try {
          validateDateRange({ fromDate: input.fromDate, toDate: input.toDate });
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
        }
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Store not found or access denied" });
        }
        const shopifyConn = await db.getShopifyConnectionByStoreId(input.storeId);
        const facebookConns = await db.getFacebookConnectionsByStoreId(input.storeId);
        const rate = await getEurUsdRate();
        const warnings: string[] = [];
        let processed: ReturnType<typeof processOrders> = {
          revenue: 0, ordersCount: 0, totalCogs: 0, totalShipping: 0, processedOrders: [],
        };
        let cases: DisputeSummary = {
          count: 0, wonCount: 0, lostCount: 0, acceptedCount: 0,
          refundedCount: 0, pendingCount: 0, preventedCount: 0,
          amountsByCurrency: {},
        };
        let processingFees = 0;
        let disputeValue = 0;
        let disputeFees = 0;
        let disputeRecovered = 0;
        let disputeFeesRecovered = 0;
        let refunds = 0;
        let ledgerPages = 0;
        let unclassifiedTypes: string[] = [];
        let unreconciledLedgerNet = 0;
        let unreconciledLedgerCount = 0;
        let fxApproximate = false;
        let perOrderFeeEstimates = 0;

        if (shopifyConn) {
          if (store.currency !== "USD") {
            throw new Error(`Store currency ${store.currency} is not supported for a USD profit dashboard`);
          }
          const period = { fromDate: input.fromDate, toDate: input.toDate };
          const offset = store.timezoneOffset ?? -300;
          const version = shopifyConn.apiVersion || "2026-07";
          assertOrderHistoryAccess(period, shopifyConn.scopes, offset, store.timezone);
          const orders = await fetchShopifyOrders(
            shopifyConn.shopDomain, shopifyConn.accessToken, period,
            offset, version, store.timezone);
          // Dispute status identifies the case's outcome; its disputed face
          // amount is NOT a payment debit, a recovered amount, or a fee.
          cases = await fetchShopifyDisputes(
            shopifyConn.shopDomain, shopifyConn.accessToken, period,
            offset, version, store.timezone);
          // Any denial, malformed response, or incomplete pagination is fatal:
          // zeros would incorrectly certify missing refunds/fees as none.
          const ledger = await fetchShopifyBalanceTransactions(
            shopifyConn.shopDomain, shopifyConn.accessToken, period,
            version, rate, offset, store.timezone);
          disputeValue = ledger.totalDisputeValue;
          disputeFees = ledger.totalDisputeFees;
          disputeRecovered = ledger.totalDisputeRecovered;
          disputeFeesRecovered = ledger.totalDisputeFeesRecovered;
          refunds = ledger.totalRefunds;
          ledgerPages = ledger.pageCount;
          unclassifiedTypes = ledger.unclassifiedTypes;
          unreconciledLedgerNet = ledger.unclassifiedSignedNet;
          unreconciledLedgerCount = ledger.unclassifiedCount;
          fxApproximate = ledger.fxApproximate;
          warnings.push("The Shopify Payments ledger does not contain fees, refunds or disputes from PayPal or other outside payment gateways. Reconcile those separately if used.");
          // Charge fees and refund fee adjustments are recognized on their
          // balance-transaction processed_at date, including for old orders.
          processingFees = ledger.chargeFeesTotal + ledger.refundFeeAdjustments;
          if (ledger.holdMovement !== 0) {
            warnings.push("Shopify held/released funds are excluded from operating profit; they are not a finalized loss.");
          }
          if (unclassifiedTypes.length) {
            warnings.push(`${unreconciledLedgerCount} Shopify Payments ledger entries (signed net ${unreconciledLedgerNet.toFixed(2)} USD) were excluded because their operating-profit treatment is unknown: ${unclassifiedTypes.join(", ")}. Reconcile these postings before relying on profit.`);
          }
          if (fxApproximate) {
            warnings.push("EUR balance entries were converted to USD at today's rate; this is an estimate, not historical settlement FX.");
          }

          const [cogsConfigs, shippingConfigs, feeConfig] = await Promise.all([
            db.getCogsConfigByStoreId(input.storeId),
            db.getShippingConfigByStoreId(input.storeId),
            db.getProcessingFeesConfigByStoreId(input.storeId),
          ]);
          const cogsMap: Record<string, number> = {};
          for (const config of cogsConfigs) {
            const amount = Number(config.cogsValue);
            if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid configured COGS");
            const currency = (config.currency || "USD").toUpperCase();
            if (currency === "USD") cogsMap[config.variantId] = amount;
            else if (currency === "EUR") {
              cogsMap[config.variantId] = amount * rate;
              fxApproximate = true;
            } else throw new Error(`Unsupported configured COGS currency: ${currency}`);
          }
          const shippingMap: Record<string, any> = {};
          for (const config of shippingConfigs) {
            try {
              shippingMap[config.variantId] = JSON.parse(config.configJson || "{}");
            } catch {
              throw new Error("A stored shipping-cost configuration is invalid; profit cannot be verified");
            }
            if (shippingMap[config.variantId]?.currency === "EUR") fxApproximate = true;
          }
          if (fxApproximate && !warnings.some(message => message.includes("today's rate"))) {
            warnings.push("EUR costs were converted to USD at today's rate; this is not historical settlement FX.");
          }
          const percentFee = Number(feeConfig?.percentFee ?? "0.028");
          const fixedFee = Number(feeConfig?.fixedFee ?? "0.29");
          if (!Number.isFinite(percentFee) || percentFee < 0 || !Number.isFinite(fixedFee) || fixedFee < 0) {
            throw new Error("Invalid configured fallback processing fee");
          }
          processed = processOrders(
            orders, cogsMap, shippingMap, rate, ledger.orderFees, percentFee, fixedFee);
          let missingCogs = 0;
          let missingShipping = 0;
          for (const order of processed.processedOrders) {
            for (const item of order.items) {
              const key = String(item.variant_id ?? item.product_id ?? item.title ?? item.name ?? "");
              if (!Object.prototype.hasOwnProperty.call(cogsMap, key)) missingCogs++;
              if (order.region && !Object.prototype.hasOwnProperty.call(shippingMap, key)) missingShipping++;
            }
          }
          if (missingCogs) warnings.push(`${missingCogs} line items have no configured COGS; their actual product cost is not included.`);
          if (missingShipping) warnings.push(`${missingShipping} line items have no configured shipping profile; verify actual fulfillment costs.`);
          const cancelledUnfulfilled = orders.filter(order =>
            order.cancelled_at && order.fulfillment_status !== "fulfilled" &&
            !order.test && ["paid", "partially_refunded", "refunded"].includes(order.financial_status || "")
          ).length;
          if (cancelledUnfulfilled) {
            warnings.push(`${cancelledUnfulfilled} paid orders were cancelled before full fulfillment. Their configured COGS/shipping remain estimates; reconcile returned inventory and labels manually.`);
          }
          const excludedOrders = orders.length - processed.ordersCount;
          if (excludedOrders) warnings.push(`${excludedOrders} unpaid, voided, test or otherwise unsupported orders were excluded from sales.`);
          perOrderFeeEstimates = processed.processedOrders.filter(
            order => order.processingFeeSource === "estimated").length;
          if (perOrderFeeEstimates) {
            warnings.push(`${perOrderFeeEstimates} per-order fee figures are estimates; period processing fees use actual posted Shopify Payments fees only. Other payment gateways are not included.`);
          }
        } else {
          warnings.push("Connect this store to Shopify to fetch orders, payment fees, refunds and disputes. Zero is not a verified profit figure.");
        }

        if (facebookConns.length === 0) {
          warnings.push("No Facebook ad account is connected; any Meta ad spend is excluded from profit.");
        }

        let adSpend = 0;
        for (const connection of facebookConns) {
          const result = await fetchFacebookAdSpend(
            connection.adAccountId, connection.accessToken,
            { fromDate: input.fromDate, toDate: input.toDate },
            connection.apiVersion || "v25.0");
          if (result.currency === "USD") adSpend += result.spend;
          else if (result.currency === "EUR") adSpend += result.spend * rate;
          else throw new Error(`Unsupported ad-account currency: ${result.currency}`);
        }
        const expenses = await db.getOperationalExpensesByStoreId(input.storeId);
        const operationalExpenses = calculateOperationalExpensesForPeriod(
          expenses.map(expense => ({
            type: expense.type,
            amount: Number(expense.amount),
            date: expense.date,
            startDate: expense.startDate,
            endDate: expense.endDate,
          })),
          new Date(`${input.fromDate}T00:00:00Z`),
          new Date(`${input.toDate}T00:00:00Z`));
        const breakdown = calculateProfitBreakdown({
          revenue: processed.revenue,
          cogs: processed.totalCogs,
          shipping: processed.totalShipping,
          processingFees,
          adSpend,
          operationalExpenses,
          refunds,
          disputeValue,
          disputeFees,
          disputeRecovered,
          disputeFeesRecovered,
        });
        const orderProfits = processed.processedOrders.map(order => order.profit);
        const orderMargins = processed.processedOrders.map(
          order => order.total > 0 ? order.profit / order.total * 100 : 0);
        const count = processed.ordersCount;
        return {
          revenue: processed.revenue,
          orders: count,
          cogs: processed.totalCogs,
          shipping: processed.totalShipping,
          processingFees,
          adSpend,
          disputeValue,
          disputeFees,
          disputeRecovered,
          disputeFeesRecovered,
          refunds,
          operationalExpenses,
          exchangeRateUsed: rate,
          totalCosts: breakdown.totalCosts,
          netProfit: breakdown.netProfit,
          processedOrders: processed.processedOrders,
          averageOrderProfitMargin: count ? orderMargins.reduce((a, b) => a + b, 0) / count : 0,
          averageOrderProfit: count ? orderProfits.reduce((a, b) => a + b, 0) / count : 0,
          roas: adSpend > 0 ? processed.revenue / adSpend : 0,
          disputeCases: {
            won: cases.wonCount,
            lost: cases.lostCount,
            accepted: cases.acceptedCount,
            pending: cases.pendingCount,
            refunded: cases.refundedCount,
            prevented: cases.preventedCount,
            nominalAmountsByCurrency: cases.amountsByCurrency,
          },
          dataQuality: {
            shopifyConnected: !!shopifyConn,
            paymentsVerified: !!shopifyConn && !unclassifiedTypes.length && !fxApproximate && !perOrderFeeEstimates,
            ledgerPages,
            fxApproximate,
            perOrderFeeEstimates,
            unclassifiedTypes,
            unreconciledLedgerNet,
            unreconciledLedgerCount,
            warnings,
            basis: "Orders by created date; fees/refunds/dispute debits and credits by Shopify Payments processed date",
          },
        };
      }),

    // Removed caching procedures - using direct getProfit only
  }),

  expenses: router({
    list: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        return await db.getOperationalExpensesByStoreId(input.storeId);
      }),

    create: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          title: z.string(),
          amount: z.string(),
          currency: z.enum(["USD", "EUR"]),
          type: z.enum(["one_time", "monthly", "yearly"]),
          date: z.string().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          isActive: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        // Convert EUR to USD before saving (always store in USD)
        let amountUSD = parseFloat(input.amount);
        if (input.currency === "EUR") {
          const exchangeRate = await getEurUsdRate();
          amountUSD = amountUSD * exchangeRate;
          console.log(`[Expense Create] Converting EUR ${input.amount} to USD ${amountUSD.toFixed(2)} (rate: ${exchangeRate})`);
        }

        await db.createOperationalExpense({
          storeId: input.storeId,
          type: input.type,
          title: input.title,
          amount: amountUSD.toFixed(2), // Store in USD with 2 decimal places
          currency: "USD", // Always store as USD
          date: input.date ? new Date(input.date) : undefined,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          isActive: input.isActive,
        });

        // Cache invalidation removed

        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          storeId: z.number(),
          title: z.string().optional(),
          amount: z.string().optional(),
          currency: z.enum(["USD", "EUR"]).optional(),
          endDate: z.string().optional(),
          isActive: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const expense = await db.getOperationalExpenseById(input.id);
        if (!expense || expense.storeId !== input.storeId) throw new TRPCError({ code: "NOT_FOUND" });
        const updates: any = {};
        
        if (input.title) updates.title = input.title;
        if (input.endDate) updates.endDate = new Date(input.endDate);
        if (input.isActive !== undefined) updates.isActive = input.isActive;
        
        // Convert amount if provided
        if (input.amount && input.currency) {
          let amountUSD = parseFloat(input.amount);
          if (input.currency === "EUR") {
            const exchangeRate = await getEurUsdRate();
            amountUSD = amountUSD * exchangeRate;
          }
          updates.amount = amountUSD.toFixed(2);
          updates.currency = "USD";
        }

        await db.updateOperationalExpense(input.id, updates);
        
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number(), storeId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const expense = await db.getOperationalExpenseById(input.id);
        const store = await db.getStoreById(input.storeId);
        if (!expense || expense.storeId !== input.storeId || !store || store.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await db.deleteOperationalExpense(input.id);
        
        // Cache invalidation removed
        
        return { success: true };
      }),

    // Bulk CSV Operations for Expenses
    downloadExpensesTemplate: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { generateExpensesTemplate } = await import("./csv-helper");
        const csv = await generateExpensesTemplate(input.storeId);
        return { csv };
      }),

    importExpensesBulk: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          csvData: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { parseExpensesCSV } = await import("./csv-helper");
        const parseResult = parseExpensesCSV(input.csvData);

        if (!parseResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `CSV validation failed: ${parseResult.errors?.join(", ")}`,
          });
        }

        // Bulk create operational expenses
        let successCount = 0;
        for (const item of parseResult.data || []) {
          const name = item["Name"];
          const amount = parseFloat(item["Amount (USD)"]);
          const type = item["Type"];
          const date = item["Date"];
          const startDate = item["Start Date"];
          const endDate = item["End Date"];
          const isActive = item["Is Active"] === "true" ? 1 : 0;
          
          if (!name || !amount || !type) continue;

          await db.createOperationalExpense({
            storeId: input.storeId,
            type,
            title: name,
            amount: amount.toFixed(2),
            currency: "USD",
            date: date ? new Date(date) : undefined,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            isActive,
          });
          successCount++;
        }

        // Cache invalidation removed

        return { success: true, count: successCount };
      }),
  }),

  products: router({
    list: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const shopifyConn = await db.getShopifyConnectionByStoreId(input.storeId);
        if (!shopifyConn) {
          return [];
        }

        // Fetch ALL products from Shopify with pagination
        const allProducts: any[] = [];
        let nextPageInfo: string | null = null;
        let pageCount = 0;
        const MAX_PAGES = 20; // Fetch up to 5000 products (250 per page)

        while (pageCount < MAX_PAGES) {
          pageCount++;
          const url = new URL(`https://${shopifyConn.shopDomain}/admin/api/${shopifyConn.apiVersion || "2026-07"}/products.json`);
          
          if (nextPageInfo) {
            url.searchParams.set("page_info", nextPageInfo);
            url.searchParams.set("limit", "250");
          } else {
            url.searchParams.set("limit", "250");
          }

          const response = await fetch(url.toString(), {
            headers: {
              "X-Shopify-Access-Token": shopifyConn.accessToken,
            },
          });

          if (!response.ok) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to fetch products from Shopify",
            });
          }

          const data = await response.json();
          const products = data.products || [];
          allProducts.push(...products);

          // Check for next page
          const linkHeader = response.headers.get("link");
          if (linkHeader && linkHeader.includes('rel="next"')) {
            const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>; rel="next"/);
            if (nextMatch) {
              nextPageInfo = nextMatch[1];
            } else {
              break;
            }
          } else {
            break;
          }
        }

        console.log(`[Products] Fetched ${allProducts.length} products from Shopify`);
        return allProducts;
      }),
  }),

  orders: router({
    listWithProfit: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          startDate: z.string(),
          endDate: z.string(),
        })
      )
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const shopifyConn = await db.getShopifyConnectionByStoreId(input.storeId);
        if (!shopifyConn) {
          return [];
        }

        assertOrderHistoryAccess(
          { fromDate: input.startDate, toDate: input.endDate },
          shopifyConn.scopes, store.timezoneOffset ?? -300, store.timezone
        );

        const orders = await fetchShopifyOrders(
          shopifyConn.shopDomain,
          shopifyConn.accessToken,
          { fromDate: input.startDate, toDate: input.endDate },
          store.timezoneOffset ?? -300,
          shopifyConn.apiVersion || "2026-07",
          store.timezone
        );

        const cogsConfigList = await db.getCogsConfigByStoreId(input.storeId);
        const shippingConfigList = await db.getShippingConfigByStoreId(input.storeId);
        const processingFeesConfig = await db.getProcessingFeesConfigByStoreId(input.storeId);
        const rate = await getEurUsdRate();

        const cogsMap: Record<string, number> = {};
        for (const config of cogsConfigList) {
          const amount = Number(config.cogsValue);
          if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid configured COGS");
          const currency = (config.currency || "USD").toUpperCase();
          if (currency !== "USD" && currency !== "EUR") throw new Error(`Unsupported COGS currency: ${currency}`);
          cogsMap[config.variantId] = currency === "EUR" ? amount * rate : amount;
        }

        const shippingMap: Record<string, any> = {};
        for (const config of shippingConfigList) {
          try {
            shippingMap[config.variantId] = JSON.parse(config.configJson);
          } catch {
            throw new Error("Invalid configured shipping cost");
          }
        }

        const ledger = await fetchShopifyBalanceTransactions(
          shopifyConn.shopDomain,
          shopifyConn.accessToken,
          { fromDate: input.startDate, toDate: input.endDate },
          shopifyConn.apiVersion || "2026-07",
          rate,
          store.timezoneOffset ?? -300,
          store.timezone
        );
        const processed = processOrders(
          orders, cogsMap, shippingMap, rate, ledger.orderFees,
          Number(processingFeesConfig?.percentFee ?? "0.028"),
          Number(processingFeesConfig?.fixedFee ?? "0.29")
        );

        // Calculate per-order profit in USD
        const ordersWithProfit = processed.processedOrders.map((order: any) => {
          // Keep values in USD
          const orderTotal = order.total; // total_price from Shopify already includes shipping, discounts, and tips
          const orderShippingRevenue = order.shippingRevenue || 0;
          const orderTip = order.tip || 0;
          const orderCogs = order.cogs;
          const orderShipping = order.shippingCost;
          const orderProcessingFee = order.processingFees;
          // Profit = Total Revenue - COGS - Shipping Cost - Processing Fees
          // Note: orderTotal already includes everything customer paid (products + shipping + tip - discounts)
          const orderProfit = orderTotal - orderCogs - orderShipping - orderProcessingFee;

          return {
            id: order.id,
            orderNumber: order.orderNumber || order.id,
            createdAt: order.createdAt,
            country: order.country,
            shippingType: order.shippingType,
            discount: order.discount || 0,
            tip: orderTip,
            shippingRevenue: orderShippingRevenue,
            totalRevenue: orderTotal,
            totalCogs: orderCogs,
            totalShipping: orderShipping,
            totalProcessingFees: orderProcessingFee,
            processingFeeSource: order.processingFeeSource,
            profit: orderProfit,
            lineItems: (order.items || []).map((item: any) => {
              // Keep values in USD
              const itemPrice = item.price;
              const itemCogs = item.cogs || 0;
              const itemShipping = item.shippingCost || 0;
              
              // Calculate proportional discount allocation
              // Each item gets a share of the order discount based on its price proportion
              const itemTotal = itemPrice * item.quantity;
              const orderSubtotal = (order.items || []).reduce((sum: number, i: any) => sum + (i.price * i.quantity), 0);
              const itemDiscountShare = orderSubtotal > 0 ? (itemTotal / orderSubtotal) * (order.discount || 0) : 0;
              
              // Note: Processing fees are now tracked at order level only (from Shopify balance transactions)
              // Item profit = revenue - cogs - shipping - proportional discount (fees are deducted at order level)
              const itemProfit = itemTotal - itemCogs - itemShipping - itemDiscountShare;
              
              return {
                name: item.name,
                quantity: item.quantity,
                price: itemPrice,
                cogs: itemCogs,
                shipping: itemShipping,
                discount: itemDiscountShare,
                profit: itemProfit,
              };
            }),
          };
        });

        return ordersWithProfit;
      }),
  }),

  config: router({
    getCogs: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        return await db.getCogsConfigByStoreId(input.storeId);
      }),

    setCogs: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
          cogsValue: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        await db.upsertCogsConfig({
          storeId: input.storeId,
          variantId: input.variantId,
          productTitle: null,
          cogsValue: input.cogsValue,
          currency: "EUR",
        });

        // Cache invalidation removed

        return { success: true };
      }),

    setShipping: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
          configJson: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        await db.upsertShippingConfig({
          storeId: input.storeId,
          variantId: input.variantId,
          productTitle: null,
          configJson: input.configJson,
        });

        // Cache invalidation removed

        return { success: true };
      }),

    upsertCogs: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
          productTitle: z.string().optional(),
          cogsValue: z.number(),
          currency: z.string().default("EUR"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        await db.upsertCogsConfig({
          storeId: input.storeId,
          variantId: input.variantId,
          productTitle: input.productTitle || null,
          cogsValue: input.cogsValue.toString(),
          currency: input.currency,
        });

        // Cache invalidation removed

        return { success: true };
      }),

    getShipping: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        return await db.getShippingConfigByStoreId(input.storeId);
      }),

    upsertShipping: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
          productTitle: z.string().optional(),
          configJson: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new Error("Store not found or access denied");
        }

        await db.upsertShippingConfig({
          storeId: input.storeId,
          variantId: input.variantId,
          productTitle: input.productTitle || null,
          configJson: input.configJson,
        });

        return { success: true };
      }),

    // Bulk CSV Operations
    downloadCogsTemplate: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { generateCogsTemplate } = await import("./csv-helper");
        const csv = await generateCogsTemplate(input.storeId);
        return { csv };
      }),

    downloadShippingTemplate: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { generateShippingTemplate } = await import("./csv-helper");
        const csv = await generateShippingTemplate(input.storeId);
        return { csv };
      }),

    importCogsBulk: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          csvData: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { parseCogsCSV } = await import("./csv-helper");
        const parseResult = parseCogsCSV(input.csvData);

        if (!parseResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `CSV validation failed: ${parseResult.errors?.join(", ")}`,
          });
        }

        // Bulk upsert COGS configurations and shipping profile assignments
        let successCount = 0;
        for (const item of parseResult.data || []) {
          const variantId = item["Variant ID"];
          const cogsValue = item["Current COGS (USD)"];
          const shippingProfileName = item["Shipping Profile Name"];
          
          if (!variantId) continue;
          
          // Update COGS if provided
          if (cogsValue && cogsValue !== "") {
            await db.upsertCogsConfig({
              storeId: input.storeId,
              variantId: variantId.toString(),
              productTitle: item["Product Title"] || "",
              cogsValue: parseFloat(cogsValue).toString(),
              currency: "USD",
            });
          }
          
          // Update shipping profile assignment if provided
          if (shippingProfileName && shippingProfileName !== "") {
            // Find profile by name
            const profiles = await db.getShippingProfilesByStoreId(input.storeId);
            const profile = profiles.find((p: any) => p.name === shippingProfileName);
            
            if (profile) {
              await db.assignShippingProfile({
                storeId: input.storeId,
                variantId: variantId.toString(),
                profileId: profile.id,
              });
            }
          }
          
          successCount++;
        }

        // Cache invalidation removed

        return { success: true, count: successCount };
      }),

    importShippingBulk: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          csvData: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const { parseShippingCSV } = await import("./csv-helper");
        const parseResult = parseShippingCSV(input.csvData);

        if (!parseResult.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `CSV validation failed: ${parseResult.errors?.join(", ")}`,
          });
        }

        // Reconstruct shipping profiles from flat CSV rows
         // Group rows by profile name and reconstruct Country→Method→Quantity→Cost structure
        const data = parseResult.data!;
        const profilesMap = new Map<string, any>();
        for (const item of data) {
          const profileName = item["Profile Name"];
          if (!profileName) continue;
          
          if (!profilesMap.has(profileName)) {
            profilesMap.set(profileName, {});
          }
          
          const config = profilesMap.get(profileName);
          const countryCode = item["Country Code"] || "ALL";
          const methodName = item["Shipping Method"] || "Standard";
          const quantity = item["Quantity"] || "1";
          const cost = parseFloat(item["Cost (USD)"]) || 0;
          
          // Build structure: config[country][method][quantity] = cost
          if (!config[countryCode]) {
            config[countryCode] = {};
          }
          if (!config[countryCode][methodName]) {
            config[countryCode][methodName] = {};
          }
          config[countryCode][methodName][quantity.toString()] = cost;
        }
        
        // Create or update profiles
        let successCount = 0;
        for (const [profileName, config] of Array.from(profilesMap.entries())) {
          const configJson = JSON.stringify(config);
          
          // Check if profile exists
          const existingProfiles = await db.getShippingProfilesByStoreId(input.storeId);
          const existing = existingProfiles.find((p: any) => p.name === profileName);
          
          if (existing) {
            // Update existing profile
            await db.updateShippingProfile(existing.id, {
              configJson,
            });
          } else {
            // Create new profile
            await db.createShippingProfile({
              storeId: input.storeId,
              name: profileName,
              description: null,
              configJson,
            });
          }
          successCount++;
        }

        // Cache invalidation removed

        return { success: true, count: successCount };
      }),
  }),

  shippingProfiles: router({
    list: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        return await db.getShippingProfilesByStoreId(input.storeId);
      }),

    getById: protectedProcedure
      .input(z.object({ profileId: z.number() }))
      .query(async ({ ctx, input }) => {
        const profile = await db.getShippingProfileById(input.profileId);
        if (!profile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found",
          });
        }

        const store = await db.getStoreById(profile.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Access denied",
          });
        }

        return profile;
      }),

    create: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          name: z.string().min(1),
          description: z.string().optional(),
          configJson: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        await db.createShippingProfile({
          storeId: input.storeId,
          name: input.name,
          description: input.description || null,
          configJson: input.configJson,
        });

        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          profileId: z.number(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          configJson: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getShippingProfileById(input.profileId);
        if (!profile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found",
          });
        }

        const store = await db.getStoreById(profile.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Access denied",
          });
        }

        const updates: Partial<typeof profile> = {};
        if (input.name) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.configJson) updates.configJson = input.configJson;

        await db.updateShippingProfile(input.profileId, updates);

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ profileId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const profile = await db.getShippingProfileById(input.profileId);
        if (!profile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Profile not found",
          });
        }

        const store = await db.getStoreById(profile.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Access denied",
          });
        }

        await db.deleteShippingProfile(input.profileId);

        return { success: true };
      }),

    assignToProduct: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
          profileId: z.number(),
          productTitle: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        const profile = await db.getShippingProfileById(input.profileId);
        if (!profile || profile.storeId !== input.storeId) throw new TRPCError({ code: "NOT_FOUND" });
        await db.assignShippingProfile({
          storeId: input.storeId,
          variantId: input.variantId,
          profileId: input.profileId,
          productTitle: input.productTitle || null,
        });

        return { success: true };
      }),

    getProductAssignments: protectedProcedure
      .input(z.object({ storeId: z.number() }))
      .query(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        return await db.getProductShippingProfilesByStoreId(input.storeId);
      }),

    removeProductAssignment: protectedProcedure
      .input(
        z.object({
          storeId: z.number(),
          variantId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const store = await db.getStoreById(input.storeId);
        if (!store || store.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Store not found or access denied",
          });
        }

        await db.removeProductShippingProfile(input.storeId, input.variantId);

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
