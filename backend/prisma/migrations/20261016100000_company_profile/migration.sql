-- Company profile (مشخصات شرکت): the company's own details printed on
-- invoices and other documents. Additive. One row only (id = 1).
CREATE TABLE "company_profile" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "legal_name" TEXT NOT NULL DEFAULT '',
  "brand_name" TEXT,
  "company_type" TEXT,
  "national_id" TEXT,
  "economic_code" TEXT,
  "registration_number" TEXT,
  "province" TEXT,
  "city" TEXT,
  "postal_code" TEXT,
  "address" TEXT,
  "phone_1" TEXT,
  "phone_2" TEXT,
  "fax" TEXT,
  "email" TEXT,
  "website" TEXT,
  "document_footer" TEXT,
  "logo_path" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_profile_single_row" CHECK ("id" = 1)
);
INSERT INTO "company_profile" ("id") VALUES (1);

-- New permission; ADMIN holds it, other roles can be granted it on the roles screen.
INSERT INTO "permissions" ("name") VALUES ('company.manage') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r, "permissions" p
WHERE r."name" = 'ADMIN' AND p."name" = 'company.manage'
ON CONFLICT DO NOTHING;
