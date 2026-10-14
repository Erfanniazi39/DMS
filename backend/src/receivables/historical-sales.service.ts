import { HttpException, Injectable } from '@nestjs/common';
import { QuickSaleService, type QuickSaleActor, type QuickSaleResult } from './quick-sale.service';
import { historicalSaleRowSchema, type CreateHistoricalSalesDto } from './dto/historical-sales.dto';

// Shown on the order's price-override audit when a historical price is below
// the item's current list price (B2 requires a reason) — historical prices
// legitimately differ from today's list.
const HISTORICAL_PRICE_REASON = 'ثبت فروش تاریخی';

export type HistoricalSaleResult =
  | { index: number; ok: true; order: QuickSaleResult['order']; delivery: QuickSaleResult['delivery']; invoice: QuickSaleResult['invoice']; payment: QuickSaleResult['payment'] | null }
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
  return ['خطای پیش‌بینی‌نشده؛ این فروش ثبت نشد'];
}

// ثبت فروش تاریخی — a batch of past sales, one full order → delivery →
// invoice → receipt chain per row (QuickSaleService.runSaleChain, i.e. the
// real services' own transactions — nothing is reimplemented or written
// directly, CLAUDE.md rule 11). Rows run one after another and independently:
// a failing row reports its errors and the rest continue; whatever a failing
// row already committed before its failing step stays as it is (same as
// quick-sale — see its header). Stock effects follow the salesStockEffects
// flag (off in v1), exactly like a hand-entered sale.
@Injectable()
export class HistoricalSalesService {
  constructor(private readonly quickSale: QuickSaleService) {}

  async createBatch(dto: CreateHistoricalSalesDto, actor: QuickSaleActor): Promise<{ results: HistoricalSaleResult[] }> {
    const results: HistoricalSaleResult[] = [];
    for (const [index, raw] of dto.rows.entries()) {
      const parsed = historicalSaleRowSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({ index, ok: false, errors: parsed.error.issues.map((issue) => issue.message) });
        continue;
      }
      const row = parsed.data;
      try {
        const chain = await this.quickSale.runSaleChain(
          {
            customerId: row.customerId,
            saleDate: row.saleDate,
            items: row.items.map((item) => ({ ...item, priceOverrideReason: HISTORICAL_PRICE_REASON })),
            payment:
              row.paymentMode === 'NONE'
                ? null
                : {
                    amount: row.paymentMode === 'FULL' ? 'FULL' : row.paymentAmount!,
                    method: row.paymentMethod!,
                    referenceNumber: row.referenceNumber,
                    paymentDate: row.paymentDate,
                    receiptInfo: {
                      transactionTime: row.transactionTime,
                      transactionType: row.transactionType,
                      depositId: row.depositId,
                      withdrawalId: row.withdrawalId,
                      sourceAccount: row.sourceAccount,
                      destinationAccount: row.destinationAccount,
                      destinationAccountHolder: row.destinationAccountHolder,
                    },
                  },
          },
          actor,
        );
        results.push({ index, ok: true, ...chain });
      } catch (error) {
        results.push({ index, ok: false, errors: errorMessages(error) });
      }
    }
    return { results };
  }
}
