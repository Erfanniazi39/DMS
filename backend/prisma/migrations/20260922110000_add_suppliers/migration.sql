-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('active', 'inactive', 'blacklisted');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "bank_info" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'active',
    "note" TEXT,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");
