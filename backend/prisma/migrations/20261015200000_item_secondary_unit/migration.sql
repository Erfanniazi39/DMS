-- Item secondary unit (واحد فرعی): optional second unit + conversion factor.
-- Additive and nullable; `items.unit_id` stays the single stock unit.
-- factor = how many of the stock unit make ONE secondary unit (> 0).
ALTER TABLE "items" ADD COLUMN "secondary_unit_id" INTEGER;
ALTER TABLE "items" ADD COLUMN "secondary_unit_factor" DECIMAL(14,6);

ALTER TABLE "items" ADD CONSTRAINT "items_secondary_unit_id_fkey"
  FOREIGN KEY ("secondary_unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Both set or both null; the factor is positive; the secondary unit differs from the stock unit.
ALTER TABLE "items" ADD CONSTRAINT "items_secondary_unit_consistent"
  CHECK (
    ("secondary_unit_id" IS NULL AND "secondary_unit_factor" IS NULL)
    OR ("secondary_unit_id" IS NOT NULL AND "secondary_unit_factor" IS NOT NULL
        AND "secondary_unit_factor" > 0 AND "secondary_unit_id" <> "unit_id")
  );
