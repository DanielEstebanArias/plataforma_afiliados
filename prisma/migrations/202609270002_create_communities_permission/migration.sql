ALTER TABLE "AffiliateNetwork" ALTER COLUMN modules SET DEFAULT '{"access":true,"dashboard":true,"form":true,"createCommunities":false}'::jsonb;
UPDATE "AffiliateNetwork" SET modules = modules || '{"createCommunities":false}'::jsonb WHERE NOT (modules ? 'createCommunities');
