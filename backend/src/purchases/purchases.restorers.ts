import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../audit/audit.service';
import { BaseRestorer } from '../audit/restore/base-restorer';
import { RestoreRegistry } from '../audit/restore/restore.registry';
import type { RestoreContext, RestoreResult } from '../audit/restore/restore.types';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasesService } from './purchases.service';

// Thin adapters: the restore rules live in the services that own them.
@Injectable()
export class PurchasesRestorer extends BaseRestorer {
  readonly entityType = AUDIT_ENTITY.PURCHASE;

  constructor(registry: RestoreRegistry, audit: AuditService, private readonly purchases: PurchasesService) {
    super(registry, audit);
  }

  restore(context: RestoreContext): Promise<RestoreResult> {
    return this.purchases.restoreDeleted(context);
  }
}

@Injectable()
export class PurchaseReturnsRestorer extends BaseRestorer {
  readonly entityType = 'PurchaseReturn';

  constructor(registry: RestoreRegistry, audit: AuditService, private readonly returns: PurchaseReturnsService) {
    super(registry, audit);
  }

  restore(context: RestoreContext): Promise<RestoreResult> {
    return this.returns.restoreDeleted(context);
  }
}
