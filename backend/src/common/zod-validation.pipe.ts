// Generic request-body/query validation for every module (not auth-specific).
// Lives in common/; auth/zod-validation.pipe.ts re-exports it for the
// existing import sites.
import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'اطلاعات ارسال‌شده نامعتبر است',
        errors: result.error.flatten(),
      });
    }
    return result.data;
  }
}
