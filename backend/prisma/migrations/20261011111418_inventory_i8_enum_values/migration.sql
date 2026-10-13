-- AlterEnum
ALTER TYPE "StockAdjustmentKind" ADD VALUE 'MARK_DAMAGED';

-- AlterEnum
ALTER TYPE "StockBucket" ADD VALUE 'DAMAGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'MARK_DAMAGED';
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_TO_DAMAGED';
ALTER TYPE "StockMovementType" ADD VALUE 'SUPPLIER_RETURN';

-- AlterEnum
ALTER TYPE "StockReferenceType" ADD VALUE 'GOODS_RETURN';
