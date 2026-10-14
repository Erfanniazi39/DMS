-- Workflow engine, batch W7: sales-order rules can require a discount
-- (largest line discount >= min_discount_percent; 0 = any discount).
ALTER TABLE "workflow_rules" ADD COLUMN "min_discount_percent" DECIMAL(5,2);
ALTER TABLE "workflow_rules" ADD CONSTRAINT "workflow_rules_discount_chk" CHECK ("min_discount_percent" IS NULL OR ("min_discount_percent" >= 0 AND "min_discount_percent" <= 100));
