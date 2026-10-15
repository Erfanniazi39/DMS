import { Module } from '@nestjs/common';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ItemsRestorer } from './items.restorer';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, ItemsRestorer],
})
export class ItemsModule {}
