import { BadRequestException } from '@nestjs/common';
import { buildOrderBy, parseSort } from './pagination';

describe('parseSort', () => {
  it('is opt-in: no sortBy means no sort', () => {
    expect(parseSort(undefined, undefined)).toBeUndefined();
    expect(parseSort('  ', 'desc')).toBeUndefined();
  });
  it('defaults the direction to asc and lower-cases it', () => {
    expect(parseSort('name', undefined)).toEqual({ sortBy: 'name', sortDir: 'asc' });
    expect(parseSort('name', 'DESC')).toEqual({ sortBy: 'name', sortDir: 'desc' });
  });
  it('rejects an unknown direction', () => {
    expect(() => parseSort('name', 'sideways')).toThrow(BadRequestException);
  });
});

describe('buildOrderBy', () => {
  const columns = { name: (dir: 'asc' | 'desc') => ({ name: dir }), supplier: (dir: 'asc' | 'desc') => ({ supplier: { name: dir } }) };
  const fallback = [{ name: 'asc' as const }, { id: 'asc' as const }];
  const tie = [{ id: 'asc' as const }];

  it('uses the default order when nothing was requested', () => {
    expect(buildOrderBy(undefined, columns, fallback as never[], tie as never[])).toBe(fallback);
  });
  it('maps a whitelisted column and appends the tie-break', () => {
    expect(buildOrderBy({ sortBy: 'supplier', sortDir: 'desc' }, columns, fallback as never[], tie as never[])).toEqual([{ supplier: { name: 'desc' } }, { id: 'asc' }]);
  });
  it('rejects a column that is not whitelisted (including prototype names)', () => {
    expect(() => buildOrderBy({ sortBy: 'password', sortDir: 'asc' }, columns, fallback as never[], tie as never[])).toThrow(BadRequestException);
    expect(() => buildOrderBy({ sortBy: 'constructor', sortDir: 'asc' }, columns, fallback as never[], tie as never[])).toThrow(BadRequestException);
  });
});
