-- CreateEnum
CREATE TYPE "SupplierKind" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');

-- AlterTable
ALTER TABLE "customer_addresses" ADD COLUMN     "city_code" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "location_name" TEXT,
ADD COLUMN     "location_number" TEXT;

-- AlterTable
ALTER TABLE "customer_payments" ADD COLUMN     "deposit_id" TEXT,
ADD COLUMN     "destination_account" TEXT,
ADD COLUMN     "destination_account_holder" TEXT,
ADD COLUMN     "source_account" TEXT,
ADD COLUMN     "transaction_time" TEXT,
ADD COLUMN     "transaction_type" TEXT,
ADD COLUMN     "withdrawal_id" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "fax" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone_2" TEXT,
ADD COLUMN     "registration_number" TEXT,
ADD COLUMN     "tax_office_city" TEXT,
ADD COLUMN     "tax_office_province" TEXT,
ADD COLUMN     "telex" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "purchase_payments" ADD COLUMN     "deposit_id" TEXT,
ADD COLUMN     "destination_account" TEXT,
ADD COLUMN     "destination_account_holder" TEXT,
ADD COLUMN     "source_account" TEXT,
ADD COLUMN     "transaction_time" TEXT,
ADD COLUMN     "transaction_type" TEXT,
ADD COLUMN     "withdrawal_id" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "customer_city" TEXT,
ADD COLUMN     "customer_kind" "CustomerKind",
ADD COLUMN     "customer_legal_name" TEXT,
ADD COLUMN     "customer_phone" TEXT,
ADD COLUMN     "customer_postal_code" TEXT,
ADD COLUMN     "customer_province" TEXT,
ADD COLUMN     "customer_registration_number" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "address_2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "city_code" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "economic_code" TEXT,
ADD COLUMN     "fax" TEXT,
ADD COLUMN     "location_name" TEXT,
ADD COLUMN     "location_number" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "phone_2" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "registration_number" TEXT,
ADD COLUMN     "supplier_kind" "SupplierKind",
ADD COLUMN     "tax_office_city" TEXT,
ADD COLUMN     "tax_office_province" TEXT,
ADD COLUMN     "telex" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "supplier_bank_accounts" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "bank_name" TEXT,
    "account_number" TEXT,
    "sheba_number" TEXT,
    "account_holder_name" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_bank_accounts" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "bank_name" TEXT,
    "account_number" TEXT,
    "sheba_number" TEXT,
    "account_holder_name" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_bank_accounts_supplier_id_idx" ON "supplier_bank_accounts"("supplier_id");

-- CreateIndex
CREATE INDEX "customer_bank_accounts_customer_id_idx" ON "customer_bank_accounts"("customer_id");

-- AddForeignKey
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_bank_accounts" ADD CONSTRAINT "customer_bank_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added (not modelled by Prisma) ---------------------------------------

-- Legacy supplier bank columns -> supplier_bank_accounts (one default row per
-- supplier that had any bank data). Values are copied as typed; validation
-- only runs when the row is next edited. The legacy columns stay untouched.
INSERT INTO "supplier_bank_accounts" ("supplier_id", "bank_name", "account_number", "sheba_number", "is_default")
SELECT "id", NULLIF(btrim("bank_name"), ''), NULLIF(btrim("bank_account_number"), ''), NULLIF(btrim("bank_sheba_number"), ''), true
FROM "suppliers"
WHERE coalesce(btrim("bank_account_number"), '') <> '' OR coalesce(btrim("bank_sheba_number"), '') <> '';

-- Supplier kind: only unambiguous national ids are classified; the rest stay
-- NULL and the user picks on the next edit.
UPDATE "suppliers"
SET "supplier_kind" = CASE length("national_id") WHEN 10 THEN 'INDIVIDUAL'::"SupplierKind" WHEN 11 THEN 'ORGANIZATION'::"SupplierKind" END
WHERE "national_id" IS NOT NULL AND length("national_id") IN (10, 11);

-- A bank account row must carry an account number or a Sheba.
ALTER TABLE "customer_bank_accounts" ADD CONSTRAINT "customer_bank_accounts_number_or_sheba_chk"
  CHECK ("account_number" IS NOT NULL OR "sheba_number" IS NOT NULL);
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_number_or_sheba_chk"
  CHECK ("account_number" IS NOT NULL OR "sheba_number" IS NOT NULL);

-- Transaction time is "HH:MM" (24h).
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_transaction_time_chk"
  CHECK ("transaction_time" IS NULL OR "transaction_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_transaction_time_chk"
  CHECK ("transaction_time" IS NULL OR "transaction_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
