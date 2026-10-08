import { Prisma } from '@prisma/client';
import type { SalesInvoicesService } from '../sales/sales-invoices.service';

// The ONE approved cross-module call (build plan §3): Receivables never
// writes SalesInvoice.paidAmount/creditedAmount/paymentStatus (or
// SalesOrder.paymentStatus) itself — it sums its own PaymentAllocation rows
// and hands the absolute totals to SalesInvoicesService.applySettlement(),
// which decides what they mean for the invoice (and its order).
//
// DI-free plain function (same convention as sales/sales-progress.ts and
// inventory/stock-ledger.ts): takes the caller's transaction client and the
// already-injected SalesInvoicesService instance, so this file itself never
// needs a module import — the module boundary is crossed by whichever
// Receivables service injects SalesModule's SalesInvoicesService and passes
// it through. Caller must already hold the invoice's row lock if it's about
// to read-modify-write anything else about it; applySettlement() locks the
// invoice (then its order) itself.
//
// A PENDING cheque's allocation is deliberately excluded from the sum (B9:
// "reduce AR only when cleared, not on receipt") — it only starts counting
// once CustomerPaymentsService.clearCheque() moves the payment to COMPLETED
// and calls this again. A credit note has no PENDING-like intermediate
// state (unlike a cheque) — its allocation counts as soon as the credit
// note is POSTED (Sales batch 6).

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);

export async function recomputeInvoiceSettlement(tx: Prisma.TransactionClient, invoiceId: number, salesInvoices: SalesInvoicesService) {
  const [paymentRows, creditNoteRows] = await Promise.all([
    tx.paymentAllocation.findMany({
      where: { targetInvoiceId: invoiceId, reversedAt: null, sourcePayment: { status: 'COMPLETED' } },
      select: { amount: true },
    }),
    tx.paymentAllocation.findMany({
      where: { targetInvoiceId: invoiceId, reversedAt: null, sourceCreditNote: { status: 'POSTED' } },
      select: { amount: true },
    }),
  ]);
  const paidAmount = paymentRows.reduce((sum, row) => sum.plus(dec(row.amount)), new Prisma.Decimal(0));
  const creditedAmount = creditNoteRows.reduce((sum, row) => sum.plus(dec(row.amount)), new Prisma.Decimal(0));
  return salesInvoices.applySettlement(tx, invoiceId, { paidAmount, creditedAmount });
}
