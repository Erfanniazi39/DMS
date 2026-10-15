import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { DeletedRecordsService } from './deleted-records.service';
import { AuditService } from './audit.service';
import { RestoreRegistry } from './restore/restore.registry';

// Global, like PrismaModule: audit logging is a cross-cutting concern every
// business module needs, so it doesn't have to be imported module by module.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, DeletedRecordsService, RestoreRegistry],
  exports: [AuditService, RestoreRegistry],
})
export class AuditModule {}
