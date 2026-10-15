-- Admin panel: per-module delete permissions, record-restore permission, and
-- view-sensitive-data permissions for customers and suppliers.
-- Additive. New permissions are copied from the permission that gated the same
-- action before, so no custom role or per-user grant silently loses a power.

-- 1. Restore bookkeeping on the delete archive (the snapshot row is kept).
ALTER TABLE "deleted_records" ADD COLUMN "restored_at" TIMESTAMP(3);
ALTER TABLE "deleted_records" ADD COLUMN "restored_by_user_id" INTEGER;
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_restored_by_user_id_fkey"
  FOREIGN KEY ("restored_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. New permission rows.
INSERT INTO "permissions" ("name") VALUES
  ('purchases.delete'), ('sales.delete'), ('customers.delete'), ('suppliers.delete'),
  ('items.delete'), ('itemCategories.delete'), ('units.delete'), ('inventory.delete'),
  ('employees.delete'), ('records.restore'),
  ('customers.viewSensitive'), ('suppliers.viewSensitive')
ON CONFLICT ("name") DO NOTHING;

-- 3. Copy grants: (new permission, permission that used to gate it).
CREATE TEMP TABLE "_perm_copy" ("new_name" TEXT, "old_name" TEXT);
INSERT INTO "_perm_copy" VALUES
  ('purchases.delete', 'purchases.manage'),
  ('sales.delete', 'sales.manage'),
  ('suppliers.delete', 'suppliers.manage'),
  ('items.delete', 'items.manage'),
  ('inventory.delete', 'inventory.receive'),
  ('employees.delete', 'employees.manage'),
  ('customers.delete', 'users.create'),
  ('itemCategories.delete', 'users.create'),
  ('units.delete', 'users.create'),
  ('records.restore', 'users.create'),
  ('customers.viewSensitive', 'customers.manage'),
  ('customers.viewSensitive', 'customers.finance'),
  ('suppliers.viewSensitive', 'suppliers.manage');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", pn."id"
FROM "_perm_copy" c
JOIN "permissions" po ON po."name" = c."old_name"
JOIN "permissions" pn ON pn."name" = c."new_name"
JOIN "role_permissions" rp ON rp."permission_id" = po."id"
ON CONFLICT DO NOTHING;

INSERT INTO "user_permissions" ("user_id", "permission_id")
SELECT DISTINCT up."user_id", pn."id"
FROM "_perm_copy" c
JOIN "permissions" po ON po."name" = c."old_name"
JOIN "permissions" pn ON pn."name" = c."new_name"
JOIN "user_permissions" up ON up."permission_id" = po."id"
ON CONFLICT DO NOTHING;

DROP TABLE "_perm_copy";
