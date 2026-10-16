-- Configurable document-number formats. Additive; no rows = defaults (PREFIX-<year>-000001).
CREATE TABLE "numbering_formats" (
  "doc_type" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "middle_mode" TEXT NOT NULL,
  "middle_text" TEXT,
  "separator" TEXT NOT NULL DEFAULT '-',
  "digits" INTEGER NOT NULL DEFAULT 6,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "numbering_formats_pkey" PRIMARY KEY ("doc_type"),
  CONSTRAINT "numbering_formats_middle_mode_check" CHECK ("middle_mode" IN ('year', 'fixed', 'none')),
  CONSTRAINT "numbering_formats_digits_check" CHECK ("digits" BETWEEN 3 AND 9),
  CONSTRAINT "numbering_formats_fixed_has_text" CHECK (("middle_mode" = 'fixed') = ("middle_text" IS NOT NULL))
);

INSERT INTO "permissions" ("name") VALUES ('numbering.manage') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r, "permissions" p
WHERE r."name" = 'ADMIN' AND p."name" = 'numbering.manage'
ON CONFLICT DO NOTHING;
