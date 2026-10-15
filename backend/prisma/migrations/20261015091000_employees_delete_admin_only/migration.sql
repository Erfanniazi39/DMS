-- Deleting employee data (contracts, photo, departments) stays admin-only, as decided
-- earlier. employees.delete is held by roles/users that also hold users.create (ADMIN).
DELETE FROM "role_permissions" rp USING "permissions" p
WHERE rp."permission_id" = p."id" AND p."name" = 'employees.delete'
  AND rp."role_id" NOT IN (SELECT r."role_id" FROM "role_permissions" r JOIN "permissions" q ON q."id" = r."permission_id" WHERE q."name" = 'users.create');
DELETE FROM "user_permissions" up USING "permissions" p
WHERE up."permission_id" = p."id" AND p."name" = 'employees.delete'
  AND up."user_id" NOT IN (SELECT u."id" FROM "users" u JOIN "role_permissions" r ON r."role_id" = u."role_id" JOIN "permissions" q ON q."id" = r."permission_id" WHERE q."name" = 'users.create');
