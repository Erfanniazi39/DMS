-- CreateTable
CREATE TABLE "item_stock_levels" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "min_qty" DECIMAL(12,2) NOT NULL,
    "reorder_qty" DECIMAL(12,2),
    "max_qty" DECIMAL(12,2),
    "note" TEXT,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_stock_levels_item_id_location_id_key" ON "item_stock_levels"("item_id", "location_id");

-- AddForeignKey
ALTER TABLE "item_stock_levels" ADD CONSTRAINT "item_stock_levels_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_stock_levels" ADD CONSTRAINT "item_stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_stock_levels" ADD CONSTRAINT "item_stock_levels_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added (not modelled by Prisma): build plan §5.3's two CHECK
-- constraints. The DTO (stock-levels.dto.ts) enforces the same two rules
-- first, so a user sees a clean Persian message, not a raw constraint
-- violation — these are a database-level backstop, same convention as the
-- stock_movements append-only trigger (I1).
ALTER TABLE "item_stock_levels" ADD CONSTRAINT "item_stock_levels_min_qty_check" CHECK ("min_qty" >= 0);
ALTER TABLE "item_stock_levels" ADD CONSTRAINT "item_stock_levels_max_qty_check" CHECK ("max_qty" IS NULL OR "max_qty" >= "min_qty");
