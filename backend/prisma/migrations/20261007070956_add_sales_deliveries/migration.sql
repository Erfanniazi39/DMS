-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateTable
CREATE TABLE "deliveries" (
    "id" SERIAL NOT NULL,
    "delivery_number" TEXT,
    "sales_order_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "delivery_date" TIMESTAMP(3) NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "delivery_address_text" TEXT,
    "carrier_note" TEXT,
    "received_by_name" TEXT,
    "note" TEXT,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_items" (
    "id" SERIAL NOT NULL,
    "delivery_id" INTEGER NOT NULL,
    "sales_order_item_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "invoiced_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_delivery_number_key" ON "deliveries"("delivery_number");

-- CreateIndex
CREATE INDEX "deliveries_sales_order_id_idx" ON "deliveries"("sales_order_id");

-- CreateIndex
CREATE INDEX "deliveries_customer_id_idx" ON "deliveries"("customer_id");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "delivery_items_delivery_id_idx" ON "delivery_items"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_items_sales_order_item_id_idx" ON "delivery_items"("sales_order_item_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level backstops for the delivery invariants (DeliveriesService
-- enforces them first, with Persian messages; these only catch a bug).
-- Added by hand — Prisma has no CHECK syntax.
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_counters_within_quantity"
  CHECK ("invoiced_qty" >= 0 AND "returned_qty" >= 0 AND "invoiced_qty" <= "quantity" AND "returned_qty" <= "quantity");
-- An order line can never be delivered beyond what was ordered. Every
-- existing row has delivered_qty = 0, so this applies cleanly.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_delivered_within_quantity"
  CHECK ("delivered_qty" <= "quantity");
