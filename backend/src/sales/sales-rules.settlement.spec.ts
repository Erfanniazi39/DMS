import { INVOICE_SETTLEMENT_LABELS_FA, invoiceSettlementKind } from './sales-rules';

describe('invoiceSettlementKind (نقدی / غیرنقدی, derived from the payment term)', () => {
  it('0 due days is cash; any due days is credit', () => {
    expect(invoiceSettlementKind(0)).toBe('CASH');
    expect(invoiceSettlementKind(1)).toBe('CREDIT');
    expect(invoiceSettlementKind(30)).toBe('CREDIT');
    expect(INVOICE_SETTLEMENT_LABELS_FA).toEqual({ CASH: 'نقدی', CREDIT: 'غیرنقدی' });
  });
});
