import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { DocumentRestorer } from '../audit/restore/document-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';

@Injectable()
export class DeliveriesRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.DELIVERY;
  protected readonly model = 'Delivery';
  protected readonly itemModel = 'DeliveryItem';
  protected readonly delegate = 'delivery';
  protected readonly itemDelegate = 'deliveryItem';
  protected readonly auditEntity = AUDIT_ENTITY.DELIVERY;
  protected readonly auditAction = 'DELIVERY_RESTORED';

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  protected describe(record: Record<string, unknown>) {
    return `پیش‌نویس حواله — ${String(record.customerName ?? '')}`;
  }
}

@Injectable()
export class SalesInvoicesRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.SALES_INVOICE;
  protected readonly model = 'SalesInvoice';
  protected readonly itemModel = 'SalesInvoiceItem';
  protected readonly delegate = 'salesInvoice';
  protected readonly itemDelegate = 'salesInvoiceItem';
  protected readonly auditEntity = AUDIT_ENTITY.SALES_INVOICE;
  protected readonly auditAction = 'SALES_INVOICE_RESTORED';

  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }

  protected describe(record: Record<string, unknown>) {
    return `پیش‌نویس فاکتور — ${String(record.customerName ?? '')}`;
  }
}
