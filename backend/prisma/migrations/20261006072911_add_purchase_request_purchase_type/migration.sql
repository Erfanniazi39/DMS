-- PurchaseRequest.purchaseTypeId (required, business decision 2026-10-06).
-- Hand-edited from Prisma's generated "ADD COLUMN ... NOT NULL" so existing
-- rows are backfilled first: add nullable -> backfill -> SET NOT NULL -> FK.
-- Purely additive: no DROP, no row deleted or rewritten beyond the new column.

-- 1. Add the column as nullable.
ALTER TABLE "purchase_requests" ADD COLUMN "purchase_type_id" INTEGER;

-- 2a. Requests that already led to at least one Purchase take that
--     Purchase's purchase type (earliest linked purchase by id).
UPDATE "purchase_requests" AS pr
SET "purchase_type_id" = p."purchase_type_id"
FROM (
  SELECT DISTINCT ON ("purchase_request_id") "purchase_request_id", "purchase_type_id"
  FROM "purchases"
  WHERE "purchase_request_id" IS NOT NULL
  ORDER BY "purchase_request_id", "id" ASC
) AS p
WHERE p."purchase_request_id" = pr."id";

-- 2b. Requests with no linked Purchase default to id 1 (raw_material /
--     "مواد اولیه" — lowest sort-order active PurchaseType in the dev DB).
UPDATE "purchase_requests"
SET "purchase_type_id" = 1
WHERE "purchase_type_id" IS NULL;

-- 3. Now every row has a value.
ALTER TABLE "purchase_requests" ALTER COLUMN "purchase_type_id" SET NOT NULL;

-- 4. Foreign key (same ON DELETE RESTRICT as purchases.purchase_type_id).
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_purchase_type_id_fkey" FOREIGN KEY ("purchase_type_id") REFERENCES "purchase_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
