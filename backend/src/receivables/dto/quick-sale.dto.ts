import { z } from 'zod';
import { optionalBusinessDate, optionalTrimmedString, requiredId, requiredMoney, requiredQuantity } from '../../common/zod-fields';

// Strict field builders from common/zod-fields.ts (same conventions as
// sales/dto/sales-order.dto.ts). Build plan B6: "counter/cash sales... one
// action creates order+delivery+invoice+payment in one action, underlying
// documents still separate." This DTO is the minimal input for that chain —
// everything else (order/delivery/invoice numbers, dueDate, settlement) is
// computed by the underlying services exactly as it would be for any other
// order (QuickSaleService never reimplements their logic).
//
// No discount/tax exposed here (keeps the screen minimal, and a quick sale
// is a counter sale, not a negotiated one — B3 already blocks a discount
// for anyone without sales.approve, which most quick-sale cashiers won't
// hold). No CHECK payment method — a quick sale's whole point is that the
// invoice settles immediately; an uncleared cheque (B9) would leave it
// UNPAID, defeating that.

export const QUICK_SALE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD'] as const;

const quickSaleItemSchema = z.object(
  {
    itemId: requiredId('کالا را انتخاب کنید'),
    quantity: requiredQuantity('مقدار'),
    unitPrice: requiredMoney('قیمت واحد'),
  },
  { error: 'ردیف کالا نامعتبر است' },
);

export const createQuickSaleSchema = z.object({
  customerId: requiredId('مشتری را انتخاب کنید'),
  // One date for order/delivery/invoice/payment — defaults to today in the
  // service. A quick sale is a same-moment counter transaction; there is no
  // business reason for these four dates to differ.
  saleDate: optionalBusinessDate('تاریخ معتبر نیست'),
  paymentMethod: z.enum(QUICK_SALE_PAYMENT_METHODS, { error: 'روش پرداخت نامعتبر است' }),
  referenceNumber: optionalTrimmedString(100),
  items: z.array(quickSaleItemSchema, { error: 'فهرست اقلام نامعتبر است' }).min(1, { error: 'حداقل یک ردیف کالا را وارد کنید' }).max(50, { error: 'حداکثر ۵۰ ردیف مجاز است' }),
});

export type CreateQuickSaleDto = z.infer<typeof createQuickSaleSchema>;
export type QuickSalePaymentMethod = (typeof QUICK_SALE_PAYMENT_METHODS)[number];
