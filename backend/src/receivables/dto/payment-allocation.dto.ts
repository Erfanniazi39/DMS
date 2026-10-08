import { z } from 'zod';
import { optionalTrimmedString, requiredId, requiredMoney } from '../../common/zod-fields';

// Strict field builders from common/zod-fields.ts.
//
// Only a RECEIPT CustomerPayment's unapplied amount is exposed as an
// allocation source today (sourcePaymentId) — the CreditNote side
// (sourceCreditNoteId) is a real parameter on
// PaymentAllocationsService.allocate() per build plan §6 ("build the
// function to accept it"), but Batch 6 hasn't built CreditNote yet, so no
// DTO/route can ever send it. customerId / sourcePayment's direction/status
// are derived server-side from the payment, never accepted from the client.

const allocationItemSchema = z.object(
  {
    invoiceId: requiredId('فاکتور را انتخاب کنید'),
    amount: requiredMoney('مبلغ تخصیص', { positive: true }),
  },
  { error: 'ردیف تخصیص نامعتبر است' },
);

export const allocatePaymentSchema = z.object({
  sourcePaymentId: requiredId('دریافت را انتخاب کنید'),
  items: z.array(allocationItemSchema, { error: 'فهرست تخصیص نامعتبر است' }).min(1, { error: 'حداقل یک ردیف تخصیص وارد کنید' }).max(50, { error: 'حداکثر ۵۰ ردیف مجاز است' }),
});

export const reverseAllocationSchema = z.object({
  reason: optionalTrimmedString(500),
});

export const suggestAllocationQuerySchema = z.object({
  customerId: requiredId('مشتری را انتخاب کنید'),
  amount: requiredMoney('مبلغ', { positive: true }),
});

export type AllocatePaymentDto = z.infer<typeof allocatePaymentSchema>;
export type ReverseAllocationDto = z.infer<typeof reverseAllocationSchema>;
export type SuggestAllocationQuery = z.infer<typeof suggestAllocationQuerySchema>;
