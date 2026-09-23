import { z } from 'zod';

// Same "empty string means not provided" convention used by the other DTOs
// in this project (see employee.dto.ts, purchase.dto.ts).
function emptyToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optionalTrimmedString(maxLength: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(maxLength).optional());
}

// PARTIALLY_PURCHASED/COMPLETED are normally set automatically by
// PurchaseRequestsService.recomputeStatus() (see that method), not chosen
// here — but they're still valid values for this schema to accept, since a
// request already in one of those states round-trips its own status back
// through this same edit form unless the user deliberately changes it.
const PURCHASE_REQUEST_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_PURCHASED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
const PURCHASE_REQUEST_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

// PURCHASE_REQUEST_ITEM.name is plain text, same reasoning as
// PurchaseItem.name — not linked to an Item record.
const purchaseRequestItemSchema = z.object({
  name: z.string().trim().min(1, 'نام/شرح قلم الزامی است').max(150),
  quantity: z.coerce.number().positive('مقدار باید بزرگ‌تر از صفر باشد'),
  unitId: z.coerce.number().int().positive('واحد را انتخاب کنید'),
  requiredDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  note: optionalTrimmedString(500),
});

// status is NOT part of this form — every new request starts DRAFT (see
// PurchaseRequestsService.create()), same as Purchase.
export const createPurchaseRequestSchema = z.object({
  requestDate: z.coerce.date(),
  requesterDepartmentId: z.coerce.number().int().positive('دپارتمان درخواست‌کننده را انتخاب کنید'),
  // Optional — a request can come from a department in general without
  // naming the specific person who asked for it.
  requestedByEmployeeId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  priority: z.enum(PURCHASE_REQUEST_PRIORITIES).default('NORMAL'),
  note: optionalTrimmedString(1000),
  items: z.array(purchaseRequestItemSchema).min(1, 'حداقل یک قلم کالا را وارد کنید'),
});

export const updatePurchaseRequestSchema = createPurchaseRequestSchema.extend({
  status: z.enum(PURCHASE_REQUEST_STATUSES),
});

export type CreatePurchaseRequestDto = z.infer<typeof createPurchaseRequestSchema>;
export type UpdatePurchaseRequestDto = z.infer<typeof updatePurchaseRequestSchema>;
