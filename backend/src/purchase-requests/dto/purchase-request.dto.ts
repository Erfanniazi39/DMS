import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  toIsoDay,
  requiredQuantity,
  requiredText,
} from '../../common/zod-fields';

// Field builders live in common/zod-fields.ts — strict on purpose: a
// missing/blank/null/boolean value on a required field is a 400 with a
// Persian message, never coerced into 0 / 1970-01-01 / 1 (QA 2026-10-05).

// PARTIALLY_PURCHASED/COMPLETED are set only by
// PurchaseRequestsService.recomputeStatus() (CLAUDE.md rule 6). They're
// still valid values for this schema to accept, since a request already in
// one of those states round-trips its own status back through this same
// edit form — but PurchaseRequestsService.update() refuses any edit that
// would move a request INTO either of them.
export const PURCHASE_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export const PURCHASE_REQUEST_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

// PURCHASE_REQUEST_ITEM.name is plain text, same reasoning as
// PurchaseItem.name — not linked to an Item record.
//
// `id` (optional, update only — ignored on create) names the existing
// PurchaseRequestItem row this line is. Lines are diffed by it on update
// (see PurchaseRequestsService.update()) so that Purchase lines linked to a
// request item keep their link; a line without an id is matched by
// name/unit, or else created as a new line.
const purchaseRequestItemSchema = z.object({
  id: optionalId('شناسه قلم درخواست نامعتبر است'),
  name: requiredText(150, 'نام/شرح قلم الزامی است'),
  quantity: requiredQuantity('مقدار'),
  unitId: requiredId('واحد را انتخاب کنید'),
  requiredDate: optionalBusinessDate('تاریخ نیاز معتبر نیست'),
  note: optionalTrimmedString(500),
}, { error: 'قلم درخواست نامعتبر است' });

// status is NOT part of this form — every new request starts DRAFT (see
// PurchaseRequestsService.create()), same as Purchase.
const purchaseRequestBaseSchema = z.object({
  requestDate: requiredBusinessDate('تاریخ درخواست معتبر نیست'),
  requesterDepartmentId: requiredId('دپارتمان درخواست‌کننده را انتخاب کنید'),
  // Optional — a request can come from a department in general without
  // naming the specific person who asked for it.
  requestedByEmployeeId: optionalId('کارمند درخواست‌کننده نامعتبر است'),
  priority: enumField(PURCHASE_REQUEST_PRIORITIES, 'اولویت نامعتبر است').default('NORMAL'),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseRequestItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک قلم کالا را وارد کنید' }),
}, { error: 'اطلاعات درخواست خرید نامعتبر است' });

// A line's "required by" date can't be before the request itself was made
// (business decision 2026-10-05).
function requiredDateNotBeforeRequestDate(data: z.infer<typeof purchaseRequestBaseSchema>, ctx: z.RefinementCtx) {
  data.items.forEach((item, index) => {
    if (item.requiredDate && toIsoDay(item.requiredDate) < toIsoDay(data.requestDate)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'requiredDate'],
        message: `تاریخ نیاز قلم «${item.name}» نمی‌تواند قبل از تاریخ درخواست باشد`,
      });
    }
  });
}

export const createPurchaseRequestSchema = purchaseRequestBaseSchema.superRefine(requiredDateNotBeforeRequestDate);

// updatedAt is the optimistic-locking token: the PurchaseRequest.updatedAt
// the client loaded (409, code RECORD_MODIFIED, if it has changed since).
export const updatePurchaseRequestSchema = purchaseRequestBaseSchema
  .extend({
    status: enumField(PURCHASE_REQUEST_STATUSES, 'وضعیت درخواست نامعتبر است'),
    updatedAt: requiredDate('نسخه رکورد (زمان آخرین ویرایش) ارسال نشده یا نامعتبر است'),
  })
  .superRefine(requiredDateNotBeforeRequestDate);

// GET /purchase-requests list filters — validated so an unknown enum value
// (?status=FOO, ?priority=ZZ) is a 400 rather than a raw Prisma 500. Blank
// values still mean "no filter".
export const purchaseRequestListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(PURCHASE_REQUEST_STATUSES, 'فیلتر وضعیت درخواست نامعتبر است').optional()),
  priority: z.preprocess(emptyToUndefined, enumField(PURCHASE_REQUEST_PRIORITIES, 'فیلتر اولویت نامعتبر است').optional()),
  requesterDepartmentId: optionalId('فیلتر دپارتمان نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreatePurchaseRequestDto = z.infer<typeof createPurchaseRequestSchema>;
export type UpdatePurchaseRequestDto = z.infer<typeof updatePurchaseRequestSchema>;
export type PurchaseRequestListQuery = z.infer<typeof purchaseRequestListQuerySchema>;
