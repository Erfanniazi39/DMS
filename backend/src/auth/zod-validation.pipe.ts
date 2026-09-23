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
