import { Injectable } from '@nestjs/common';
import type { DeletedRecordRestorer } from './restore.types';

// Owning modules register a restorer for each entity type they archive on
// delete (in onModuleInit). Lives in the global AuditModule, which therefore
// never imports a business module.
@Injectable()
export class RestoreRegistry {
  private readonly restorers = new Map<string, DeletedRecordRestorer>();

  register(restorer: DeletedRecordRestorer) {
    this.restorers.set(restorer.entityType, restorer);
  }

  get(entityType: string) {
    return this.restorers.get(entityType);
  }

  has(entityType: string) {
    return this.restorers.has(entityType);
  }
}
