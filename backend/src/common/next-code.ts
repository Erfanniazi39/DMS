// Suggested code for a new master-data record (supplier, item, unit, ...):
// PREFIX-000001 style, one past the highest existing PREFIX-<number>. Only a
// suggestion — the user may overwrite it, and the unique code check on save
// stays the final word (two people opening the form at once may be offered
// the same one; the second save gets the usual "code already used" error).
// Document numbers (PUR-, SO-, ...) are a different thing: server-generated
// and never typed.

const WIDTH = 6;
// Longer digit runs (timestamp-style codes some tools generate) are not part of
// the sequence and must not push the suggestion into the billions.
const MAX_SEQUENCE_DIGITS = 9;

export function nextSequentialCode(existingCodes: readonly string[], prefix: string): string {
  const pattern = new RegExp(`^${prefix}-(\\d{1,${MAX_SEQUENCE_DIGITS}})$`, 'i');
  let max = 0;
  for (const code of existingCodes) {
    const match = pattern.exec(code.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(WIDTH, '0')}`;
}

// `load` returns the codes that start with `${prefix}-` (the caller owns the
// table); this builds the suggestion from them.
export async function suggestNextCode(prefix: string, load: (startsWith: string) => Promise<{ code: string }[]>) {
  const rows = await load(`${prefix}-`);
  return { code: nextSequentialCode(rows.map((row) => row.code), prefix) };
}
