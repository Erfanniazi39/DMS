import { z } from 'zod';
import {
  emptyToUndefined,
  enumField,
  optionalBusinessDate,
  optionalDate,
  optionalId,
  optionalTrimmedString,
  requiredBusinessDate,
  requiredDate,
  requiredId,
  requiredMoney,
  requiredText,
} from '../../common/zod-fields';

// Strict field builders from common/zod-fields.ts (same conventions as
// sales/dto/*.dto.ts) — missing/blank/wrong-type on a required field is a
// 400 with a Persian message, never coerced.
//
// Never accepted from the client: paymentNumber (assigned on save, no draft
// stage — build plan §4.3), status (derived from method: CHECK → PENDING,
// otherwise COMPLETED — CustomerPaymentsService.recordReceipt()/refund()),
// direction (fixed by the endpoint).

export const CUSTOMER_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHECK', 'CARD'] as const;
export const CUSTOMER_PAYMENT_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const;
export const CUSTOMER_PAYMENT_DIRECTIONS = ['RECEIPT', 'REFUND'] as const;

// Shared shape for recordReceipt() and refund() — chequeDueDate is required
// only when method is CHECK (B9).
const customerPaymentBaseSchema = z
  .object({
    customerId: requiredId('مشتری را انتخاب کنید'),
    paymentDate: requiredBusinessDate('تاریخ معتبر نیست'),
    amount: requiredMoney('مبلغ', { positive: true }),
    method: enumField(CUSTOMER_PAYMENT_METHODS, 'روش پرداخت نامعتبر است'),
    referenceNumber: optionalTrimmedString(100),
    chequeDueDate: optionalBusinessDate('تاریخ سررسید چک معتبر نیست'),
    bankName: optionalTrimmedString(200),
    note: optionalTrimmedString(2000),
  })
  .refine((data) => data.method !== 'CHECK' || data.chequeDueDate !== undefined, {
    message: 'برای روش پرداخت «چک» تاریخ سررسید الزامی است',
    path: ['chequeDueDate'],
  });

export const createCustomerReceiptSchema = customerPaymentBaseSchema;
export const createCustomerRefundSchema = customerPaymentBaseSchema;

const versionField = { updatedAt: requiredDate('نسخهٔ رکورد نامعتبر است') };

// COMPLETED → CANCELLED (reason required, reverses active allocations).
export const cancelCustomerPaymentSchema = z.object({
  ...versionField,
  reason: requiredText(500, 'علت لغو الزامی است'),
});

// PENDING → COMPLETED (cheque cleared).
export const clearChequeSchema = z.object({
  ...versionField,
});

// PENDING → CANCELLED (cheque bounced — reverses active allocations).
export const bounceChequeSchema = z.object({
  ...versionField,
  reason: requiredText(500, 'علت برگشت چک الزامی است'),
});

export const customerPaymentListQuerySchema = z.object({
  q: z.string({ error: 'عبارت جستجو نامعتبر است' }).optional(),
  direction: z.preprocess(emptyToUndefined, enumField(CUSTOMER_PAYMENT_DIRECTIONS, 'فیلتر نوع نامعتبر است').optional()),
  status: z.preprocess(emptyToUndefined, enumField(CUSTOMER_PAYMENT_STATUSES, 'فیلتر وضعیت نامعتبر است').optional()),
  method: z.preprocess(emptyToUndefined, enumField(CUSTOMER_PAYMENT_METHODS, 'فیلتر روش پرداخت نامعتبر است').optional()),
  customerId: optionalId('فیلتر مشتری نامعتبر است'),
  dateFrom: optionalDate('تاریخ شروع فیلتر نامعتبر است'),
  dateTo: optionalDate('تاریخ پایان فیلتر نامعتبر است'),
  page: z.string({ error: 'شماره صفحه نامعتبر است' }).optional(),
  pageSize: z.string({ error: 'تعداد ردیف در هر صفحه نامعتبر است' }).optional(),
});

export type CreateCustomerReceiptDto = z.infer<typeof createCustomerReceiptSchema>;
export type CreateCustomerRefundDto = z.infer<typeof createCustomerRefundSchema>;
export type CancelCustomerPaymentDto = z.infer<typeof cancelCustomerPaymentSchema>;
export type ClearChequeDto = z.infer<typeof clearChequeSchema>;
export type BounceChequeDto = z.infer<typeof bounceChequeSchema>;
export type CustomerPaymentListQuery = z.infer<typeof customerPaymentListQuerySchema>;
