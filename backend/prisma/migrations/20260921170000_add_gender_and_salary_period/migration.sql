-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('monthly', 'weekly', 'daily');

-- AlterTable: add gender, and replace the single "monthly salary" field with
-- an amount + pay-period pair (some roles are paid daily or weekly, not just
-- monthly). "monthly_salary" was added in the previous migration and never
-- populated (still null for every existing employee), so it's dropped here
-- rather than kept alongside the new columns.
ALTER TABLE "employees" ADD COLUMN "gender" "Gender";
ALTER TABLE "employees" ADD COLUMN "salary_amount" DECIMAL(12,2);
ALTER TABLE "employees" ADD COLUMN "salary_period" "SalaryPeriod";
ALTER TABLE "employees" DROP COLUMN "monthly_salary";
