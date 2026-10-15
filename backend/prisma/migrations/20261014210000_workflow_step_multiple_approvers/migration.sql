-- A workflow step may now have several approvers (roles and/or users, mixed);
-- ANY ONE of them can decide it. Additive: the old single-approver columns on
-- workflow_rule_steps / approval_steps stay in place (made nullable, no longer
-- read or written) and every existing step is copied into the new tables.

-- CreateTable
CREATE TABLE "workflow_rule_step_approvers" (
    "id" SERIAL NOT NULL,
    "step_id" INTEGER NOT NULL,
    "approver_type" "WorkflowApproverType" NOT NULL,
    "role_id" INTEGER,
    "user_id" INTEGER,

    CONSTRAINT "workflow_rule_step_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_approvers" (
    "id" SERIAL NOT NULL,
    "step_id" INTEGER NOT NULL,
    "approver_type" "WorkflowApproverType" NOT NULL,
    "role_id" INTEGER,
    "user_id" INTEGER,

    CONSTRAINT "approval_step_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_rule_step_approvers_step_id_idx" ON "workflow_rule_step_approvers"("step_id");

-- CreateIndex
CREATE INDEX "approval_step_approvers_step_id_idx" ON "approval_step_approvers"("step_id");

-- CreateIndex
CREATE INDEX "approval_step_approvers_role_id_idx" ON "approval_step_approvers"("role_id");

-- CreateIndex
CREATE INDEX "approval_step_approvers_user_id_idx" ON "approval_step_approvers"("user_id");

-- AddForeignKey
ALTER TABLE "workflow_rule_step_approvers" ADD CONSTRAINT "workflow_rule_step_approvers_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "workflow_rule_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_rule_step_approvers" ADD CONSTRAINT "workflow_rule_step_approvers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_rule_step_approvers" ADD CONSTRAINT "workflow_rule_step_approvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added integrity rule: a ROLE approver names a role only, a USER approver a user only.
ALTER TABLE "workflow_rule_step_approvers" ADD CONSTRAINT "workflow_rule_step_approvers_chk" CHECK (
  ("approver_type" = 'ROLE' AND "role_id" IS NOT NULL AND "user_id" IS NULL) OR
  ("approver_type" = 'USER' AND "user_id" IS NOT NULL AND "role_id" IS NULL)
);
ALTER TABLE "approval_step_approvers" ADD CONSTRAINT "approval_step_approvers_chk" CHECK (
  ("approver_type" = 'ROLE' AND "role_id" IS NOT NULL AND "user_id" IS NULL) OR
  ("approver_type" = 'USER' AND "user_id" IS NOT NULL AND "role_id" IS NULL)
);

-- The legacy single-approver columns are optional from now on.
ALTER TABLE "workflow_rule_steps" DROP CONSTRAINT "workflow_rule_steps_approver_chk";
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_approver_chk";
ALTER TABLE "workflow_rule_steps" ALTER COLUMN "approver_type" DROP NOT NULL;
ALTER TABLE "approval_steps" ALTER COLUMN "approver_type" DROP NOT NULL;

-- Copy every existing step's single approver into the new tables.
INSERT INTO "workflow_rule_step_approvers" ("step_id", "approver_type", "role_id", "user_id")
SELECT "id", "approver_type", "role_id", "user_id" FROM "workflow_rule_steps" WHERE "approver_type" IS NOT NULL;
INSERT INTO "approval_step_approvers" ("step_id", "approver_type", "role_id", "user_id")
SELECT "id", "approver_type", "role_id", "user_id" FROM "approval_steps" WHERE "approver_type" IS NOT NULL;
