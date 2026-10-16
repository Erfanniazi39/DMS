import { documentNumberFormatSchema } from '../common/document-number-format';
import { NumberingService } from './numbering.service';

describe('documentNumberFormatSchema', () => {
  const ok = { prefix: 'SO', middleMode: 'year', middleText: null, separator: '-', digits: 6 };
  it('accepts the default and a fixed middle part like 7050', () => {
    expect(documentNumberFormatSchema.safeParse(ok).success).toBe(true);
    const fixed = documentNumberFormatSchema.parse({ ...ok, middleMode: 'fixed', middleText: '7050' });
    expect(fixed.middleText).toBe('7050');
  });
  it('drops the text when the mode is not fixed', () => {
    expect(documentNumberFormatSchema.parse({ ...ok, middleText: '7050' }).middleText).toBeNull();
  });
  it('rejects bad prefixes, digit counts and year-like fixed text', () => {
    expect(documentNumberFormatSchema.safeParse({ ...ok, prefix: 'S O' }).success).toBe(false);
    expect(documentNumberFormatSchema.safeParse({ ...ok, prefix: '' }).success).toBe(false);
    expect(documentNumberFormatSchema.safeParse({ ...ok, digits: 2 }).success).toBe(false);
    expect(documentNumberFormatSchema.safeParse({ ...ok, middleMode: 'fixed', middleText: '1405' }).success).toBe(false);
    expect(documentNumberFormatSchema.safeParse({ ...ok, middleMode: 'fixed', middleText: null }).success).toBe(false);
  });
});

describe('NumberingService', () => {
  function setup(rows: Record<string, unknown>[] = [], last = 0) {
    const tx = {
      numberingFormat: { upsert: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue(last ? [{ last_value: last }] : []),
      $executeRaw: jest.fn(),
    };
    const prisma = {
      numberingFormat: { findMany: jest.fn().mockResolvedValue(rows), deleteMany: jest.fn() },
      documentSequence: { findUnique: jest.fn().mockResolvedValue(last ? { lastValue: last } : null) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const audit = { log: jest.fn() };
    return { tx, prisma, audit, service: new NumberingService(prisma as never, audit as never) };
  }
  const format = { prefix: 'SO', middleMode: 'fixed' as const, middleText: '7050', separator: '-', digits: 6 };

  it('lists every type with its default format and next number 1', async () => {
    const { service } = setup();
    const list = await service.list();
    expect(list.find((e) => e.docType === 'SO')).toMatchObject({ isDefault: true, nextNumber: 1 });
    expect(list.find((e) => e.docType === 'SO')!.nextPreview).toMatch(/^SO-14\d\d-000001$/);
  });

  it('raises the counter to the requested next number', async () => {
    const { service, tx } = setup();
    await service.update('INV', { format: { ...format, prefix: 'INV' }, nextNumber: 1878 }, 1);
    expect(tx.numberingFormat.upsert).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toContain(1877);
  });

  it('refuses to lower the counter', async () => {
    const { service } = setup([], 20);
    await expect(service.update('INV', { format: { ...format, prefix: 'INV' }, nextNumber: 5 }, 1)).rejects.toThrow('کمتر');
  });

  it('refuses a next number that does not fit the digits', async () => {
    const { service } = setup();
    await expect(service.update('INV', { format: { ...format, prefix: 'INV', digits: 3 }, nextNumber: 1000 }, 1)).rejects.toThrow();
  });

  it('keeps receipt and refund prefixes different', async () => {
    const { service } = setup([{ docType: 'RFD', prefix: 'PAY' }]);
    await expect(service.update('RCP', { format: { ...format, prefix: 'pay' } }, 1)).rejects.toThrow('متفاوت');
  });

  it('rejects an unknown document type and audits a change', async () => {
    const { service, audit } = setup();
    await expect(service.update('XYZ', { format }, 1)).rejects.toThrow();
    await service.update('SO', { format }, 1, '1.1.1.1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'NUMBERING_FORMAT_UPDATED', userId: 1 }));
  });
});
