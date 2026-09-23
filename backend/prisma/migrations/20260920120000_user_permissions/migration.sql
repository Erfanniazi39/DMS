CREATE TABLE "user_permissions" (
    "user_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("user_id", "permission_id")
);

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_fkey"
  FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;