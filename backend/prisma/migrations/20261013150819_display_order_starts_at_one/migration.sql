-- AlterTable
ALTER TABLE "customer_groups" ALTER COLUMN "sort_order" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "item_categories" ALTER COLUMN "sort_order" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "payment_terms" ALTER COLUMN "sort_order" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "territories" ALTER COLUMN "sort_order" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "units" ALTER COLUMN "sort_order" SET DEFAULT 1;

-- Hand-added (not modelled by Prisma) ---------------------------------------
-- «ترتیب نمایش» now starts at 1, not 0 (owner, 2026-10-13). Shift each
-- reference table up by one — keeping the current order, ties included —
-- only when its lowest value is 0, so re-running or an already-shifted table
-- changes nothing.
UPDATE "units" SET "sort_order" = "sort_order" + 1 WHERE (SELECT min("sort_order") FROM "units") = 0;
UPDATE "customer_groups" SET "sort_order" = "sort_order" + 1 WHERE (SELECT min("sort_order") FROM "customer_groups") = 0;
UPDATE "territories" SET "sort_order" = "sort_order" + 1 WHERE (SELECT min("sort_order") FROM "territories") = 0;
UPDATE "payment_terms" SET "sort_order" = "sort_order" + 1 WHERE (SELECT min("sort_order") FROM "payment_terms") = 0;
UPDATE "item_categories" SET "sort_order" = "sort_order" + 1 WHERE (SELECT min("sort_order") FROM "item_categories") = 0;
