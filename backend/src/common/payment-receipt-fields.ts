import { z } from 'zod';
import { optionalTime } from './party-fields';
import { optionalTrimmedString } from './zod-fields';

// Transfer-receipt info shared by CustomerPayment (Receivables) and
// PurchasePayment (Purchases). Informational only — never feeds any derived
// total/status. Fixed list for now (owner, 2026-10-13); adjustable later.
export const PAYMENT_TRANSACTION_TYPES = ['پایا', 'ساتنا', 'کارت به کارت', 'انتقال داخلی', 'واریز نقدی', 'کارتخوان'] as const;

export const paymentReceiptInfoFields = {
  transactionTime: optionalTime,
  transactionType: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(PAYMENT_TRANSACTION_TYPES, { error: 'نوع تراکنش نامعتبر است' }).optional(),
  ),
  depositId: optionalTrimmedString(50),
  withdrawalId: optionalTrimmedString(50),
  sourceAccount: optionalTrimmedString(100),
  destinationAccount: optionalTrimmedString(100),
  destinationAccountHolder: optionalTrimmedString(100),
};
