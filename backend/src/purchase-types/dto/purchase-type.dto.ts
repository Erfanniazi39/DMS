import { z } from 'zod';

// Minimal — PurchaseType is still master data seeded from
// database_plan.txt's list (see prisma/seed.ts), not a full admin module.
// This only supports the "add a new type inline while creating a purchase"
// affordance on the Purchase form; a dedicated Purchase Types management
// page can be added later without changing this shape.
export const createPurchaseTypeSchema = z.object({
  code: z.string().trim().min(1, 'کد الزامی است').max(50),
  nameFa: z.string().trim().min(1, 'نام فارسی الزامی است').max(100),
  nameEn: z.string().trim().min(1, 'نام انگلیسی الزامی است').max(100),
});

export type CreatePurchaseTypeDto = z.infer<typeof createPurchaseTypeSchema>;
