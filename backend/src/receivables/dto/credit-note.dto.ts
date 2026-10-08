import { z } from 'zod';
import { emptyToUndefined, enumField, optionalDate, optionalId, optionalTrimmedString, requiredDate, requiredId, requiredText } from '../../common/zod-fields';
import { SALES_DOCUMENT_STATUSES } from '../../sales/dto/delivery.dto';

// Strict field builders from common/zod-fields.ts (same conventions as the
// Sales module's DTOs).
//
// Never accepted from the client: creditNoteNumber (assigned at posting),
// status (the dedicated post action only), customerId/salesInvoiceId (taken
// from the return), every line (quantity/unitPrice/taxAmount/lineTotal —
// taken from the return's INSPECTED lines, build plan §4.2/§4.3), every
// derived money field, postedByUserId/postedAt.

// Only return-based credit notes this batch (B15) — create() takes just the
// return id and an optional credit date/reason; creditDate defaults to
// today in the service, same convention as sales-invoices' invoiceDate.
export const createCreditNoteSchema = z.object({
  salesReturnId: requiredId('مرجوعی را انتخاب کنید'),
  creditDate: optionalDate('تاریخ یادداشت اعتباری معتبر نیست'),
  reason: requiredText(500, 'علت صدور یادداشت اعتباری الزامی است'),
});

export const postCreditNoteSchema = z.object({ updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') });

export const creditNoteListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  status: z.preprocess(emptyToUndefined, enumField(SALES_DOCUMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  salesInvoiceId: optionalId('فیلتر فاکتور نامعتبر است'),
  salesReturnId: optionalId('فیلتر مرجوعی نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreateCreditNoteDto = z.infer<typeof createCreditNoteSchema>;
export type PostCreditNoteDto = z.infer<typeof postCreditNoteSchema>;
export type CreditNoteListQuery = z.infer<typeof creditNoteListQuerySchema>;
