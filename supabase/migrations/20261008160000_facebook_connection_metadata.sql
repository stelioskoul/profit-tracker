-- Existing table, ownership checks and private server role remain in place.
ALTER TABLE public.facebook_connections ADD COLUMN IF NOT EXISTS "adAccountName" varchar(255);
ALTER TABLE public.facebook_connections ADD COLUMN IF NOT EXISTS "tokenType" varchar(32);
