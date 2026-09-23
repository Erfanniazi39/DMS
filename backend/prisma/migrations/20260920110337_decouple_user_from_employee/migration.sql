/*
  Warnings:

  - You are about to drop the column `employee_id` on the `users` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_employee_id_fkey";

-- DropIndex
DROP INDEX "users_employee_id_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "employee_id",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;
