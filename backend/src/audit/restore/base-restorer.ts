import type { OnModuleInit } from '@nestjs/common';
import type { AuditService } from '../audit.service';
import type { RestoreRegistry } from './restore.registry';
import type { DeletedRecordRestorer, RestoreContext, RestoreResult } from './restore.types';

// Registers itself with the RestoreRegistry on startup. Concrete restorers live
// in the module that owns the record and extend this.
export abstract class BaseRestorer implements DeletedRecordRestorer, OnModuleInit {
  abstract readonly entityType: string;

  constructor(
    protected readonly registry: RestoreRegistry,
    protected readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  abstract restore(context: RestoreContext): Promise<RestoreResult>;
}
