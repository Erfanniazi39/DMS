-- AlterTable: split the single "bank_info" free-text column into three
-- separate fields (bank name, account number, Sheba/IBAN number), and add
-- the supplier's national/legal registration id (شناسه ملی).
ALTER TABLE "suppliers" DROP COLUMN "bank_info",
ADD COLUMN "bank_name" TEXT,
ADD COLUMN "bank_account_number" TEXT,
ADD COLUMN "bank_sheba_number" TEXT,
ADD COLUMN "national_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_national_id_key" ON "suppliers"("national_id");
