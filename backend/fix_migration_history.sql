-- One-time fix — run once, then this file can be deleted.
--
-- The migration folder "20260922114637_add_purchase_request_index" got a
-- real wall-clock timestamp (11:46) that sorts BEFORE
-- "20260922130000_add_purchases_module" (13:00), which is the migration
-- that actually creates the "purchases" table it alters. That ordering bug
-- is harmless against the real database (every migration was in fact
-- applied in the right practical order), but it breaks `prisma migrate dev`
-- whenever it replays the full migration history from scratch against a
-- shadow database (P3006 / P1014: "the purchases table does not exist").
--
-- The folder has been recreated on disk as
-- "20260922150500_add_purchase_request_index" (same SQL, just renamed so it
-- now sorts after the migration that creates "purchases"). This statement
-- updates Prisma's own bookkeeping table to match that rename, so Prisma
-- treats it as the same already-applied migration under its new name,
-- rather than as a brand-new one it still needs to apply.
UPDATE "_prisma_migrations"
SET migration_name = '20260922150500_add_purchase_request_index'
WHERE migration_name = '20260922114637_add_purchase_request_index';
