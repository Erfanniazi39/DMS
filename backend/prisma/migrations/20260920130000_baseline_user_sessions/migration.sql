-- Baseline migration: records that the "user_sessions" table already
-- exists in the database (it was created directly by connect-pg-simple,
-- the express-session Postgres store, not by a Prisma migration).
--
-- This migration is applied via `prisma migrate resolve --applied`, which
-- marks it as already run WITHOUT executing this SQL. The statements below
-- exist only so the migration history file matches what is actually in the
-- database. Do not run this file directly with `prisma db execute` or any
-- other tool — the table already exists and running it would fail (or, if
-- adjusted to "IF NOT EXISTS", would be a harmless no-op at best).

-- CreateTable
CREATE TABLE "user_sessions" (
    "sid" VARCHAR NOT NULL,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX "IDX_session_expire" ON "user_sessions"("expire");
