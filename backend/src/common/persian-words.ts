// Whole-Rial amount -> Persian words, e.g. 1250000 -> «یک میلیون و دویست و
// پنجاه هزار ریال». Pure; used for «جمع کل به حروف».

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون'];

function threeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o ? `${TENS[t]} و ${ONES[o]}` : TENS[t]);
    }
  }
  return parts.join(' و ');
}

export function rialToPersianWords(amount: number | bigint | string): string {
  let value = typeof amount === 'bigint' ? amount : BigInt(String(amount).split('.')[0] || '0');
  if (value === 0n) return 'صفر ریال';
  const negative = value < 0n;
  if (negative) value = -value;
  const groups: number[] = [];
  while (value > 0n) {
    groups.push(Number(value % 1000n));
    value /= 1000n;
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    const words = threeDigits(groups[i]);
    parts.push(SCALES[i] ? `${words} ${SCALES[i]}` : words);
  }
  return `${negative ? 'منفی ' : ''}${parts.join(' و ')} ریال`;
}
