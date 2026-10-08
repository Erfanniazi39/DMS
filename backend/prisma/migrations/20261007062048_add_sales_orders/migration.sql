-- CreateEnum
CREATE TYPE "SalesSourceType" AS ENUM ('OPERATIONAL', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesDeliveryStatus" AS ENUM ('NOT_DELIVERED', 'PARTIALLY_DELIVERED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "SalesInvoicingStatus" AS ENUM ('NOT_INVOICED', 'PARTIALLY_INVOICED', 'INVOICED');

-- CreateEnum
CREATE TYPE "SalesPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" SERIAL NOT NULL,
    "order_number" TEXT,
    "order_date" TIMESTAMP(3) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_economic_code" TEXT,
    "delivery_address_id" INTEGER,
    "delivery_address_text" TEXT,
    "payment_term_id" INTEGER,
    "payment_term_name" TEXT,
    "payment_due_days" INTEGER NOT NULL DEFAULT 0,
    "salesperson_employee_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "customer_reference" TEXT,
    "requested_delivery_date" TIMESTAMP(3),
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "delivery_status" "SalesDeliveryStatus" NOT NULL DEFAULT 'NOT_DELIVERED',
    "invoicing_status" "SalesInvoicingStatus" NOT NULL DEFAULT 'NOT_INVOICED',
    "payment_status" "SalesPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "approval_reason" TEXT,
    "approved_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "credit_override_by_user_id" INTEGER,
    "credit_override_at" TIMESTAMP(3),
    "credit_override_reason" TEXT,
    "confirmed_by_user_id" INTEGER,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_by_user_id" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "closed_by_user_id" INTEGER,
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "internal_note" TEXT,
    "customer_note" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_items" (
    "id" SERIAL NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "item_code" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "unit_name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "list_unit_price" DECIMAL(15,0),
    "unit_price" DECIMAL(15,0) NOT NULL,
    "price_override_reason" TEXT,
    "discount_percent" DECIMAL(5,2),
    "discount_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(15,0) NOT NULL,
    "reserved_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivered_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "invoiced_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_order_number_key" ON "sales_orders"("order_number");

-- CreateIndex
CREATE INDEX "sales_orders_customer_id_idx" ON "sales_orders"("customer_id");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_orders_order_date_idx" ON "sales_orders"("order_date");

-- CreateIndex
CREATE INDEX "sales_order_items_item_id_idx" ON "sales_order_items"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_items_sales_order_id_line_no_key" ON "sales_order_items"("sales_order_id", "line_no");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_delivery_address_id_fkey" FOREIGN KEY ("delivery_address_id") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_salesperson_employee_id_fkey" FOREIGN KEY ("salesperson_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_credit_override_by_user_id_fkey" FOREIGN KEY ("credit_override_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level backstops for the sales-order line invariants
-- (SalesOrdersService enforces them first, with Persian messages; these only
-- catch a bug). Added by hand — Prisma has no CHECK syntax.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_unit_price_non_negative" CHECK ("unit_price" >= 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_discount_amount_non_negative" CHECK ("discount_amount" >= 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_tax_amount_non_negative" CHECK ("tax_amount" >= 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_line_total_non_negative" CHECK ("line_total" >= 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_counters_non_negative"
  CHECK ("reserved_qty" >= 0 AND "delivered_qty" >= 0 AND "invoiced_qty" >= 0 AND "returned_qty" >= 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_reserved_within_open_qty"
  CHECK ("reserved_qty" <= "quantity" - "delivered_qty");
