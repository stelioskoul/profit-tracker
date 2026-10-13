ALTER TABLE public.paypal_connections ADD COLUMN "shopId" varchar(32);
ALTER TABLE public.paypal_connections ADD COLUMN "allocationMode" varchar(20) NOT NULL DEFAULT 'dedicated';
ALTER TABLE public.paypal_connections DROP CONSTRAINT "paypal_connections_accountNumber_key";
ALTER TABLE public.paypal_connections ADD CONSTRAINT paypal_allocation_mode CHECK (
  "allocationMode" = 'dedicated' OR ("allocationMode" = 'shopify' AND "shopId" IS NOT NULL AND "shopId" ~ '^[1-9][0-9]*$')
);
CREATE UNIQUE INDEX paypal_account_shop_unique ON public.paypal_connections ("accountNumber", "shopId");

-- Shared accounts cannot cross users or overlap with a full-account allocation.
CREATE FUNCTION public.check_paypal_account_allocation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE owner_id integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."accountNumber"));
  SELECT "userId" INTO owner_id FROM public.stores WHERE id = NEW."storeId";
  IF EXISTS (
    SELECT 1 FROM public.paypal_connections c JOIN public.stores s ON s.id = c."storeId"
    WHERE c."accountNumber" = NEW."accountNumber" AND c.id <> NEW.id
      AND (s."userId" <> owner_id OR c."allocationMode" <> 'shopify' OR NEW."allocationMode" <> 'shopify')
  ) THEN RAISE EXCEPTION 'PayPal accounts require non-overlapping allocations within one owner'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_paypal_account_allocation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER paypal_account_allocation_guard BEFORE INSERT OR UPDATE ON public.paypal_connections
  FOR EACH ROW EXECUTE FUNCTION public.check_paypal_account_allocation();
