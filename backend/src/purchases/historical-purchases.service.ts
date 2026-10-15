import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { PurchasePaymentsService } from './purchase-payments.service';
import { sumItemTotals } from './purchase-totals';
import { historicalPurchaseRowSchema, type CreateHistoricalPurchasesDto } from './dto/historical-purchases.dto';

export type HistoricalPurchaseResult =
  | { index: number; ok: true; purchase: { id: number; purchaseNumber: string }; paymentRecorded: boolean; paymentErrors?: string[] }
  | { index: number; ok: false; errors: string[] };

function errorMessages(error: unknown): string[] {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return [body];
    const { message } = body as { message?: string | string[] };
    if (Array.isArray(message)) return message;
    if (typeof message === 'string') return [message];
    return [error.message];
  }
  return ['خطای پیش‌بینی‌نشده؛ این خرید ثبت نشد'];
}

// ثبت خرید تاریخی — a batch of past purchases. Each row goes through
// PurchasesService.create() (sourceType HISTORICAL_IMPORT, CONFIRMED) and, if
// paid, PurchasePaymentsService.addPayment() (COMPLETED, on its own date) —
// the real services, so totals, paymentStatus and audit stay theirs (rule 6)
// and nothing touches Inventory (rule 7). Rows run in order and
// independently: a failing row reports its errors and the rest continue. A
// row whose purchase saved but whose payment failed keeps the purchase and
// reports the payment error (same as quick-sale's partial-failure policy).
@Injectable()
export class HistoricalPurchasesService {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly payments: PurchasePaymentsService,
  ) {}

  async createBatch(dto: CreateHistoricalPurchasesDto, userId: number | null, ipAddress?: string): Promise<{ results: HistoricalPurchaseResult[] }> {
    const results: HistoricalPurchaseResult[] = [];
    for (const [index, raw] of dto.rows.entries()) {
      const parsed = historicalPurchaseRowSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ index, ok: false, errors: parsed.error.issues.map((issue) => issue.message) });
        continue;
      }
      const row = parsed.data;
      try {
        // Checked before anything is created, so a bad amount leaves no half-made purchase.
        const total = sumItemTotals(row.items);
        if (row.paymentMode === 'PARTIAL' && row.paymentAmount! > total) throw new BadRequestException('مبلغ پرداخت نمی‌تواند از جمع خرید بیشتر باشد');

        const created = await this.purchases.create(
          {
            purchaseDate: row.purchaseDate,
            purchaseTypeId: row.purchaseTypeId,
            supplierId: row.supplierId,
            sourceType: 'HISTORICAL_IMPORT',
            status: 'CONFIRMED',
            note: row.note,
            items: row.items,
            confirmOverage: false,
            confirmTotalMismatch: false,
          },
          userId,
          ipAddress,
        );
        const purchase = { id: created.id, purchaseNumber: created.purchaseNumber };

        if (row.paymentMode === 'NONE') {
          results.push({ index, ok: true, purchase, paymentRecorded: false });
          continue;
        }
        try {
          await this.payments.addPayment(
            created.id,
            {
              amount: row.paymentMode === 'FULL' ? total : row.paymentAmount!,
              paymentDate: row.paymentDate ?? row.purchaseDate,
              method: row.paymentMethod!,
              referenceNumber: row.referenceNumber,
              status: 'COMPLETED',
              confirmOverpayment: false,
              transactionTime: row.transactionTime,
              transactionType: row.transactionType,
              depositId: row.depositId,
              withdrawalId: row.withdrawalId,
              sourceAccount: row.sourceAccount,
              destinationAccount: row.destinationAccount,
              destinationAccountHolder: row.destinationAccountHolder,
            },
            userId,
            ipAddress,
          );
          results.push({ index, ok: true, purchase, paymentRecorded: true });
        } catch (paymentError) {
          // The purchase exists — report it as saved, with the payment problem.
          results.push({ index, ok: true, purchase, paymentRecorded: false, paymentErrors: errorMessages(paymentError) });
        }
      } catch (error) {
        results.push({ index, ok: false, errors: errorMessages(error) });
      }
    }
    return { results };
  }
}
