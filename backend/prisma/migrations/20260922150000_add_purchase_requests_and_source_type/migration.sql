-- CreateEnum
CREATE TYPE "PurchaseSourceType" AS ENUM ('OPERATIONAL', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PurchaseRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable: an OPTIONAL business event preceding a Purchase — most
-- purchases (urgent, direct, recurring) will have no request at all.
CREATE TABLE "purchase_requests" (
    "id" SERIAL NOT NULL,
    "request_number" TEXT NOT NULL,
    "request_date" TIMESTAMP(3) NOT NULL,
    "requester_department_id" INTEGER NOT NULL,
    "requested_by_employee_id" INTEGER,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "PurchaseRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requests_request_number_key" ON "purchase_requests"("request_number");

-- CreateTable
CREATE TABLE "purchase_request_items" (
    "id" SERIAL NOT NULL,
    "purchase_request_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "required_date" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "purchase_request_items_pkey" PRIMARY KEY ("id")
);

-- AlterTable: link a Purchase to the (optional) request it originated from,
-- and mark whether it's a normal entry or a digitized paper record. Both
-- kinds of purchase stay in this same table — see PurchaseSourceType and
-- PurchasesService's handling of HISTORICAL_IMPORT.
ALTER TABLE "purchases" ADD COLUMN "purchase_request_id" INTEGER;
ALTER TABLE "purchases" ADD COLUMN "source_type" "PurchaseSourceType" NOT NULL DEFAULT 'OPERATIONAL';

-- AlterTable: requester department and buyer employee are no longer always
-- required — a digitized historical purchase may genuinely not know
-- either, and the application deliberately never fabricates an
-- Employee/Department row just to fill them in. Still required for a
-- normal (OPERATIONAL) purchase — enforced in purchase.dto.ts, not here.
ALTER TABLE "purchases" ALTER COLUMN "requester_department_id" DROP NOT NULL;
ALTER TABLE "purchases" ALTER COLUMN "buyer_employee_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requester_department_id_fkey" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_employee_id_fkey" FOREIGN KEY ("requested_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
