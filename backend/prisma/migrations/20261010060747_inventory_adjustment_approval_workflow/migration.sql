-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'COUNT_ERROR', 'DATA_ENTRY_ERROR', 'SAMPLE_OR_INTERNAL_USE', 'OTHER');

-- AlterEnum
ALTER TYPE "StockAdjustmentKind" ADD VALUE 'WRITE_OFF';

-- AlterEnum
ALTER TYPE "StockDocumentStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'WRITE_OFF';

-- AlterTable
ALTER TABLE "stock_adjustments" ADD COLUMN     "reason_code" "StockAdjustmentReason",
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by_user_id" INTEGER,
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "submitted_by_user_id" INTEGER;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
