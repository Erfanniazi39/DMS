import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { RolesRestorer } from './roles.restorer';

@Module({
  controllers: [AccessController],
  providers: [AccessService, RolesRestorer],
})
export class AccessModule {}
