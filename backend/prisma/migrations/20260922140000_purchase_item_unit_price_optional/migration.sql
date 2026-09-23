-- Unit Price on a purchase item is no longer required — some purchases
-- (exceptions, items priced only as a lump sum) don't have a meaningful
-- per-unit price. Total Price stays required; it's what's actually billed.
ALTER TABLE "purchase_items" ALTER COLUMN "unit_price" DROP NOT NULL;
