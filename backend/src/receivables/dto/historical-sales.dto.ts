import { z } from 'zod';
import { enumField, optionalBusinessDate, optionalMoney, optionalPercent, optionalTrimmedString, requiredBusinessDate, requiredId, requiredMoney, requiredQuantity } from '../../common/zod-fields';
import { paymentReceiptInfoFields } from '../../common/payment-receipt-fields';
import { QUICK_SALE_PAYMENT_METHODS } from './quick-sale.dto';

// Fast entry of PAST sales (owner, 2026-10-14): each row is one sale and runs
// the full order → delivery → invoice → receipt chain (QuickSaleService.
// runSaleChain) on its own historical date. Rows are independent — a failed
// row doesn't stop the others. paymentMode: FULL = paid in full, PARTIAL =
// paymentAmount (< invoice total), NONE = left unpaid. No cheques (an
// uncleared cheque would leave the invoice open — use the receipts screen).

// Discount: a percent OR an amount, never both — and, as on any order (B3),
// only a sales.approve holder may send one (enforced by the order service,
// so a row from anyone else fails with that error).
const historicalItemSchema = z
  .object(
    {
      itemId: requiredId('کالا را انتخاب کنید'),
      quantity: requiredQuantity('مقدار'),
      unitPrice: requiredMoney('قیمت واحد'),
      discountPercent: optionalPercent('درصد تخفیف'),
      discountAmount: optionalMoney('مبلغ تخفیف'),
      taxRate: optionalPercent('نرخ مالیات'),
    },
    { error: 'ردیف کالا نامعتبر است' },
  )
  .refine((line) => line.discountPercent === undefined || line.discountAmount === undefined, {
    message: 'برای تخفیف فقط یکی از «درصد» یا «مبلغ» را وارد کنید',
    path: ['discountAmount'],
  });

const startOfTodayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

export const historicalSaleRowSchema = z
  .object({
    customerId: requiredId('مشتری را انتخاب کنید'),
    saleDate: requiredBusinessDate('تاریخ فروش معتبر نیست'),
    items: z.array(historicalItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }).max(50, { error: 'حداکثر ۵۰ ردیف کالا مجاز است' }),
    paymentMode: enumField(['FULL', 'PARTIAL', 'NONE'] as const, 'وضعیت پرداخت نامعتبر است'),
    paymentAmount: optionalMoney('مبلغ دریافت'),
    paymentMethod: z.enum(QUICK_SALE_PAYMENT_METHODS, { error: 'روش پرداخت نامعتبر است' }).optional(),
    paymentDate: optionalBusinessDate('تاریخ دریافت معتبر نیست'),
    referenceNumber: optionalTrimmedString(100),
    // Transfer-receipt info (informational), same fields as a normal receipt.
    ...paymentReceiptInfoFields,
  })
  .refine((row) => row.saleDate.getTime() <= startOfTodayUtc().getTime(), { message: 'تاریخ فروش تاریخی نمی‌تواند در آینده باشد', path: ['saleDate'] })
  .refine((row) => row.paymentMode === 'NONE' || row.paymentMethod !== undefined, { message: 'روش پرداخت را انتخاب کنید', path: ['paymentMethod'] })
  .refine((row) => row.paymentMode !== 'PARTIAL' || (row.paymentAmount !== undefined && row.paymentAmount > 0), { message: 'مبلغ دریافت را وارد کنید', path: ['paymentAmount'] })
  .refine((row) => row.paymentDate === undefined || row.paymentDate.getTime() >= row.saleDate.getTime(), { message: 'تاریخ دریافت نمی‌تواند پیش از تاریخ فروش باشد', path: ['paymentDate'] })
  .refine((row) => row.paymentDate === undefined || row.paymentDate.getTime() <= startOfTodayUtc().getTime(), { message: 'تاریخ دریافت نمی‌تواند در آینده باشد', path: ['paymentDate'] });

// Rows are validated one by one inside the service (so one bad row doesn't
// reject the whole batch) — the batch schema only checks the envelope.
export const createHistoricalSalesSchema = z.object({
  rows: z.array(z.unknown(), { error: 'فهرست فروش‌ها نامعتبر است' }).min(1, { error: 'حداقل یک فروش را وارد کنید' }).max(100, { error: 'حداکثر ۱۰۰ فروش در هر بار ثبت مجاز است' }),
});

export type HistoricalSaleRow = z.infer<typeof historicalSaleRowSchema>;
export type CreateHistoricalSalesDto = z.infer<typeof createHistoricalSalesSchema>;
