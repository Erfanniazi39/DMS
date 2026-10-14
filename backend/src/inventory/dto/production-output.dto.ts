import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalId,
  optionalMoney,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredQuantity,
} from '../../common/zod-fields';
import { STOCK_DOCUMENT_STATUSES } from './inventory.dto';

// Inventory batch I5 (build plan §5.11, B1/B2/B15): production output
// (رسید تولید) — "we produced N units of finished good X, lot Y, on date Z".
// No BOM / raw-material consumption (explicitly out of scope, B1). Shape-only
// validation here; the FINISHED_GOOD-only rule, the item's batch-tracked
// state and employee/location existence are checked by
// ProductionOutputsService (and re-checked at posting).

const productionOutputItemSchema = z
  .object(
    {
      itemId: requiredId('کالا را انتخاب کنید'),
      quantity: requiredQuantity('مقدار'),
      // B15: manually entered per-unit production cost (whole Rial) —
      // optional; only a caller holding inventory.cost may send it.
      unitCost: optionalMoney('بهای تمام‌شدهٔ واحد'),
      costIsEstimated: z.boolean({ error: 'مقدار «برآوردی بودن بها» نامعتبر است' }).optional().default(false),
      // I4: required for a batch-tracked finished good, forbidden otherwise.
      batchNumber: optionalTrimmedString(100),
      // Defaults to the header's productionDate at posting when omitted (§5.11).
      productionDate: optionalBusinessDate('تاریخ تولید نامعتبر است'),
      expiryDate: optionalBusinessDate('تاریخ انقضا نامعتبر است'),
      note: optionalTrimmedString(500),
    },
    { error: 'ردیف کالا نامعتبر است' },
  )
  .superRefine((value, ctx) => {
    if (value.expiryDate && value.productionDate && value.expiryDate.getTime() < value.productionDate.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'تاریخ انقضا نمی‌تواند قبل از تاریخ تولید باشد' });
    }
    if (!value.batchNumber && (value.productionDate || value.expiryDate)) {
      ctx.addIssue({ code: 'custom', path: ['batchNumber'], message: 'تاریخ تولید/انقضا فقط همراه با شمارهٔ بچ ثبت می‌شود' });
    }
    if (value.costIsEstimated && value.unitCost === undefined) {
      ctx.addIssue({ code: 'custom', path: ['costIsEstimated'], message: '«برآوردی بودن بها» فقط همراه با بهای واحد معنا دارد' });
    }
  });

const productionOutputBaseSchema = z.object({
  // Optional: omitted = the default warehouse.
  locationId: optionalId('انبار نامعتبر است'),
  productionDate: requiredBusinessDate('تاریخ تولید معتبر نیست'),
  producedByEmployeeId: optionalId('کارمند انتخاب‌شده نامعتبر است'),
  note: optionalTrimmedString(1000),
  items: z.array(productionOutputItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }),
});

export const createProductionOutputSchema = productionOutputBaseSchema;

export const updateProductionOutputSchema = productionOutputBaseSchema.extend({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const postProductionOutputSchema = z.object({
  updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است'),
});

export const productionOutputListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(STOCK_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
  // Column sorting (?sortBy=&sortDir=) — see common/pagination.ts parseSort().
  sortBy: z.string().optional(),
  sortDir: z.string().optional(),
});

export type CreateProductionOutputDto = z.infer<typeof createProductionOutputSchema>;
export type UpdateProductionOutputDto = z.infer<typeof updateProductionOutputSchema>;
export type PostProductionOutputDto = z.infer<typeof postProductionOutputSchema>;
export type ProductionOutputListQuery = z.infer<typeof productionOutputListQuerySchema>;
