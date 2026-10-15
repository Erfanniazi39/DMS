import { ConflictException } from '@nestjs/common';
import { scalarData } from './snapshot-data';

describe('scalarData', () => {
  it('keeps only real columns, converts dates and leaves decimals as text', () => {
    const data = scalarData('Unit', { id: 4, code: 'kg', nameEn: 'Kilogram', nameFa: 'کیلوگرم', isActive: true, sortOrder: 3, createdAt: '2026-10-01T00:00:00.000Z', extra: 'ignored', items: [{ id: 1 }] });
    expect(data).toMatchObject({ id: 4, code: 'kg', isActive: true });
    expect(data).not.toHaveProperty('extra');
    expect(data).not.toHaveProperty('items');
    if ('createdAt' in data) expect(data.createdAt).toBeInstanceOf(Date);
  });

  it('restores a masked optional column as null', () => {
    const data = scalarData('Customer', { id: 1, customerNumber: 'CUS-000001', name: 'x', nationalId: '***', phone: '1' }) as Record<string, unknown>;
    expect(data.nationalId).toBeNull();
  });

  it('refuses when a masked column is required', () => {
    expect(() => scalarData('Customer', { id: 1, customerNumber: '***' })).toThrow(ConflictException);
  });

  it('applies overrides last', () => {
    expect(scalarData('Unit', { id: 1, code: 'a' }, { code: 'b' })).toMatchObject({ code: 'b' });
  });

  it('rejects an unknown model', () => {
    expect(() => scalarData('NoSuchModel', {})).toThrow();
  });
});
