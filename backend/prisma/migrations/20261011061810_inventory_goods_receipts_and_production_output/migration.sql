-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'GOODS_RECEIPT';
ALTER TYPE "StockMovementType" ADD VALUE 'QC_RELEASE';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_OUTPUT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockReferenceType" ADD VALUE 'GOODS_RECEIPT';
ALTER TYPE "StockReferenceType" ADD VALUE 'PRODUCTION_OUTPUT';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "unit_cost" DECIMAL(15,0);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" SERIAL NOT NULL,
    "receipt_number" TEXT,
    "location_id" INTEGER NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "supplier_document_number" TEXT,
    "purchase_id" INTEGER,
    "purchase_number" TEXT,
    "inspection_required" BOOLEAN NOT NULL DEFAULT false,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" SERIAL NOT NULL,
    "goods_receipt_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(15,0),
    "batch_number" TEXT,
    "production_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "batch_id" INTEGER,
    "released_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rejected_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" SERIAL NOT NULL,
    "output_number" TEXT,
    "location_id" INTEGER NOT NULL,
    "production_date" TIMESTAMP(3) NOT NULL,
    "produced_by_employee_id" INTEGER,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_output_items" (
    "id" SERIAL NOT NULL,
    "production_output_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_cost" DECIMAL(15,0),
    "cost_is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "batch_number" TEXT,
    "production_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "batch_id" INTEGER,
    "note" TEXT,

    CONSTRAINT "production_output_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");

-- CreateIndex
CREATE INDEX "goods_receipts_supplier_id_idx" ON "goods_receipts"("supplier_id");

-- CreateIndex
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_goods_receipt_id_line_no_key" ON "goods_receipt_items"("goods_receipt_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "production_outputs_output_number_key" ON "production_outputs"("output_number");

-- CreateIndex
CREATE INDEX "production_outputs_status_idx" ON "production_outputs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "production_output_items_production_output_id_line_no_key" ON "production_output_items"("production_output_id", "line_no");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_produced_by_employee_id_fkey" FOREIGN KEY ("produced_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_output_items" ADD CONSTRAINT "production_output_items_production_output_id_fkey" FOREIGN KEY ("production_output_id") REFERENCES "production_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_output_items" ADD CONSTRAINT "production_output_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK constraints (I5, build plan §5.5/§5.11) — same convention
-- as I3/I4's hand-added CHECKs: the DTO/service reject these first with a
-- Persian message; these are the database-level backstop. None of them
-- references a new enum value added above (Postgres ALTER TYPE … ADD VALUE
-- restriction — a new value can't be used in the same transaction).
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_unit_cost_nonnegative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_qc_counters_nonnegative" CHECK ("released_qty" >= 0 AND "rejected_qty" >= 0 AND "returned_qty" >= 0);
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_qc_counters_within_quantity" CHECK ("released_qty" + "rejected_qty" <= "quantity");
ALTER TABLE "production_output_items" ADD CONSTRAINT "production_output_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "production_output_items" ADD CONSTRAINT "production_output_items_unit_cost_nonnegative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);
