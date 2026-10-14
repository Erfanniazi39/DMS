-- Workflow engine, batch W3: purchases that need approval wait in
-- PENDING_APPROVAL. Additive only (no existing row changes).
ALTER TYPE "PurchaseStatus" ADD VALUE 'PENDING_APPROVAL' AFTER 'DRAFT';
