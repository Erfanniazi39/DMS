-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'QUALITY', 'CUSTOMER_REFUSED', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'INSPECTED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" SERIAL NOT NULL,
    "return_number" TEXT,
    "customer_id" INTEGER NOT NULL,
    "sales_order_id" INTEGER,
    "delivery_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "request_date" TIMESTAMP(3) NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "status" "SalesReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "is_unreferenced" BOOLEAN NOT NULL DEFAULT false,
    "reject_reason" TEXT,
    "note" TEXT,
    "requested_by_user_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "received_by_user_id" INTEGER,
    "received_at" TIMESTAMP(3),
    "inspected_by_user_id" INTEGER,
    "inspected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" SERIAL NOT NULL,
    "sales_return_id" INTEGER NOT NULL,
    "delivery_item_id" INTEGER,
    "item_id" INTEGER NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "unit_price" DECIMAL(15,0) NOT NULL,
    "requested_qty" DECIMAL(12,2) NOT NULL,
    "received_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "restock_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "write_off_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credited_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "condition_note" TEXT,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" SERIAL NOT NULL,
    "credit_note_number" TEXT,
    "customer_id" INTEGER NOT NULL,
    "sales_invoice_id" INTEGER NOT NULL,
    "sales_return_id" INTEGER,
    "credit_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_items" (
    "id" SERIAL NOT NULL,
    "credit_note_id" INTEGER NOT NULL,
    "sales_invoice_item_id" INTEGER NOT NULL,
    "sales_return_item_id" INTEGER,
    "quantity" DECIMAL(12,2),
    "unit_price" DECIMAL(15,0),
    "tax_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,0) NOT NULL,

    CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_return_number_key" ON "sales_returns"("return_number");

-- CreateIndex
CREATE INDEX "sales_returns_customer_id_idx" ON "sales_returns"("customer_id");

-- CreateIndex
CREATE INDEX "sales_returns_sales_order_id_idx" ON "sales_returns"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_returns_delivery_id_idx" ON "sales_returns"("delivery_id");

-- CreateIndex
CREATE INDEX "sales_returns_status_idx" ON "sales_returns"("status");

-- CreateIndex
CREATE INDEX "sales_return_items_sales_return_id_idx" ON "sales_return_items"("sales_return_id");

-- CreateIndex
CREATE INDEX "sales_return_items_delivery_item_id_idx" ON "sales_return_items"("delivery_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_credit_note_number_key" ON "credit_notes"("credit_note_number");

-- CreateIndex
CREATE INDEX "credit_notes_customer_id_idx" ON "credit_notes"("customer_id");

-- CreateIndex
CREATE INDEX "credit_notes_sales_invoice_id_idx" ON "credit_notes"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_sales_return_id_idx" ON "credit_notes"("sales_return_id");

-- CreateIndex
CREATE INDEX "credit_notes_status_idx" ON "credit_notes"("status");

-- CreateIndex
CREATE INDEX "credit_note_items_credit_note_id_idx" ON "credit_note_items"("credit_note_id");

-- CreateIndex
CREATE INDEX "payment_allocations_source_credit_note_id_idx" ON "payment_allocations"("source_credit_note_id");

-- CreateIndex
CREATE INDEX "payment_allocations_target_refund_id_idx" ON "payment_allocations"("target_refund_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_inspected_by_user_id_fkey" FOREIGN KEY ("inspected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_delivery_item_id_fkey" FOREIGN KEY ("delivery_item_id") REFERENCES "delivery_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_sales_invoice_item_id_fkey" FOREIGN KEY ("sales_invoice_item_id") REFERENCES "sales_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_sales_return_item_id_fkey" FOREIGN KEY ("sales_return_item_id") REFERENCES "sales_return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_credit_note_id_fkey" FOREIGN KEY ("source_credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_refund_id_fkey" FOREIGN KEY ("target_refund_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
