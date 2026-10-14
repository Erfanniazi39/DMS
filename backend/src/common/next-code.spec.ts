import { nextSequentialCode, suggestNextCode } from './next-code';

describe('nextSequentialCode', () => {
  it('starts at 000001 when nothing matches', () => {
    expect(nextSequentialCode([], 'SUP')).toBe('SUP-000001');
    expect(nextSequentialCode(['retail', 'kg', 'OTHER-5'], 'SUP')).toBe('SUP-000001');
  });
  it('is one past the highest number, ignoring gaps and other formats', () => {
    expect(nextSequentialCode(['SUP-000001', 'SUP-000007', 'SUP-000003', 'legacy-9'], 'SUP')).toBe('SUP-000008');
  });
  it('is case-insensitive on the prefix and grows past six digits', () => {
    expect(nextSequentialCode(['sup-000010'], 'SUP')).toBe('SUP-000011');
    expect(nextSequentialCode(['SUP-999999'], 'SUP')).toBe('SUP-1000000');
  });
  it('ignores timestamp-style codes (more than 9 digits)', () => {
    expect(nextSequentialCode(['ITM-1791443026318309', 'ITM-000012'], 'ITM')).toBe('ITM-000013');
  });
  it('does not match a longer prefix or a trailing suffix', () => {
    expect(nextSequentialCode(['SUPX-000050', 'SUP-000002-A'], 'SUP')).toBe('SUP-000001');
  });
});

describe('suggestNextCode', () => {
  it('asks the loader for the prefix and wraps the result', async () => {
    const load = jest.fn().mockResolvedValue([{ code: 'ITM-000004' }]);
    await expect(suggestNextCode('ITM', load)).resolves.toEqual({ code: 'ITM-000005' });
    expect(load).toHaveBeenCalledWith('ITM-');
  });
});
