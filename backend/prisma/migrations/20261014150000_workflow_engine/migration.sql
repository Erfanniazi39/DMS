-- CreateEnum
CREATE TYPE "WorkflowDocumentType" AS ENUM ('PURCHASE', 'SALES_ORDER', 'PURCHASE_REQUEST');
-- CreateEnum
CREATE TYPE "WorkflowAmountBasis" AS ENUM ('TOTAL', 'ANY_LINE_TOTAL', 'ANY_UNIT_PRICE');
-- CreateEnum
CREATE TYPE "WorkflowApproverType" AS ENUM ('ROLE', 'USER');
-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');
-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('WAITING', 'OPEN', 'APPROVED', 'REJECTED', 'CANCELLED');
-- CreateTable
CREATE TABLE "workflow_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "document_type" "WorkflowDocumentType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "purchase_type_id" INTEGER,
    "supplier_id" INTEGER,
    "requester_department_id" INTEGER,
    "amount_basis" "WorkflowAmountBasis" NOT NULL DEFAULT 'TOTAL',
    "min_amount" DECIMAL(15,0),
    "max_amount" DECIMAL(15,0),
    "notify_by_letter" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by_user_id" INTEGER,
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "workflow_rule_steps" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_type" "WorkflowApproverType" NOT NULL,
    "role_id" INTEGER,
    "user_id" INTEGER,
    "label" TEXT,
    CONSTRAINT "workflow_rule_steps_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "approval_requests" (
    "id" SERIAL NOT NULL,
    "document_type" "WorkflowDocumentType" NOT NULL,
    "document_id" INTEGER NOT NULL,
    "document_number" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "amount" DECIMAL(15,0) NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rule_id" INTEGER,
    "rule_version" INTEGER NOT NULL,
    "rule_name_snapshot" TEXT NOT NULL,
    "notify_by_letter" BOOLEAN NOT NULL DEFAULT true,
    "facts_snapshot" JSONB NOT NULL,
    "current_level" INTEGER NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "close_reason" TEXT,
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "approval_steps" (
    "id" SERIAL NOT NULL,
    "request_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_type" "WorkflowApproverType" NOT NULL,
    "role_id" INTEGER,
    "user_id" INTEGER,
    "approver_label" TEXT NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'WAITING',
    "decided_by_user_id" INTEGER,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "notification_letter_id" INTEGER,
    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "workflow_rules_document_type_is_active_sort_order_idx" ON "workflow_rules"("document_type", "is_active", "sort_order");
-- CreateIndex
CREATE UNIQUE INDEX "workflow_rule_steps_rule_id_level_key" ON "workflow_rule_steps"("rule_id", "level");
-- CreateIndex
CREATE INDEX "approval_requests_document_type_document_id_idx" ON "approval_requests"("document_type", "document_id");
-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");
-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_request_id_level_key" ON "approval_steps"("request_id", "level");
-- AddForeignKey
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "workflow_rule_steps" ADD CONSTRAINT "workflow_rule_steps_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "workflow_rule_steps" ADD CONSTRAINT "workflow_rule_steps_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "workflow_rule_steps" ADD CONSTRAINT "workflow_rule_steps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "workflow_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added integrity rules (not expressible in Prisma):
-- a ROLE step names a role only, a USER step names a user only.
ALTER TABLE "workflow_rule_steps" ADD CONSTRAINT "workflow_rule_steps_approver_chk" CHECK (
  ("approver_type" = 'ROLE' AND "role_id" IS NOT NULL AND "user_id" IS NULL) OR
  ("approver_type" = 'USER' AND "user_id" IS NOT NULL AND "role_id" IS NULL)
);
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_chk" CHECK (
  ("approver_type" = 'ROLE' AND "role_id" IS NOT NULL AND "user_id" IS NULL) OR
  ("approver_type" = 'USER' AND "user_id" IS NOT NULL AND "role_id" IS NULL)
);
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_amount_band_chk" CHECK (
  "min_amount" IS NULL OR "max_amount" IS NULL OR "min_amount" < "max_amount"
);
-- One PENDING approval per document at a time.
CREATE UNIQUE INDEX "approval_requests_one_pending_per_document_key"
  ON "approval_requests"("document_type", "document_id") WHERE "status" = 'PENDING';
