import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { DocumentRestorer } from '../audit/restore/document-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';

// Draft inventory documents. They have posted no stock movement, so putting one
// back never touches a balance (CLAUDE.md rule 10) — only posting does.
@Injectable()
export class GoodsReceiptsRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.GOODS_RECEIPT;
  protected readonly model = 'GoodsReceipt';
  protected readonly itemModel = 'GoodsReceiptItem';
  protected readonly delegate = 'goodsReceipt';
  protected readonly itemDelegate = 'goodsReceiptItem';
  protected readonly auditEntity = AUDIT_ENTITY.GOODS_RECEIPT;
  protected readonly auditAction = 'GOODS_RECEIPT_RESTORED';
  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }
  protected describe(record: Record<string, unknown>) {
    return `پیش‌نویس رسید انبار — ${String(record.supplierName ?? '')}`;
  }
}

@Injectable()
export class ProductionOutputsRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.PRODUCTION_OUTPUT;
  protected readonly model = 'ProductionOutput';
  protected readonly itemModel = 'ProductionOutputItem';
  protected readonly delegate = 'productionOutput';
  protected readonly itemDelegate = 'productionOutputItem';
  protected readonly auditEntity = AUDIT_ENTITY.PRODUCTION_OUTPUT;
  protected readonly auditAction = 'PRODUCTION_OUTPUT_RESTORED';
  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }
  protected describe() {
    return 'پیش‌نویس رسید تولید';
  }
}

@Injectable()
export class StockAdjustmentsRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.STOCK_ADJUSTMENT;
  protected readonly model = 'StockAdjustment';
  protected readonly itemModel = 'StockAdjustmentItem';
  protected readonly delegate = 'stockAdjustment';
  protected readonly itemDelegate = 'stockAdjustmentItem';
  protected readonly auditEntity = AUDIT_ENTITY.STOCK_ADJUSTMENT;
  protected readonly auditAction = 'STOCK_ADJUSTMENT_RESTORED';
  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }
  protected describe() {
    return 'پیش‌نویس اصلاح موجودی';
  }
}

@Injectable()
export class StockCountsRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.STOCK_COUNT;
  protected readonly model = 'StockCount';
  protected readonly itemModel = 'StockCountItem';
  protected readonly delegate = 'stockCount';
  protected readonly itemDelegate = 'stockCountItem';
  protected readonly auditEntity = AUDIT_ENTITY.STOCK_COUNT;
  protected readonly auditAction = 'STOCK_COUNT_RESTORED';
  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }
  protected describe() {
    return 'پیش‌نویس شمارش موجودی';
  }
}

@Injectable()
export class GoodsReturnsRestorer extends DocumentRestorer {
  readonly entityType = AUDIT_ENTITY.GOODS_RETURN;
  protected readonly model = 'GoodsReturn';
  protected readonly itemModel = 'GoodsReturnItem';
  protected readonly delegate = 'goodsReturn';
  protected readonly itemDelegate = 'goodsReturnItem';
  protected readonly auditEntity = AUDIT_ENTITY.GOODS_RETURN;
  protected readonly auditAction = 'GOODS_RETURN_RESTORED';
  constructor(registry: RestoreRegistry, audit: AuditService) {
    super(registry, audit);
  }
  protected describe(record: Record<string, unknown>) {
    return `پیش‌نویس برگشت کالا — ${String(record.supplierName ?? '')}`;
  }
}
