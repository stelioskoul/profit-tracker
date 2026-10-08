# Beprofit backend recovery

## What was recreated

The saved React/Express/tRPC application now uses **Supabase Postgres** rather than its former Manus-hosted MySQL database. The new [Beprofit Supabase project](https://supabase.com/dashboard/project/gbljeepuzptgtbmvhdwe) is in **SKOUL PROJECTS / eu-west-1**. The project was created after Supabase quoted **$10 per month** through its cost-confirmation flow.

The initial migration created eleven empty application tables, foreign keys with cascading cleanup, a tenant-safe shipping-profile constraint, indexes, `updatedAt` triggers, and RLS. Browser-facing `anon` and `authenticated` roles have no table policies or grants. A private, least-privilege `beprofit_app` login is used by the Express server. A later migration updated the Shopify default to `2026-07` and Meta Marketing default to `v25.0`. Supabase's security advisor returned **no findings** immediately after setup; unused-index notices are expected for empty tables.

**Supabase Auth is not in use.** The application retains its existing email/password login with bcrypt hashes, a seven-day signed HttpOnly cookie, and the original tRPC API. Shopify and Facebook access tokens are encrypted by the server with AES-256-GCM before insertion. The `TOKEN_ENCRYPTION_KEY` is required to decrypt them later; losing it means reconnecting those providers.

## What was *not* restored

The GitHub repository contains the application's source and old MySQL schema, **not a complete export of the old Manus database**. The new project currently has no old accounts, stores, costs, shipping settings, expenses, permissions, or provider tokens. Users must register again, recreate settings, and reconnect Shopify/Facebook. With valid connections, orders/ad data is fetched live from those services; previous database-only configuration does not reappear automatically. If an authorized old database export becomes available, plan a separately reviewed migration before importing; do not import partial GitHub query-result fragments as a complete backup.

An obsolete migration script in the public GitHub history contained a hard-coded password. It has been removed from the current branch, but **Git history remains public**. Rotate that password anywhere it was used and avoid reusing it when registering again.

## Server configuration

The server reads the following values **only from a protected environment/secret manager**, never from frontend `VITE_` variables. The checked-in `.env.example` contains names and placeholders only.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private Supabase **session-pooler** connection for `beprofit_app`, with `sslmode=require`. The verified pooler for this project is `aws-0-eu-west-1.pooler.supabase.com:5432`; username is `beprofit_app.gbljeepuzptgtbmvhdwe`. Keep the password private and URL-encode special characters. |
| `JWT_SECRET` | At least 32 random characters to sign app sessions and OAuth state. Changing it signs users out. |
| `TOKEN_ENCRYPTION_KEY` | A base64-encoded 32-byte secret for provider tokens. Preserve this key across deploys. |
| `APP_URL` | Public HTTPS origin of the newly deployed app, without a trailing slash; local testing uses `http://localhost:3000`. |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Needed to authorize Shopify shops with the new callback URL. |
| `SHOPIFY_CLIENT_CREDENTIALS` | Optional server-only JSON map of installed `.myshopify.com` domains to `{userId, label, clientId, clientSecret}`. Bind each entry to its owning Profit Tracker account. The Connections screen offers those stores only to that account; client-credentials tokens are cached and renewed before their 24-hour expiry. Store this value encrypted in the hosting environment, never in frontend variables or source control. Manual token connections remain supported. |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Needed for Meta ad-account OAuth. |
| `PORT` | Server listener, default `3000`. |

Do **not** enable the Manus WebDev built-in database for this app: that would supply a MySQL `DATABASE_URL` instead of the new Supabase connection. Published hosting needs a server container and three protected application secrets plus `APP_URL`; provider credentials are additional if those flows are needed. The callback URLs to register with the providers are `${APP_URL}/api/oauth/shopify/callback` and `${APP_URL}/api/oauth/facebook/callback`. Manual token connection still requires you to obtain valid credentials from the provider.

The first new user has the ordinary `user` role. After verifying that the account belongs to the owner, an administrator can grant it `admin` through the Supabase SQL editor. Do **not** automatically promote an unverified email during registration. Existing legacy Manus identities and sessions will not authenticate to this new backend.

## Local verification

Install with the repository's pinned pnpm version, build, and run the app with a **gitignored** local environment or a secure environment injector. The following commands do not create the database; its migrations have already been applied to the project linked above.

```sh
npm exec --yes --package=pnpm@10.18.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.18.0 -- pnpm check
npm exec --yes --package=pnpm@10.18.0 -- pnpm build
node --env-file=.env.local dist/index.js
```

Check `GET /health` for a successful database-aware readiness response. To run the guarded integration smoke test intentionally against the connected database, start the server first and then run:

```sh
RUN_DB_SMOKE=1 node --import tsx --env-file=.env.local scripts/smoke-supabase.mjs
```

That script creates two temporary accounts, tests signup, auth-response redaction, store isolation, expenses, COGS, roles, and encryption of a **fake** Shopify token, and deletes the temporary accounts (FK cascades delete their stores and data) in a `finally` block. Do not run it against a database you do not wish to modify. It does **not** prove real Shopify or Facebook credentials work; those must be validated after you reconnect each service.

The original `drizzle/*.sql` and `drizzle/meta` files are **legacy MySQL history**. Never apply them to the Supabase project. For new database changes, write and review new Supabase PostgreSQL migrations; `drizzle.config.ts` uses a separate Postgres output directory.

Sources: [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres), [Shopify REST API reference](https://shopify.dev/docs/api/admin-rest), and [Meta API versions](https://developers.facebook.com/docs/graph-api/changelog/versions/).
