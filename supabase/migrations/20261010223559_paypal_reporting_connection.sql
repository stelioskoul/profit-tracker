CREATE TABLE public.paypal_connections (
  id serial PRIMARY KEY,
  "storeId" integer NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  "accountNumber" varchar(255) NOT NULL UNIQUE,
  "shopDomain" varchar(255) NOT NULL,
  "clientId" text NOT NULL,
  "clientSecret" text NOT NULL,
  "connectedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paypal_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paypal_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.paypal_connections_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paypal_connections TO beprofit_app;
GRANT USAGE, SELECT ON public.paypal_connections_id_seq TO beprofit_app;
CREATE POLICY beprofit_app_paypal_connections_access ON public.paypal_connections
  FOR ALL TO beprofit_app USING (true) WITH CHECK (true);
