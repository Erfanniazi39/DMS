-- CreateTable
CREATE TABLE "supplier_purchase_types" (
    "supplier_id" INTEGER NOT NULL,
    "purchase_type_id" INTEGER NOT NULL,

    CONSTRAINT "supplier_purchase_types_pkey" PRIMARY KEY ("supplier_id","purchase_type_id")
);

CREATE TABLE "supplier_goods" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_goods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_purchase_types_purchase_type_id_idx" ON "supplier_purchase_types"("purchase_type_id");
CREATE INDEX "supplier_goods_supplier_id_idx" ON "supplier_goods"("supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_purchase_types" ADD CONSTRAINT "supplier_purchase_types_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_types" ADD CONSTRAINT "supplier_purchase_types_purchase_type_id_fkey" FOREIGN KEY ("purchase_type_id") REFERENCES "purchase_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_goods" ADD CONSTRAINT "supplier_goods_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
