# Beprofit on Vercel

- **Production URL:** https://beprofit-woad.vercel.app/
- **Vercel project:** `prj_2mhU5XfJ3hUBOyJUsiBN1rzToD9Q`
- **Financial-audit production deployment, 2 October 2026:** `dpl_4vjyNZd57t3Q7UsqysTAJWBczjgB`
- **GitHub:** [stelioskoul/profit-tracker](https://github.com/stelioskoul/profit-tracker) (renamed from `beprofit-alternative`)

The full React/Express/tRPC app uses Beprofit's Supabase Postgres database. The production release was uploaded directly to Vercel, not deployed from GitHub. Vercel serves `public/**` via its CDN and runs the generated `server.cjs` as an Express Function. **Pushing or merging this PR does not itself redeploy production.** This branch preserves the audited production source and its Vercel adapter; it does not change the project's repository connection, environment variables or deployment settings.

## Verification and limits

The 2 October audit passed **72 tests**, with 2 optional provider-credential tests skipped, plus TypeScript, production build and HTTPS production signup/Supabase/tenant-isolation/token-encryption smoke checks. Those test accounts were deleted afterward. The ledger calculation was verified with documented Shopify API-shaped fixtures, **not actual merchant payout rows**. See [the financial audit](docs/PROFIT_AUDIT_REPORT.md) for the formula, reporting date basis and known limitations.

As last checked on 5 October, Beprofit had one store but no Shopify or Meta connection and no COGS, shipping-cost or expense configuration. The dashboard therefore labels headline profit **Estimated Operating Profit** and discloses incomplete data instead of claiming financial certification. Connect Shopify inside Beprofit's **Connections** tab with `read_orders`, `read_shopify_payments_disputes` and `read_shopify_payments_payouts`. History beyond 60 days additionally needs Shopify-approved `read_all_orders`. A separate Manus Shopify connector is not the application's connection.

## Protected runtime configuration

`DATABASE_URL`, `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` are stored as encrypted Vercel settings for Production and Preview. `APP_URL` is `https://beprofit-woad.vercel.app` in Production. No secret value is committed. Do not rotate the token-encryption key without re-encrypting or reconnecting stored provider tokens.

For provider OAuth, set server-only `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` in Vercel and register:

- `https://beprofit-woad.vercel.app/api/oauth/shopify/callback`
- `https://beprofit-woad.vercel.app/api/oauth/facebook/callback`

The old Manus database was not restored. New accounts, store connections and settings must be recreated. Admin promotion is explicit; see [Supabase setup](SUPABASE_SETUP.md). A password formerly present in public Git history was removed from the current tree; rotate it anywhere it was reused.

## Rebuild the Vercel package

From a checkout containing these audit changes, use the repository's pinned pnpm version:

```bash
npm exec --yes --package=pnpm@10.18.0 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.18.0 -- pnpm check
npm exec --yes --package=pnpm@10.18.0 -- pnpm test
npm exec --yes --package=pnpm@10.18.0 -- pnpm build
```

The build writes frontend output to `dist/public/`. Create a **generated root-level** `public/` copy for the adapter's HTML import; do not alter the original `client/public/` assets. On a clean checkout:

```bash
cp -a dist/public public
node scripts/build-vercel.mjs
```

If a generated root `public/` already exists, replace only that generated output after checking it contains no user-authored assets. The bundler refuses to overwrite an unrecognized `vercel-package/`; a recognized prior generated package is regenerated safely. Deploy **the generated `vercel-package/` directory** to the existing Vercel project with its protected settings. Do not commit this output, `.env` files or tokens.

The existing standalone `pnpm build`/`pnpm start` and Docker workflows remain available. The root `server.ts` adapter is only for Vercel; it does not own an HTTP listener. Merely connecting the raw source repository for auto-deploy is not equivalent to deploying the packaged app: arrange and verify the packaging/static-output build strategy before enabling Git-connected deployment. This PR does not enable auto-deploy.

Sources: [Vercel Express](https://vercel.com/docs/frameworks/backend/express), [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js).
