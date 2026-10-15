import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

// Turns one archived row (JSON: dates as ISO text, decimals as text) back into
// the data object for `tx.<model>.create`. Driven by Prisma's own model
// metadata: only real columns are taken (display joins and nested relations in
// the snapshot are ignored), dates become Date, JSON nulls become DbNull.
// A value masked at archive time ('***') cannot come back: it is set to null
// when the column allows, otherwise the restore is refused.
export function scalarData(modelName: string, row: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const model = MODELS.get(modelName);
  if (!model) throw new Error(`Unknown Prisma model ${modelName}`);
  const data: Record<string, unknown> = {};
  for (const field of model.fields) {
    if (field.kind !== 'scalar' && field.kind !== 'enum') continue;
    if (!(field.name in row)) continue;
    let value = row[field.name];
    if (value === '***') {
      if (field.isRequired) throw new ConflictException('بخشی از اطلاعات این سند هنگام حذف به‌دلایل امنیتی ذخیره نشده بود؛ بازیابی ممکن نیست');
      value = null;
    }
    if (value !== null && field.type === 'DateTime') value = new Date(value as string);
    if (value === null && field.type === 'Json') value = Prisma.DbNull;
    data[field.name] = value;
  }
  return { ...data, ...overrides };
}

export function rowsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
