-- Customer module foundation ("Migration A", business decisions 2026-10-06).
-- Hand-written from `prisma migrate diff` output. Purely additive:
--   * no DROP of any column, table, type or row;
--   * customers.code is RENAMED to legacy_code (data + unique index kept),
--     not dropped-and-recreated as Prisma's generated diff would have done;
--   * the old customer_type / address / note columns stay in place, untouched,
--     as a safety net (customer_type only loses its NOT NULL so new customers
--     — which have no legacy type — can be inserted). Dropping them is a
--     separate future migration that needs fresh explicit confirmation.
-- Order: new types/tables -> nullable columns -> seed reference data ->
-- backfill -> SET NOT NULL -> indexes/FKs.

-- 1. Enums -----------------------------------------------------------------
CREATE TYPE "CustomerKind" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "CustomerAddressType" AS ENUM ('BILLING', 'DELIVERY', 'OTHER');
CREATE TYPE "CustomerNoteType" AS ENUM ('GENERAL', 'WARNING', 'DELIVERY', 'FINANCE');
CREATE TYPE "CustomerDocumentType" AS ENUM ('BUSINESS_LICENSE', 'REGISTRATION', 'IDENTITY', 'CONTRACT', 'TAX', 'SCANNED_PAPER_RECORD', 'OTHER');
CREATE TYPE "ComplaintSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- 2. Audit log: optional field-level diff ----------------------------------
ALTER TABLE "audit_logs" ADD COLUMN "changes" JSONB;

-- 3. Reference tables --------------------------------------------------------
CREATE TABLE "customer_groups" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_groups_code_key" ON "customer_groups"("code");

CREATE TABLE "territories" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "territories_code_key" ON "territories"("code");

CREATE TABLE "payment_terms" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "due_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_terms_code_key" ON "payment_terms"("code");

-- 4. Seed reference data -----------------------------------------------------
-- Same four values as the old CustomerType enum, with the exact Persian
-- labels the old customers page used (decision 1: don't rename).
INSERT INTO "customer_groups" ("code", "name_en", "name_fa", "sort_order") VALUES
    ('retail',      'Retail',      'خرده‌فروشی',   0),
    ('wholesale',   'Wholesale',   'عمده‌فروشی',   1),
    ('distributor', 'Distributor', 'توزیع‌کننده',  2),
    ('other',       'Other',       'سایر',         3);

-- Decision 6. Seeded but assigned to nobody.
INSERT INTO "payment_terms" ("code", "name_en", "name_fa", "due_days", "sort_order") VALUES
    ('cash',  'Cash',   'نقد',       0,  0),
    ('net7',  'Net 7',  '۷ روزه',    7,  1),
    ('net15', 'Net 15', '۱۵ روزه',   15, 2),
    ('net30', 'Net 30', '۳۰ روزه',   30, 3);

-- 5. customers: rename code -> legacy_code (keeps data and unique index) ----
ALTER TABLE "customers" RENAME COLUMN "code" TO "legacy_code";
ALTER INDEX "customers_code_key" RENAME TO "customers_legacy_code_key";
ALTER TABLE "customers" ALTER COLUMN "legacy_code" DROP NOT NULL;

-- 6. customers: new columns, nullable first ----------------------------------
ALTER TABLE "customers"
    ADD COLUMN "customer_number" TEXT,
    ADD COLUMN "customer_kind" "CustomerKind",
    ADD COLUMN "legal_name" TEXT,
    ADD COLUMN "national_id" TEXT,
    ADD COLUMN "economic_code" TEXT,
    ADD COLUMN "customer_group_id" INTEGER,
    ADD COLUMN "territory_id" INTEGER,
    ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "status_reason" TEXT,
    ADD COLUMN "status_changed_at" TIMESTAMP(3),
    ADD COLUMN "created_by_user_id" INTEGER;

-- Legacy column relaxed (not dropped): new customers have no CustomerType.
ALTER TABLE "customers" ALTER COLUMN "customer_type" DROP NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- 7. Backfill existing customers ---------------------------------------------
UPDATE "customers"
SET "customer_number" = 'CUS-' || lpad("id"::text, 6, '0'),
    "customer_kind"   = 'ORGANIZATION',
    "status"          = 'ACTIVE';

UPDATE "customers" AS c
SET "customer_group_id" = g."id"
FROM "customer_groups" AS g
WHERE g."code" = c."customer_type"::text;

-- 8. Child tables ------------------------------------------------------------
CREATE TABLE "customer_contacts" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "role_title" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_addresses" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "address_type" "CustomerAddressType" NOT NULL,
    "label" TEXT,
    "province" TEXT,
    "city" TEXT,
    "address_line" TEXT NOT NULL,
    "postal_code" TEXT,
    "phone" TEXT,
    "delivery_instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_financial_profiles" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "payment_term_id" INTEGER,
    "preferred_payment_method" "PaymentMethod",
    "credit_limit" DECIMAL(15,0),
    "credit_hold" BOOLEAN NOT NULL DEFAULT false,
    "credit_hold_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_financial_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_notes" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "note_type" "CustomerNoteType" NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_documents" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "document_type" "CustomerDocumentType" NOT NULL,
    "document_number" TEXT,
    "date" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "file_path" TEXT,
    "note" TEXT,
    "uploaded_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_complaints" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ComplaintSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "owner_user_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_complaints_pkey" PRIMARY KEY ("id")
);

-- 9. Copy legacy address / note into the new child tables --------------------
-- (old columns are left untouched). No created_by — the original author
-- was never recorded.
INSERT INTO "customer_addresses" ("customer_id", "address_type", "address_line", "is_default")
SELECT "id", 'DELIVERY', btrim("address"), true
FROM "customers"
WHERE "address" IS NOT NULL AND btrim("address") <> '';

INSERT INTO "customer_notes" ("customer_id", "note_type", "body", "created_at")
SELECT "id", 'GENERAL', btrim("note"), "created_at"
FROM "customers"
WHERE "note" IS NOT NULL AND btrim("note") <> '';

-- One empty financial profile per customer (decision 6: no payment term,
-- no credit limit, no hold).
INSERT INTO "customer_financial_profiles" ("customer_id", "credit_hold")
SELECT "id", false FROM "customers";

-- 10. Now every row has a value ----------------------------------------------
ALTER TABLE "customers" ALTER COLUMN "customer_number" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "customer_kind" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "customer_group_id" SET NOT NULL;

-- 11. Indexes -----------------------------------------------------------------
CREATE UNIQUE INDEX "customers_customer_number_key" ON "customers"("customer_number");
CREATE UNIQUE INDEX "customers_national_id_key" ON "customers"("national_id");
CREATE INDEX "customers_customer_group_id_idx" ON "customers"("customer_group_id");
CREATE INDEX "customers_status_idx" ON "customers"("status");
CREATE INDEX "customers_phone_idx" ON "customers"("phone");
CREATE INDEX "customer_contacts_customer_id_idx" ON "customer_contacts"("customer_id");
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");
CREATE UNIQUE INDEX "customer_financial_profiles_customer_id_key" ON "customer_financial_profiles"("customer_id");
CREATE INDEX "customer_notes_customer_id_idx" ON "customer_notes"("customer_id");
CREATE INDEX "customer_documents_customer_id_idx" ON "customer_documents"("customer_id");
CREATE INDEX "customer_complaints_customer_id_idx" ON "customer_complaints"("customer_id");

-- 12. Foreign keys ------------------------------------------------------------
ALTER TABLE "customers" ADD CONSTRAINT "customers_customer_group_id_fkey" FOREIGN KEY ("customer_group_id") REFERENCES "customer_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_financial_profiles" ADD CONSTRAINT "customer_financial_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_financial_profiles" ADD CONSTRAINT "customer_financial_profiles_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_complaints" ADD CONSTRAINT "customer_complaints_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
