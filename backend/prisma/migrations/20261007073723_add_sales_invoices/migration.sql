-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" SERIAL NOT NULL,
    "invoice_number" TEXT,
    "source_type" "SalesSourceType" NOT NULL DEFAULT 'OPERATIONAL',
    "customer_id" INTEGER NOT NULL,
    "sales_order_id" INTEGER,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_name" TEXT NOT NULL,
    "customer_economic_code" TEXT,
    "billing_address_text" TEXT,
    "payment_term_name" TEXT,
    "payment_due_days" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "credited_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "payment_status" "SalesPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "note" TEXT,
    "posted_by_user_id" INTEGER,
    "posted_at" TIMESTAMP(3),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_items" (
    "id" SERIAL NOT NULL,
    "sales_invoice_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "delivery_item_id" INTEGER,
    "sales_order_item_id" INTEGER,
    "item_id" INTEGER,
    "item_code" TEXT,
    "item_name" TEXT NOT NULL,
    "unit_name" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(15,0) NOT NULL,
    "discount_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,0) NOT NULL,
    "credited_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_invoice_number_key" ON "sales_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "sales_invoices_customer_id_status_idx" ON "sales_invoices"("customer_id", "status");

-- CreateIndex
CREATE INDEX "sales_invoices_sales_order_id_idx" ON "sales_invoices"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_invoices_due_date_idx" ON "sales_invoices"("due_date");

-- CreateIndex
CREATE INDEX "sales_invoice_items_delivery_item_id_idx" ON "sales_invoice_items"("delivery_item_id");

-- CreateIndex
CREATE INDEX "sales_invoice_items_sales_order_item_id_idx" ON "sales_invoice_items"("sales_order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_items_sales_invoice_id_line_no_key" ON "sales_invoice_items"("sales_invoice_id", "line_no");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_posted_by_user_id_fkey" FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_delivery_item_id_fkey" FOREIGN KEY ("delivery_item_id") REFERENCES "delivery_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level backstops for the invoice invariants (SalesInvoicesService
-- enforces them first, with Persian messages; these only catch a bug).
-- Added by hand — Prisma has no CHECK syntax.
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_amounts_non_negative"
  CHECK ("unit_price" >= 0 AND "discount_amount" >= 0 AND "tax_amount" >= 0 AND "line_total" >= 0);
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_credited_within_quantity"
  CHECK ("credited_qty" >= 0 AND "credited_qty" <= "quantity");
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_settlement_within_total"
  CHECK ("paid_amount" >= 0 AND "credited_amount" >= 0 AND "paid_amount" + "credited_amount" <= "total_amount");
-- An OPERATIONAL invoice always belongs to an order; only an opening balance
-- has none.
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_order_by_source"
  CHECK (("source_type" = 'OPERATIONAL' AND "sales_order_id" IS NOT NULL) OR ("source_type" = 'OPENING_BALANCE' AND "sales_order_id" IS NULL));
-- An order line can never be invoiced beyond what was delivered. Nothing has
-- written invoiced_qty before this batch (every row is 0), so this applies
-- cleanly.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_invoiced_within_delivered"
  CHECK ("invoiced_qty" <= "delivered_qty");
