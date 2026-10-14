-- CreateTable
CREATE TABLE "customer_payment_documents" (
    "id" SERIAL NOT NULL,
    "customer_payment_id" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "note" TEXT,
    "uploaded_by_user_id" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_payment_documents_customer_payment_id_idx" ON "customer_payment_documents"("customer_payment_id");

-- AddForeignKey
ALTER TABLE "customer_payment_documents" ADD CONSTRAINT "customer_payment_documents_customer_payment_id_fkey" FOREIGN KEY ("customer_payment_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_documents" ADD CONSTRAINT "customer_payment_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
