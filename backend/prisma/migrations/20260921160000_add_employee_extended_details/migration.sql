-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('under_diploma', 'diploma', 'associate', 'bachelor', 'master', 'phd');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('single', 'married');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('permanent', 'temporary', 'fixed_task');

-- AlterTable: extended personal/employment details for Employee — all
-- nullable, so every existing row (and the 50 test employees already on
-- file) stays valid without a backfill.
ALTER TABLE "employees" ADD COLUMN "father_name" TEXT;
ALTER TABLE "employees" ADD COLUMN "address" TEXT;
ALTER TABLE "employees" ADD COLUMN "birth_certificate_number" TEXT;
ALTER TABLE "employees" ADD COLUMN "marital_status" "MaritalStatus";
ALTER TABLE "employees" ADD COLUMN "children_count" INTEGER;
ALTER TABLE "employees" ADD COLUMN "education_level" "EducationLevel";
ALTER TABLE "employees" ADD COLUMN "below_diploma_grade" TEXT;
ALTER TABLE "employees" ADD COLUMN "work_location" TEXT;
ALTER TABLE "employees" ADD COLUMN "working_hours" TEXT;
ALTER TABLE "employees" ADD COLUMN "contract_type" "ContractType";
ALTER TABLE "employees" ADD COLUMN "contract_start_date" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN "contract_end_date" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN "monthly_salary" DECIMAL(12,2);
