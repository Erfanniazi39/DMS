-- CreateEnum
CREATE TYPE "StockBucket" AS ENUM ('ON_HAND', 'RESERVED', 'QC');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'MANUAL_RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RESERVE', 'RELEASE', 'DELIVERY_ISSUE', 'RETURN_RECEIPT', 'RETURN_RESTOCK', 'RETURN_WRITE_OFF');

-- CreateEnum
CREATE TYPE "StockReferenceType" AS ENUM ('STOCK_ADJUSTMENT', 'SALES_ORDER', 'DELIVERY', 'SALES_RETURN');

-- CreateEnum
CREATE TYPE "StockAdjustmentKind" AS ENUM ('OPENING', 'RECEIPT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "StockDocumentStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "selling_price" DECIMAL(15,0);

-- CreateTable
CREATE TABLE "document_sequences" (
    "doc_type" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("doc_type","fiscal_year")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "on_hand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "qc" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "bucket" "StockBucket" NOT NULL,
    "movement_type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "movement_date" TIMESTAMP(3) NOT NULL,
    "reference_type" "StockReferenceType" NOT NULL,
    "reference_id" INTEGER NOT NULL,
    "reference_line_id" INTEGER,
    "reference_number" TEXT,
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" SERIAL NOT NULL,
    "adjustment_number" TEXT,
    "kind" "StockAdjustmentKind" NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "location_id" INTEGER NOT NULL,
    "adjustment_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "id" SERIAL NOT NULL,
    "stock_adjustment_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_code_key" ON "inventory_locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_item_id_location_id_key" ON "stock_balances"("item_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_item_id_location_id_idx" ON "stock_movements"("item_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_adjustment_number_key" ON "stock_adjustments"("adjustment_number");

-- CreateIndex
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments"("status");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_stock_adjustment_id_idx" ON "stock_adjustment_items"("stock_adjustment_id");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_item_id_idx" ON "stock_adjustment_items"("item_id");

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_stock_adjustment_id_fkey" FOREIGN KEY ("stock_adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added (not modelled by Prisma): database-level backstop for the
-- "stock never goes negative" invariant enforced by
-- src/inventory/stock-ledger.ts. The ledger refuses first with a Persian
-- message; these only fire if some future code bypasses it.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_on_hand_non_negative" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_reserved_non_negative" CHECK ("reserved" >= 0);
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_qc_non_negative" CHECK ("qc" >= 0);
-- A sequence counter never goes below 0.
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_last_value_non_negative" CHECK ("last_value" >= 0);
