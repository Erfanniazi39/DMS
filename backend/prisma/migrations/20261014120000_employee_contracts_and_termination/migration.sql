-- CreateEnum
CREATE TYPE "EmployeeExitType" AS ENUM ('resigned', 'fired', 'contract_ended', 'retired', 'other');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "termination_date" TIMESTAMP(3),
ADD COLUMN "termination_type" "EmployeeExitType",
ADD COLUMN "termination_reason" TEXT;

-- CreateTable
CREATE TABLE "employee_contracts" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "contract_type" "ContractType" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "note" TEXT,
    "document_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_contracts_employee_id_start_date_idx" ON "employee_contracts"("employee_id", "start_date");

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every employee that had a single contract recorded gets it as the
-- first row of the new history (start falls back to the hire date). The legacy
-- columns are left untouched.
INSERT INTO "employee_contracts" ("employee_id", "contract_type", "start_date", "end_date", "document_path")
SELECT "id", "contract_type", COALESCE("contract_start_date", "hire_date"), "contract_end_date", "contract_document_path"
FROM "employees"
WHERE "contract_type" IS NOT NULL AND COALESCE("contract_start_date", "hire_date") IS NOT NULL;
