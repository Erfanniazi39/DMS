-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'COUNTING', 'REVIEW', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountScope" AS ENUM ('FULL', 'PARTIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'COUNT_GAIN';
ALTER TYPE "StockMovementType" ADD VALUE 'COUNT_LOSS';

-- AlterEnum
ALTER TYPE "StockReferenceType" ADD VALUE 'STOCK_COUNT';

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" SERIAL NOT NULL,
    "count_number" TEXT,
    "location_id" INTEGER NOT NULL,
    "count_date" TIMESTAMP(3) NOT NULL,
    "scope" "StockCountScope" NOT NULL DEFAULT 'PARTIAL',
    "is_blind" BOOLEAN NOT NULL DEFAULT true,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMP(3),
    "started_by_user_id" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "posted_by_user_id" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" INTEGER,
    "cancel_reason" TEXT,
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" SERIAL NOT NULL,
    "stock_count_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "batch_id" INTEGER,
    "system_qty" DECIMAL(12,2),
    "counted_qty" DECIMAL(12,2),
    "variance_qty" DECIMAL(12,2),
    "reason_code" "StockAdjustmentReason",
    "recount_count" INTEGER NOT NULL DEFAULT 0,
    "counted_by_user_id" INTEGER,
    "note" TEXT,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_count_number_key" ON "stock_counts"("count_number");

-- CreateIndex
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");

-- CreateIndex
CREATE INDEX "stock_count_items_stock_count_id_idx" ON "stock_count_items"("stock_count_id");

-- CreateIndex
CREATE INDEX "stock_count_items_item_id_idx" ON "stock_count_items"("item_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_counted_by_user_id_fkey" FOREIGN KEY ("counted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added (not modelled by Prisma), build plan §5.6/§11 — review deliberately,
-- same flag as I4's hand-added CHECK constraints.
-- CheckConstraint: a physical count can never be negative.
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_system_qty_check" CHECK ("system_qty" IS NULL OR "system_qty" >= 0);
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_counted_qty_check" CHECK ("counted_qty" IS NULL OR "counted_qty" >= 0);

-- UniqueIndex (expression): one line per (document, item, batch) — batch_id
-- is nullable, and Prisma's @@unique treats NULLs as distinct, so a plain
-- @@unique([stockCountId, itemId, batchId]) would let the same untracked
-- item appear twice on one count. COALESCE(batch_id, 0) collapses every
-- untracked line to one key per item, same technique as the unique index
-- would need anywhere else batch_id is part of a nullable composite key.
CREATE UNIQUE INDEX "stock_count_items_unique_line" ON "stock_count_items" ("stock_count_id", "item_id", COALESCE("batch_id", 0));
