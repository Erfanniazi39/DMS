import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global, like PrismaModule: audit logging is a cross-cutting concern every
// business module needs, so it doesn't have to be imported module by module.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
