ALTER TABLE "AffiliateMember" ADD COLUMN ancestry uuid[] NOT NULL DEFAULT '{}', ADD COLUMN level integer NOT NULL DEFAULT 0;
WITH RECURSIVE branch AS (
 SELECT id, ARRAY[]::uuid[] AS ancestry, 0 AS level FROM "AffiliateMember" WHERE "parentId" IS NULL
 UNION ALL SELECT m.id, b.ancestry || m."parentId", b.level+1 FROM "AffiliateMember" m JOIN branch b ON m."parentId"=b.id
) UPDATE "AffiliateMember" m SET ancestry=b.ancestry, level=b.level FROM branch b WHERE m.id=b.id;
CREATE FUNCTION affiliate_tree_path() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW."parentId" IS DISTINCT FROM OLD."parentId" OR NEW."networkId"<>OLD."networkId" OR NEW."tenantId"<>OLD."tenantId") THEN
  RAISE EXCEPTION 'Moving an existing affiliate is not supported';
 END IF;
 IF NEW."parentId" IS NULL THEN NEW.ancestry='{}'; NEW.level=0;
 ELSE
  SELECT p.ancestry || p.id, p.level+1 INTO NEW.ancestry, NEW.level FROM "AffiliateMember" p WHERE p.id=NEW."parentId" AND p."tenantId"=NEW."tenantId" AND p."networkId"=NEW."networkId";
  IF NOT FOUND THEN RAISE EXCEPTION 'Parent not found in this community'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER affiliate_tree_path BEFORE INSERT OR UPDATE ON "AffiliateMember" FOR EACH ROW EXECUTE FUNCTION affiliate_tree_path();
CREATE INDEX "AffiliateMember_ancestry_idx" ON "AffiliateMember" USING gin(ancestry);
CREATE INDEX "AffiliateMember_network_parent_idx" ON "AffiliateMember" ("networkId","parentId",id);
