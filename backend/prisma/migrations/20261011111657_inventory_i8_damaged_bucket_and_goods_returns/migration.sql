-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "damaged_qty" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_balances" ADD COLUMN     "damaged" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_batch_balances" ADD COLUMN     "damaged" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "goods_returns" (
    "id" SERIAL NOT NULL,
    "return_number" TEXT,
    "location_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "goods_receipt_id" INTEGER,
    "purchase_return_id" INTEGER,
    "purchase_return_number" TEXT,
    "return_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "StockDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_return_items" (
    "id" SERIAL NOT NULL,
    "goods_return_id" INTEGER NOT NULL,
    "goods_receipt_item_id" INTEGER,
    "item_id" INTEGER NOT NULL,
    "batch_id" INTEGER,
    "from_bucket" "StockBucket" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "goods_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_returns_return_number_key" ON "goods_returns"("return_number");

-- CreateIndex
CREATE INDEX "goods_returns_supplier_id_idx" ON "goods_returns"("supplier_id");

-- CreateIndex
CREATE INDEX "goods_returns_status_idx" ON "goods_returns"("status");

-- CreateIndex
CREATE INDEX "goods_return_items_goods_return_id_idx" ON "goods_return_items"("goods_return_id");

-- CreateIndex
CREATE INDEX "goods_return_items_item_id_idx" ON "goods_return_items"("item_id");

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_goods_return_id_fkey" FOREIGN KEY ("goods_return_id") REFERENCES "goods_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "stock_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added CHECK constraints (I8, build plan §5.8/B9) — same convention as
-- I3/I4/I5's hand-added CHECKs: the DTO/service reject these first with a
-- Persian message; these are the database-level backstop. None of them
-- references an enum value added in this round (that went in its own prior
-- migration, Postgres ALTER TYPE … ADD VALUE restriction).
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_damaged_non_negative" CHECK ("damaged" >= 0);
ALTER TABLE "stock_batch_balances" ADD CONSTRAINT "stock_batch_balances_damaged_check" CHECK ("damaged" >= 0);
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "goods_return_items" ADD CONSTRAINT "goods_return_items_from_bucket_check" CHECK ("from_bucket" IN ('ON_HAND', 'QC', 'DAMAGED'));
