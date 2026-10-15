import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { rowsOf, scalarData } from '../audit/restore/snapshot-data';

// Only DRAFT orders can be deleted (they have no number and hold no stock), so
// a restored order is the same draft again — no reservation, no document number
// — and goes through the normal confirm/approval flow from there.
@Injectable()
export class SalesOrdersRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.SALES_ORDER;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    if (record.status !== 'DRAFT') throw new ConflictException('فقط پیش‌نویس سفارش فروش قابل بازیابی است');
    const customer = await tx.customer.findUnique({ where: { id: Number(record.customerId) }, select: { id: true } });
    if (!customer) throw new ConflictException('مشتری این سفارش دیگر وجود ندارد؛ ابتدا او را بازیابی کنید');
    const row = await tx.salesOrder.create({ data: scalarData('SalesOrder', record) as never });
    await tx.salesOrderItem.createMany({ data: rowsOf(record.items).map((line) => scalarData('SalesOrderItem', line) as never) });
    await this.audit.log({ userId, ipAddress, action: 'SALES_ORDER_RESTORED', entityType: AUDIT_ENTITY.SALES_ORDER, entityId: row.id, details: `پیش‌نویس — ${row.customerName}` }, tx);
    return { entityId: row.id };
  }
}
