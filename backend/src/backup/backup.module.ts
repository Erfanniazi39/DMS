import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupMaintenanceMiddleware, BackupMaintenanceState } from './backup-maintenance';
import { BackupService } from './backup.service';
import { BackupRemoteService } from './backup-remote.service';

// Backup & restore of the whole system to a folder (a flash drive). Reads the database itself (no module's
// business logic is involved), which is why it stays one self-contained module. README.md explains the design.
@Module({
  controllers: [BackupController],
  providers: [BackupService, BackupRemoteService, BackupMaintenanceState],
})
export class BackupModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BackupMaintenanceMiddleware).forRoutes('*');
  }
}
