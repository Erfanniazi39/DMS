import { z } from 'zod';

export const createDepartmentSchema = z.object({
  code: z.string().trim().min(1, 'کد واحد الزامی است').max(40),
  name: z.string().trim().min(1, 'نام واحد الزامی است').max(120),
  note: z.string().trim().max(500).optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.extend({
  status: z.enum(['active', 'inactive']),
});

export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;
