import { ConflictException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { rowsOf, scalarData } from '../audit/restore/snapshot-data';

// A deleted supplier (only possible with no purchase history) comes back whole:
// header with its identifiers, every bank account (with its numbers), purchase
// types and goods list.
@Injectable()
export class SuppliersRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.SUPPLIER;

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  async restore({ record, tx, userId, ipAddress }: RestoreContext): Promise<RestoreResult> {
    const code = String(record.code);
    const name = String(record.name);
    const clash = await tx.supplier.findFirst({ where: { OR: [{ code }, { name }] }, select: { code: true } });
    if (clash) throw new ConflictException(clash.code === code ? 'کد این تأمین‌کننده اکنون برای تأمین‌کنندهٔ دیگری استفاده شده است' : 'تأمین‌کننده‌ای با همین نام اکنون وجود دارد');
    const row = await tx.supplier.create({ data: scalarData('Supplier', record) as never });
    const accounts = rowsOf(record.bankAccounts);
    if (accounts.length > 0) await tx.supplierBankAccount.createMany({ data: accounts.map((account) => scalarData('SupplierBankAccount', account) as never) });
    const types = rowsOf(record.purchaseTypes);
    if (types.length > 0) await tx.supplierPurchaseType.createMany({ data: types.map((link) => scalarData('SupplierPurchaseType', link) as never) });
    const goods = rowsOf(record.goods);
    if (goods.length > 0) await tx.supplierGood.createMany({ data: goods.map((good) => scalarData('SupplierGood', good) as never) });
    await this.audit.log({ userId, ipAddress, action: 'SUPPLIER_RESTORED', entityType: AUDIT_ENTITY.SUPPLIER, entityId: row.id, details: row.code }, tx);
    return { entityId: row.id };
  }
}
