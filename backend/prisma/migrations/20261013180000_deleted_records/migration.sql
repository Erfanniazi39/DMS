-- CreateTable
CREATE TABLE "deleted_records" (
    "id" SERIAL NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "label" TEXT,
    "snapshot" JSONB NOT NULL,
    "deleted_by_user_id" INTEGER,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deleted_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deleted_records_expires_at_idx" ON "deleted_records"("expires_at");
CREATE INDEX "deleted_records_entity_type_entity_id_idx" ON "deleted_records"("entity_type", "entity_id");
CREATE INDEX "deleted_records_deleted_at_idx" ON "deleted_records"("deleted_at");

-- AddForeignKey
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
