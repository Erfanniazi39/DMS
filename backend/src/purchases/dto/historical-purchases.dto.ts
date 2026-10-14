import { z } from 'zod';
import { enumField, optionalBusinessDate, optionalMoney, optionalTrimmedString, requiredBusinessDate, requiredId } from '../../common/zod-fields';
import { paymentReceiptInfoFields } from '../../common/payment-receipt-fields';
import { purchaseItemSchema } from './purchase.dto';

// Fast entry of PAST purchases (owner, 2026-10-14) — the purchases twin of
// receivables/dto/historical-sales.dto.ts. Each row becomes a normal purchase
// (sourceType HISTORICAL_IMPORT, status CONFIRMED, so no requester
// department / buyer is needed) plus at most one COMPLETED payment on its own
// date. Rows are independent; documents are attached by the page afterwards
// through the existing purchase-document endpoints.
// paymentMode: FULL = the purchase total, PARTIAL = paymentAmount (not above
// the total), NONE = unpaid.

const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD'] as const;
const startOfTodayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

export const historicalPurchaseRowSchema = z
  .object({
    purchaseDate: requiredBusinessDate('تاریخ خرید معتبر نیست'),
    supplierId: requiredId('تأمین‌کننده را انتخاب کنید'),
    purchaseTypeId: requiredId('نوع خرید را انتخاب کنید'),
    note: optionalTrimmedString(1000),
    items: z.array(purchaseItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک قلم کالا را وارد کنید' }).max(100, { error: 'حداکثر ۱۰۰ قلم مجاز است' }),
    paymentMode: enumField(['FULL', 'PARTIAL', 'NONE'] as const, 'وضعیت پرداخت نامعتبر است'),
    paymentAmount: optionalMoney('مبلغ پرداخت'),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: 'روش پرداخت نامعتبر است' }).optional(),
    paymentDate: optionalBusinessDate('تاریخ پرداخت معتبر نیست'),
    referenceNumber: optionalTrimmedString(60),
    ...paymentReceiptInfoFields,
  })
  .refine((row) => row.purchaseDate.getTime() <= startOfTodayUtc().getTime(), { message: 'تاریخ خرید تاریخی نمی‌تواند در آینده باشد', path: ['purchaseDate'] })
  .refine((row) => row.paymentMode === 'NONE' || row.paymentMethod !== undefined, { message: 'روش پرداخت را انتخاب کنید', path: ['paymentMethod'] })
  .refine((row) => row.paymentMode !== 'PARTIAL' || (row.paymentAmount !== undefined && row.paymentAmount > 0), { message: 'مبلغ پرداخت را وارد کنید', path: ['paymentAmount'] })
  .refine((row) => row.paymentDate === undefined || row.paymentDate.getTime() >= row.purchaseDate.getTime(), { message: 'تاریخ پرداخت نمی‌تواند پیش از تاریخ خرید باشد', path: ['paymentDate'] })
  .refine((row) => row.paymentDate === undefined || row.paymentDate.getTime() <= startOfTodayUtc().getTime(), { message: 'تاریخ پرداخت نمی‌تواند در آینده باشد', path: ['paymentDate'] });

// Rows are validated one by one in the service so one bad row doesn't reject
// the whole batch — this schema only checks the envelope.
export const createHistoricalPurchasesSchema = z.object({
  rows: z.array(z.unknown(), { error: 'فهرست خریدها نامعتبر است' }).min(1, { error: 'حداقل یک خرید را وارد کنید' }).max(100, { error: 'حداکثر ۱۰۰ خرید در هر بار ثبت مجاز است' }),
});

export type HistoricalPurchaseRow = z.infer<typeof historicalPurchaseRowSchema>;
export type CreateHistoricalPurchasesDto = z.infer<typeof createHistoricalPurchasesSchema>;
