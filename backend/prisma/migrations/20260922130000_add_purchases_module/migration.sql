-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchasePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHECK', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'CONTRACT', 'DELIVERY_NOTE', 'WARRANTY', 'RECEIPT', 'OTHER');

-- CreateTable
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- CreateTable
CREATE TABLE "purchase_types" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_types_code_key" ON "purchase_types"("code");

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "purchase_number" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "purchase_type_id" INTEGER NOT NULL,
    "requester_department_id" INTEGER NOT NULL,
    "buyer_employee_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "PurchasePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "total_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(15,0) NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_purchase_number_key" ON "purchases"("purchase_number");

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "unit_price" DECIMAL(15,0) NOT NULL,
    "total_price" DECIMAL(15,0) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_payments" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "amount" DECIMAL(15,0) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference_number" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,

    CONSTRAINT "purchase_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_documents" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "document_number" TEXT,
    "document_type" "DocumentType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "file_path" TEXT,
    "note" TEXT,

    CONSTRAINT "purchase_documents_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_purchase_type_id_fkey" FOREIGN KEY ("purchase_type_id") REFERENCES "purchase_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_requester_department_id_fkey" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_employee_id_fkey" FOREIGN KEY ("buyer_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_documents" ADD CONSTRAINT "purchase_documents_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
