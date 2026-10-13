-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('FINISHED_GOOD', 'RAW_MATERIAL', 'PACKAGING');

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "item_kind" "ItemKind" NOT NULL DEFAULT 'FINISHED_GOOD';

-- Hand-added (not modelled by Prisma): database-level append-only guard for
-- stock_movements (CLAUDE.md rule 10 / Inventory build plan I1, E1). Until
-- now this was enforced only by convention: stock-ledger.ts's
-- applyMovements() is the only writer, and no code path performs an UPDATE
-- or DELETE on this table (re-verified before adding this trigger). This
-- makes the invariant a hard database guarantee, not just discipline — a
-- mistake must be corrected by posting a new movement, never by editing or
-- removing an old one.
CREATE FUNCTION stock_movements_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'stock_movements is append-only'; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();
