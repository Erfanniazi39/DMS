-- AlterEnum
ALTER TYPE "PurchaseRequestStatus" ADD VALUE 'PARTIALLY_PURCHASED';

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "purchase_request_item_id" INTEGER;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_request_item_id_fkey" FOREIGN KEY ("purchase_request_item_id") REFERENCES "purchase_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
