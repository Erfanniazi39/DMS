-- AlterTable: contract document (PDF or photo of the signed contract),
-- stored on disk under uploads/employees the same way the employee photo
-- is — only the relative URL is kept here, set through its own upload
-- endpoint (see EmployeesController), never through create/update.
ALTER TABLE "employees" ADD COLUMN "contract_document_path" TEXT;
