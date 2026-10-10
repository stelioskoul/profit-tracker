ALTER TABLE public.facebook_connections
  ADD COLUMN "spendFromDate" varchar(10),
  ADD COLUMN "spendToDate" varchar(10),
  ADD CONSTRAINT facebook_spend_from_valid CHECK ("spendFromDate" IS NULL OR "spendFromDate"::date::text = "spendFromDate"),
  ADD CONSTRAINT facebook_spend_to_valid CHECK ("spendToDate" IS NULL OR "spendToDate"::date::text = "spendToDate"),
  ADD CONSTRAINT facebook_spend_dates_ordered CHECK ("spendFromDate" IS NULL OR "spendToDate" IS NULL OR "spendFromDate" <= "spendToDate");
-- NULL is the default: new and existing stores keep all requested advertising
-- dates unless an owner explicitly configures this connection's range.
