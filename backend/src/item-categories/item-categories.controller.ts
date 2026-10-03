import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createItemCategorySchema,
  updateItemCategorySchema,
  type CreateItemCategoryDto,
  type UpdateItemCategoryDto,
} from './dto/item-category.dto';
import { ItemCategoriesService } from './item-categories.service';

// Mirrors UnitsController. Gated on the items.* pair, which covers both
// Item and Item Category (one master-data domain).
@Controller('item-categories')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ItemCategoriesController {
  constructor(private readonly itemCategoriesService: ItemCategoriesService) {}

  // Active-only, no permission beyond being logged in — backs the category
  // dropdown on the Item form. Do not gate.
  @Get()
  list() {
    return this.itemCategoriesService.list();
  }

  // Every category including inactive ones, for the /item-categories page.
  @Get('all')
  @RequirePermissions('items.view')
  listAll() {
    return this.itemCategoriesService.listAll();
  }

  @Post()
  @RequirePermissions('items.manage')
  create(@Body(new ZodValidationPipe(createItemCategorySchema)) dto: CreateItemCategoryDto) {
    return this.itemCategoriesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('items.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateItemCategorySchema)) dto: UpdateItemCategoryDto,
  ) {
    return this.itemCategoriesService.update(id, dto);
  }
}
