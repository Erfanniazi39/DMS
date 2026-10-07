import { escapeLike, normalizePersianText, searchKey, searchKeySql, toAsciiDigits } from './customer-normalize';

describe('customer-normalize', () => {
  it('toAsciiDigits converts Persian and Arabic-Indic digits', () => {
    expect(toAsciiDigits('۰۹۱۲-٣٤٥')).toBe('0912-345');
  });

  it('normalizePersianText: ي→ی, ك→ک, ZWNJ→space, collapses whitespace, trims', () => {
    expect(normalizePersianText('  علي   كريمي‌پور ')).toBe('علی کریمی پور');
  });

  it('searchKey makes ZWNJ / space / no-separator spellings compare equal and lowercases Latin', () => {
    expect(searchKey('خرده‌فروشی')).toBe(searchKey('خرده فروشی'));
    expect(searchKey('خرده فروشی')).toBe(searchKey('خردهفروشی'));
    expect(searchKey('CUS-000012')).toBe('cus-000012');
    expect(searchKey('شركت ۱۲')).toBe('شرکت12');
  });

  it('escapeLike escapes %, _ and backslash', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('searchKeySql only splices the given (trusted) column name', () => {
    const sql = searchKeySql('c.name');
    expect(sql.sql).toContain('coalesce(c.name');
    expect(sql.values).toEqual([]);
  });
});
