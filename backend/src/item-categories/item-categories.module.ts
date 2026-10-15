import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesRestorer } from './item-categories.restorer';

@Module({
  controllers: [ItemCategoriesController],
  providers: [ItemCategoriesService, ItemCategoriesRestorer],
})
export class ItemCategoriesModule {}
