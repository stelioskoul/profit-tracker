CREATE TABLE public.stripe_connections (
  id serial PRIMARY KEY,
  "storeId" integer NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  "accountId" varchar(255) NOT NULL UNIQUE,
  "accountName" varchar(255) NOT NULL,
  "shopDomain" varchar(255) NOT NULL,
  "apiKey" text NOT NULL,
  "connectedAt" timestamptz NOT NULL DEFAULT now()
);
-- Custom application auth: tRPC checks store ownership before every operation.
-- No direct browser/Data API access to encrypted credentials.
ALTER TABLE public.stripe_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stripe_connections_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_connections TO beprofit_app;
GRANT USAGE, SELECT ON public.stripe_connections_id_seq TO beprofit_app;
CREATE POLICY beprofit_app_stripe_connections_access ON public.stripe_connections
  FOR ALL TO beprofit_app USING (true) WITH CHECK (true);
