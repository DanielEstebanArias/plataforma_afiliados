ALTER TABLE "AffiliateNetwork" ADD COLUMN "modules" JSONB NOT NULL DEFAULT '{"access":true,"dashboard":true,"form":true}';
