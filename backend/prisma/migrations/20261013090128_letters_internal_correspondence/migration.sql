-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'SENT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "full_name" TEXT;

-- CreateTable
CREATE TABLE "letters" (
    "id" SERIAL NOT NULL,
    "letter_number" TEXT,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sender_user_id" INTEGER NOT NULL,
    "in_reply_to_id" INTEGER,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_recipients" (
    "letter_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "letter_recipients_pkey" PRIMARY KEY ("letter_id","user_id")
);

-- CreateTable
CREATE TABLE "letter_attachments" (
    "id" SERIAL NOT NULL,
    "letter_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "letters_letter_number_key" ON "letters"("letter_number");

-- CreateIndex
CREATE INDEX "letters_sender_user_id_status_sent_at_idx" ON "letters"("sender_user_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "letters_in_reply_to_id_idx" ON "letters"("in_reply_to_id");

-- CreateIndex
CREATE INDEX "letter_recipients_user_id_archived_at_read_at_idx" ON "letter_recipients"("user_id", "archived_at", "read_at");

-- CreateIndex
CREATE INDEX "letter_attachments_letter_id_idx" ON "letter_attachments"("letter_id");

-- AddForeignKey
ALTER TABLE "letters" ADD CONSTRAINT "letters_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters" ADD CONSTRAINT "letters_in_reply_to_id_fkey" FOREIGN KEY ("in_reply_to_id") REFERENCES "letters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_letter_id_fkey" FOREIGN KEY ("letter_id") REFERENCES "letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_recipients" ADD CONSTRAINT "letter_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_attachments" ADD CONSTRAINT "letter_attachments_letter_id_fkey" FOREIGN KEY ("letter_id") REFERENCES "letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_attachments" ADD CONSTRAINT "letter_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A letter has a number and a sent date exactly when it is SENT.
ALTER TABLE "letters" ADD CONSTRAINT "letters_sent_has_number_and_date"
  CHECK (("status" = 'SENT') = ("letter_number" IS NOT NULL AND "sent_at" IS NOT NULL));
