# Beprofit profit and Shopify dispute audit

- **Audit date:** 2 October 2026
- **Production:** [beprofit-woad.vercel.app](https://beprofit-woad.vercel.app/)
- **Verified corrected deployment:** `dpl_4vjyNZd57t3Q7UsqysTAJWBczjgB`

## Verdict

**The old calculation was not reliable. The corrected calculation is deployed and passes deterministic tests, but I cannot certify it as “100% accurate” against this store’s real Shopify Payments records yet.** Beprofit’s Supabase database had **no Shopify connection** at audit time. The separately authorized Manus Shopify connector identified the Minicubez store, but its Payments-account query was denied for lack of `read_shopify_payments` or `read_shopify_payments_accounts`, and its accessible recent-dispute query returned no cases. I did **not** have real payout rows, won/lost disputes, refunds or fee reversals to reconcile line by line. Connecting the plugin does not silently provide a token to the Beprofit app.

The Vercel site is working. Production `/health`, `/signup`, the versioned script and stylesheet responded successfully; the guarded registration/Supabase/tenant-isolation/token-encryption smoke test passed and deleted its temporary accounts. Vercel reported no recent runtime-error clusters.

## Formula and reporting basis now used

For an inclusive date range expressed in the **store’s IANA timezone**:

```text
Estimated operating profit
  = gross value of paid Shopify orders created in the range
  - configured COGS on those orders
  - configured fulfillment/shipping cost on those orders
  - actual Shopify Payments charge fees posted in the range
  - actual Shopify Payments refund principal posted in the range
  - actual refund-related fee charges posted in the range
  - actual dispute principal debits posted in the range
  - actual dispute fees posted in the range
  + actual dispute principal credits/recoveries posted in the range
  + actual fee refunds/credits posted in the range
  - connected Meta advertising spend for the range
  - configured operating expenses for the range
```

A *negative* signed fee adjustment reduces costs; the dashboard’s **Classified Costs = gross revenue − estimated operating profit**. Original order totals are retained as the sale basis; using Shopify’s **current** post-refund total and additionally subtracting a posted refund would double-count that refund ([Shopify Order fields](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)). This is an **operational, dual-date estimate**, not a GAAP income statement or Shopify Payouts cash balance: an old order’s dispute recovery can increase today’s profit even when no new order was created today.

**Dispute case statuses and money are different data.** `won`, `lost`, `accepted`, `charge_refunded`, pending and prevented cases are counted by the dispute’s `initiated_at`; they never alone create a debit, recovery or fee. Cash effects use the signed Shopify Payments balance entries and their `processed_at`. Shopify documents a dispute debit of **−$100 gross, $15 fee, −$115 net** ([balance transactions](https://shopify.dev/docs/api/admin-rest/2026-07/resources/transactions)); a later posted +$100 principal recovery and +$15 fee refund net to zero across both periods. If the fee is not actually returned, the combined cost remains $15. A $40 principal recovery without a fee credit leaves a $75 impact in that example. **No universal €15 fee or automatic fee refund is assumed:** Shopify says the fee and refund policy vary by region ([chargeback process](https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process)).

## Corrections made

| Area | Previous risk | Current treatment |
| --- | --- | --- |
| Dispute fetch | Used undocumented REST range filters, omitted `initiated_at`, inferred money from final status. | Traverses all dispute cursor pages, filters exact store-local initiation dates, validates case amounts/currencies, reports statuses only as cases. |
| Balance ledger | Stopped after ten pages, masked denied access as zero, ignored posted dispute money. | Follows Shopify’s exact `Link` cursors until the documented processed-time boundary, validates `amount − fee = net`, rejects missing access/invalid data; classifies signed posted debits, credits and reversals. |
| Processing fees | Fell back to a fixed 2.8% + $0.29 even when actual fee data existed. | Headline uses all actual charge fees **posted** in the period, including charges on older orders; individual rows show `posted` or the store’s configured `estimated` fallback. An actual zero fee is not treated as missing. |
| Revenue and totals | Counted uncollected orders; Total Costs and Net Profit did not reconcile when disputes were recovered. | Excludes authorized/pending/voided/test orders, rejects partial or unknown payment states rather than inflating sales, and reconciles costs to profit from one formula. |
| Calendar | Store Settings changed only an ignored offset; another selector reversed its sign. Monthly January-31 expenses skipped February. | Persists the canonical IANA timezone; half-open day bounds handle daylight saving time. Monthly and yearly expenses are anchored and clamped to month-end/leap-day anniversaries. |
| Access and gaps | A valid shop token could lack payout permissions; older than 60-day orders could silently disappear. | Connection probes orders, disputes and balance endpoints before saving; older ranges require **actually granted** `read_all_orders`. Missing COGS/shipping, unfulfilled cancellations, external gateways, absent Meta spend, approximate FX and unclassified ledger rows show limitations rather than looking exact. |
| Unclassified cash movement | Unknown nonzero balance entries could disappear from the calculation. | Exposes their **signed net sum, count and types** as an explicit unreconciled bridge; the headline is labeled **Estimated Operating Profit**, not certified profit. |

Shopify documents the REST [dispute](https://shopify.dev/docs/api/admin-rest/2026-07/resources/dispute), [balance transaction](https://shopify.dev/docs/api/admin-rest/2026-07/resources/transactions), [pagination](https://shopify.dev/docs/api/admin-rest/usage/pagination) and [Payments access scopes](https://shopify.dev/docs/api/admin-rest/usage/access-scopes) used for these changes. `read_shopify_payments_disputes` and `read_shopify_payments_payouts` cover the REST data paths. Shopify’s `read_orders` scope only covers the most recent **60 days**; older history additionally requires Shopify-approved `read_all_orders` ([scope guide](https://shopify.dev/docs/api/usage/access-scopes)).

## Verification performed

- **TypeScript clean; 72 tests passed, 2 optional third-party credential tests skipped.** Fixtures cover signed chargeback debits, partial/full reversals, fee refunds and standalone fees; actual zero versus estimated charge fees; denied payout permissions; 11 balance pages; dispute date/status validation; missing historical-order scope; New York/Athens/India timezone boundaries and DST; unclassified signed movement; Facebook currency failures; month-end/leap-day expenses; and route-level profit reconciliation.
- The **Vercel-shaped Function** passed a local Supabase-backed signup/tenant-isolation/COGS/encrypted-token smoke test.
- The new **Vercel production deployment** reached `READY`, acquired the existing production domain, returned HTTP 200 for health and assets, passed the same HTTPS production smoke test, cleaned up both fake users, and showed no recent runtime errors.
- **Not performed:** a real order/refund/chargeback/fee comparison against the merchant’s Shopify Payments balance ledger, because the Beprofit app has no Shopify connection and the separate plugin lacks payout access. Tests prove behavior for documented fixtures, **not the completeness of this merchant’s books**.

## Remaining accuracy boundaries

1. **Connect the actual store before judging its profit.** In Beprofit’s **Connections** tab, enter the exact `*.myshopify.com` domain and a Shopify Admin custom-app token with `read_orders`, `read_shopify_payments_disputes`, and `read_shopify_payments_payouts`. Add Shopify-approved `read_all_orders` if older periods matter. Reinstall/reissue the token after changing scopes. **Do not send tokens in chat.** The app verifies all three read endpoints before saving its encrypted token; its connection is separate from the Manus Shopify plugin.
2. **Reconcile real cases.** Choose a day with an actual Shopify Payments dispute debit, a later won/lost outcome and any fee credit. Compare Beprofit’s period rows with Shopify Payments balance transaction `processed_at`, `type`, `source_type`, signed `amount`, `fee`, `net` and `currency`. A `won` case is not automatically a cash recovery. If the plugin is to assist the comparison, its Shopify authorization separately needs `read_shopify_payments_accounts` or `read_shopify_payments` plus payout access; its current account query was denied.
3. **Other gateways are outside this ledger.** PayPal, Stripe/other processors, their refunds, fees and disputes require separate integration or manually reconciled expenses. Missing product COGS, shipping profiles, restocked/cancelled orders, returns and order edits likewise require store-specific accounting choices. Unclassified Shopify ledger rows are disclosed with a signed net amount but are not guessed into costs or revenue.
4. **Foreign-currency figures are approximate.** EUR amounts use a current EUR/USD estimate, **not transaction-date settlement FX**; unsupported order/ledger currencies stop the calculation. The UI now uses the exact rate returned by the backend for secondary EUR displays. Shopify warns that Payments activity differs from an order-sales report and can lag ([activity report](https://help.shopify.com/en/manual/payments/shopify-payments/payouts/payouts-activity-report)).
5. **Source-control gap:** this release was uploaded directly to Vercel. The public GitHub `main` has not received these audit corrections because the GitHub connector is disabled for this task. The accompanying secret-free source ZIP preserves the changes; enable GitHub and merge them before configuring Git-connected auto-deploy, or a future GitHub deployment could replace the corrected site with the older formula.

**Bottom line:** the deployed logic no longer treats a won dispute as automatic revenue or charges a guessed fixed fee; it uses actual signed Shopify Payments postings when available. The correct next step for a merchant-specific, line-by-line certification is to connect Beprofit to Shopify Payments with the scopes above and compare an actual payout period—not to claim certainty from synthetic tests alone.

## Source-control update — 8 October 2026

GitHub access was enabled with the owner's confirmation. This dedicated `fix/shopify-profit-ledger` branch preserves the audited production source, its regression tests, Docker dependency-layer fix and Vercel adapter in [stelioskoul/profit-tracker](https://github.com/stelioskoul/profit-tracker), the renamed `beprofit-alternative` repository. It passed the same **72 tests** (2 optional credential checks skipped), TypeScript, normal production build and Vercel package build; the rebuilt frontend and server bundle hashes matched the saved production release. The historical source-control gap above describes the 2 October state. These changes are prepared for a reviewable PR and need merging before they are present in `main`. No protected credentials, generated build outputs or live data are included, and Vercel auto-deploy is not enabled. The unresolved live Shopify reconciliation limits are unchanged.
