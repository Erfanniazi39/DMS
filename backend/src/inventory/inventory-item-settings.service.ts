import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { lockItemSettings } from './stock-ledger';
import type { UpsertInventoryItemSettingDto } from './dto/item-setting.dto';

// I4 (build plan §5.4/§5.4a): per-item batch/expiry configuration.
// expiryRequired/shelfLifeDays are plain config, editable anytime.
// batchTracked is NOT a plain field — turning it on directly (false→true,
// no BATCH_CUTOVER document) is allowed ONLY when the item has zero stock
// everywhere (every location's ON_HAND and QC are both zero); otherwise the
// caller is pointed at BATCH_CUTOVER (StockAdjustmentsService). Turning it
// off (true→false) is always refused — cutover is one-way in this batch.
@Injectable()
export class InventoryItemSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(itemId: number) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true, code: true, name: true } });
    if (!item) throw new NotFoundException('کالا پیدا نشد');
    const setting = await this.prisma.inventoryItemSetting.findUnique({ where: { itemId } });
    return {
      item,
      batchTracked: setting?.batchTracked ?? false,
      expiryRequired: setting?.expiryRequired ?? false,
      shelfLifeDays: setting?.shelfLifeDays ?? null,
      batchTrackedSince: setting?.batchTrackedSince ?? null,
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  async upsert(itemId: number, dto: UpsertInventoryItemSettingDto, userId: number | null, ipAddress?: string) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true, code: true, name: true } });
    if (!item) throw new NotFoundException('کالا پیدا نشد');

    await this.prisma.$transaction(async (tx) => {
      // §5.4a R1: the same exclusive advisory lock BATCH_CUTOVER takes,
      // before reading or writing the setting.
      await lockItemSettings(tx, [itemId], 'exclusive');
      const existing = await tx.inventoryItemSetting.findUnique({ where: { itemId } });
      const currentlyTracked = existing?.batchTracked ?? false;
      const wantsTracked = dto.batchTracked ?? currentlyTracked;

      if (currentlyTracked && !wantsTracked) {
        throw new ConflictException('بازگرداندن کالا از ردیابی بچ به حالت عادی ممکن نیست؛ این تبدیل یک‌طرفه است.');
      }

      if (!currentlyTracked && wantsTracked) {
        const rows = await tx.$queryRaw<{ on_hand: unknown; qc: unknown }[]>`
          SELECT on_hand, qc FROM stock_balances
          WHERE item_id = ${itemId}
          FOR UPDATE`;
        const totalOnHand = rows.reduce((sum, row) => sum.plus(new Prisma.Decimal(String(row.on_hand))), new Prisma.Decimal(0));
        const totalQc = rows.reduce((sum, row) => sum.plus(new Prisma.Decimal(String(row.qc))), new Prisma.Decimal(0));
        if (totalOnHand.greaterThan(0) || totalQc.greaterThan(0)) {
          throw new ConflictException({
            statusCode: 409,
            code: 'STOCK_NONZERO',
            message: `«${item.name}» موجودی دارد (موجودی انبار ${totalOnHand.toString()}، در انتظار کنترل کیفیت ${totalQc.toString()})؛ برای تبدیل کالای دارای موجودی به ردیابی بچ، از سند «تبدیل به ردیابی بچ» (BATCH_CUTOVER) در اصلاح موجودی استفاده کنید.`,
            details: { itemId, onHand: totalOnHand.toString(), qc: totalQc.toString() },
          });
        }
      }

      const becameTracked = wantsTracked && !currentlyTracked;
      const saved = await tx.inventoryItemSetting.upsert({
        where: { itemId },
        create: {
          itemId,
          batchTracked: wantsTracked,
          expiryRequired: dto.expiryRequired,
          shelfLifeDays: dto.shelfLifeDays ?? null,
          batchTrackedSince: wantsTracked ? new Date() : null,
          updatedByUserId: userId,
        },
        update: {
          batchTracked: wantsTracked,
          expiryRequired: dto.expiryRequired,
          shelfLifeDays: dto.shelfLifeDays ?? null,
          ...(becameTracked ? { batchTrackedSince: new Date() } : {}),
          updatedByUserId: userId,
        },
      });

      await this.audit.log(
        {
          userId,
          ipAddress,
          action: existing ? 'INVENTORY_ITEM_SETTING_UPDATED' : 'INVENTORY_ITEM_SETTING_CREATED',
          entityType: AUDIT_ENTITY.INVENTORY_ITEM_SETTING,
          entityId: itemId,
          details: `${item.name} — ردیابی بچ: ${saved.batchTracked ? 'فعال' : 'غیرفعال'}، الزام تاریخ انقضا: ${saved.expiryRequired ? 'بله' : 'خیر'}`,
        },
        tx,
      );
    });

    return this.get(itemId);
  }
}
