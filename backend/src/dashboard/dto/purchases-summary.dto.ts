import { z } from 'zod';
import { emptyToUndefined } from '../../common/zod-fields';

// emptyToUndefined: shared "empty string means not provided" convention.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

// A custom range longer than this is refused — the dashboard is a
// "recent state of the business" view, not a multi-year report (that's what
// the not-yet-built Reports module is for).
export const MAX_CUSTOM_RANGE_DAYS = 366;

export const DASHBOARD_PERIODS = ['today', 'week', 'month', 'custom'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const isoDate = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(ISO_DATE, 'تاریخ باید به شکل YYYY-MM-DD باشد')
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'تاریخ نامعتبر است')
    .optional(),
);

// from/to are calendar dates (inclusive on both ends), in the same
// "YYYY-MM-DD" shape the frontend's JalaliDateInput reports and that
// Purchase.purchaseDate is stored from (z.coerce.date() → UTC midnight).
export const purchasesSummaryQuerySchema = z
  .object({
    period: z.preprocess(emptyToUndefined, z.enum(DASHBOARD_PERIODS).default('month')),
    from: isoDate,
    to: isoDate,
  })
  .superRefine((value, ctx) => {
    if (value.period !== 'custom') return;
    if (!value.from) ctx.addIssue({ code: 'custom', path: ['from'], message: 'تاریخ شروع بازه الزامی است' });
    if (!value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'تاریخ پایان بازه الزامی است' });
    if (!value.from || !value.to) return;
    const from = Date.parse(`${value.from}T00:00:00Z`);
    const to = Date.parse(`${value.to}T00:00:00Z`);
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد' });
      return;
    }
    if ((to - from) / MS_PER_DAY + 1 > MAX_CUSTOM_RANGE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `بازه دلخواه حداکثر ${MAX_CUSTOM_RANGE_DAYS} روز می‌تواند باشد` });
    }
  });

export type PurchasesSummaryQueryDto = z.infer<typeof purchasesSummaryQuerySchema>;
