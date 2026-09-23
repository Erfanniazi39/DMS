-- Optional employee photo (اختیاری). Only the relative URL path to a file
-- served from backend/uploads/employees is stored here; the image itself
-- lives on disk, not in the database.
ALTER TABLE "employees" ADD COLUMN "photo_path" TEXT;
