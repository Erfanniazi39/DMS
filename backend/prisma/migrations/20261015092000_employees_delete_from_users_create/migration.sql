-- employees.delete follows the old admin-only gate (users.create) exactly, for roles
-- and for per-user grants (the earlier cleanup used employees.manage as its base).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", pn."id" FROM "role_permissions" rp
JOIN "permissions" po ON po."id" = rp."permission_id" AND po."name" = 'users.create'
JOIN "permissions" pn ON pn."name" = 'employees.delete'
ON CONFLICT DO NOTHING;
INSERT INTO "user_permissions" ("user_id", "permission_id")
SELECT up."user_id", pn."id" FROM "user_permissions" up
JOIN "permissions" po ON po."id" = up."permission_id" AND po."name" = 'users.create'
JOIN "permissions" pn ON pn."name" = 'employees.delete'
ON CONFLICT DO NOTHING;
