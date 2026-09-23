-- Add new Employee master-data fields: national ID, split phone numbers,
-- and birth date. "hire_date" and "note" already existed.
ALTER TABLE "employees" ADD COLUMN "national_id" TEXT;
ALTER TABLE "employees" ADD COLUMN "mobile_phone" TEXT;
ALTER TABLE "employees" ADD COLUMN "landline_phone" TEXT;
ALTER TABLE "employees" ADD COLUMN "birth_date" TIMESTAMP(3);

-- Preserve any phone numbers already on file: copy the old single "phone"
-- column into "mobile_phone" before dropping it, so no existing data is lost.
UPDATE "employees" SET "mobile_phone" = "phone" WHERE "phone" IS NOT NULL;

ALTER TABLE "employees" DROP COLUMN "phone";

-- National ID must be unique when present. Postgres allows any number of
-- rows with NULL in a unique column, so employees with no national ID on
-- file yet are unaffected.
CREATE UNIQUE INDEX "employees_national_id_key" ON "employees"("national_id");
