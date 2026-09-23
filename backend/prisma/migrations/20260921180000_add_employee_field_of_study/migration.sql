-- AlterTable: add field_of_study ("رشته") — only meaningful when
-- education_level = 'under_diploma', enforced in application code, not as
-- a database constraint.
ALTER TABLE "employees" ADD COLUMN "field_of_study" TEXT;
