-- AlterEnum
ALTER TYPE "StockAdjustmentKind" ADD VALUE 'BATCH_CUTOVER';

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "batch_id" INTEGER;

-- AlterTable
ALTER TABLE "stock_adjustment_items" ADD COLUMN     "batch_id" INTEGER,
ADD COLUMN     "batch_number" TEXT,
ADD COLUMN     "expiry_date" TIMESTAMP(3),
ADD COLUMN     "production_date" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "batch_id" INTEGER;

-- CreateTable
CREATE TABLE "inventory_item_settings" (
    "item_id" INTEGER NOT NULL,
    "batch_tracked" BOOLEAN NOT NULL DEFAULT false,
    "expiry_required" BOOLEAN NOT NULL DEFAULT false,
    "shelf_life_days" INTEGER,
    "batch_tracked_since" TIMESTAMP(3),
    "updated_by_user_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_item_settings_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "batch_number" TEXT NOT NULL,
    "production_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batch_balances" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "on_hand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qc" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batch_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_item_id_expiry_date_idx" ON "stock_batches"("item_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batches_item_id_batch_number_key" ON "stock_batches"("item_id", "batch_number");

-- CreateIndex
CREATE INDEX "stock_batch_balances_item_id_location_id_idx" ON "stock_batch_balances"("item_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_batch_balances_batch_id_location_id_key" ON "stock_batch_balances"("batch_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_batch_id_idx" ON "stock_movements"("batch_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_settings" ADD CONSTRAINT "inventory_item_settings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_item_settings" ADD CONSTRAINT "inventory_item_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batch_balances" ADD CONSTRAINT "stock_batch_balances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batch_balances" ADD CONSTRAINT "stock_batch_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added (not modelled by Prisma): build plan §5.4a's CHECK constraints,
-- same convention as I1's append-only trigger / I3's stock_levels CHECKs.
-- The DTO/service layers enforce the same rules first for a clean Persian
-- message; these are a database-level backstop.
ALTER TABLE "inventory_item_settings" ADD CONSTRAINT "inventory_item_settings_shelf_life_days_check" CHECK ("shelf_life_days" IS NULL OR "shelf_life_days" > 0);
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_expiry_after_production_check" CHECK ("expiry_date" IS NULL OR "production_date" IS NULL OR "expiry_date" >= "production_date");
ALTER TABLE "stock_batch_balances" ADD CONSTRAINT "stock_batch_balances_on_hand_check" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_batch_balances" ADD CONSTRAINT "stock_batch_balances_qc_check" CHECK ("qc" >= 0);
-- A batch never applies to the RESERVED bucket (§5.4a's schema correction) —
-- batch_id must be null whenever bucket = 'RESERVED'.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_not_reserved_check" CHECK ("batch_id" IS NULL OR "bucket" <> 'RESERVED');
