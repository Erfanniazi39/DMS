import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePurchaseTypeDto } from './dto/purchase-type.dto';

// Read-mostly — PurchaseType rows are seeded (see prisma/seed.ts) with the
// exact list from database_plan.txt. create() only exists to back the
// small "add a new type inline" affordance on the Purchase form, not a
// full admin module — see purchase-type.dto.ts.
@Injectable()
export class PurchaseTypesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.purchaseType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(dto: CreatePurchaseTypeDto) {
    const existing = await this.prisma.purchaseType.findFirst({
      where: { OR: [{ code: dto.code }, { nameFa: dto.nameFa }] },
    });
    if (existing?.code === dto.code) throw new ConflictException('این کد قبلاً برای یک نوع خرید دیگر استفاده شده است');
    if (existing?.nameFa === dto.nameFa) throw new ConflictException('نوع خریدی با این نام فارسی از قبل وجود دارد');

    const { _max } = await this.prisma.purchaseType.aggregate({ _max: { sortOrder: true } });
    return this.prisma.purchaseType.create({
      data: {
        code: dto.code,
        nameFa: dto.nameFa,
        nameEn: dto.nameEn,
        sortOrder: (_max.sortOrder ?? -1) + 1,
      },
    });
  }
}
