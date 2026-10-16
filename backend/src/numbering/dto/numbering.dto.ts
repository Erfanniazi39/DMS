import { z } from 'zod';
import { documentNumberFormatSchema } from '../../common/document-number-format';

// PUT /numbering/:docType — the format plus, optionally, the next number to issue
// (to continue an existing numbering, e.g. invoices from 1878). The counter can
// only be raised, never lowered (the service checks).
export const updateNumberingSchema = z.object({
  format: documentNumberFormatSchema,
  nextNumber: z
    .number({ error: 'شمارهٔ بعدی باید عدد باشد' })
    .int('شمارهٔ بعدی باید عدد صحیح باشد')
    .min(1, 'شمارهٔ بعدی حداقل ۱ است')
    .max(2_000_000_000, 'شمارهٔ بعدی بیش از حد بزرگ است')
    .optional(),
});

export type UpdateNumberingDto = z.infer<typeof updateNumberingSchema>;
