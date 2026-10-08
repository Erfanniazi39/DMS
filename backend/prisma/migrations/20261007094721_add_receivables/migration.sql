-- CreateEnum
CREATE TYPE "CustomerPaymentDirection" AS ENUM ('RECEIPT', 'REFUND');

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" SERIAL NOT NULL,
    "payment_number" TEXT NOT NULL,
    "direction" "CustomerPaymentDirection" NOT NULL DEFAULT 'RECEIPT',
    "customer_id" INTEGER NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,0) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "reference_number" TEXT,
    "cheque_due_date" TIMESTAMP(3),
    "bank_name" TEXT,
    "note" TEXT,
    "cancelled_by_user_id" INTEGER,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "source_payment_id" INTEGER,
    "source_credit_note_id" INTEGER,
    "target_invoice_id" INTEGER,
    "target_refund_id" INTEGER,
    "amount" DECIMAL(15,0) NOT NULL,
    "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_by_user_id" INTEGER,
    "reversed_at" TIMESTAMP(3),
    "reversed_by_user_id" INTEGER,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_payment_number_key" ON "customer_payments"("payment_number");

-- CreateIndex
CREATE INDEX "customer_payments_customer_id_idx" ON "customer_payments"("customer_id");

-- CreateIndex
CREATE INDEX "customer_payments_status_idx" ON "customer_payments"("status");

-- CreateIndex
CREATE INDEX "payment_allocations_customer_id_idx" ON "payment_allocations"("customer_id");

-- CreateIndex
CREATE INDEX "payment_allocations_target_invoice_id_idx" ON "payment_allocations"("target_invoice_id");

-- CreateIndex
CREATE INDEX "payment_allocations_source_payment_id_idx" ON "payment_allocations"("source_payment_id");

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_invoice_id_fkey" FOREIGN KEY ("target_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_allocated_by_user_id_fkey" FOREIGN KEY ("allocated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_reversed_by_user_id_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-level backstops (CustomerPaymentsService / PaymentAllocationsService
-- enforce these first, with Persian messages; these only catch a bug).
-- Added by hand — Prisma has no CHECK syntax.
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_amount_positive" CHECK ("amount" > 0);

-- build plan §4.3: exactly one credit source (a RECEIPT payment or, from
-- Batch 6, a credit note) and exactly one debit target (an invoice or, from
-- Batch 6, a refund payment), and a strictly positive amount.
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_shape"
  CHECK (num_nonnulls("source_payment_id", "source_credit_note_id") = 1
     AND num_nonnulls("target_invoice_id", "target_refund_id") = 1
     AND "amount" > 0);
