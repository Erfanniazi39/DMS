import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { ItemsService } from './items.service';
import { createItemSchema, updateItemSchema, type CreateItemDto, type UpdateItemDto } from './dto/item.dto';

// Item = things the company produces/sells (NOT a purchasing catalog —
// PurchaseItem.name stays free text). Gated on items.view / items.manage,
// the same pair that covers Item Category.
@Controller('items')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequirePermissions('items.view')
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    // Opt-in pagination — see parsePagination(). Omitted = full array.
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.itemsService.list(
      { q: q?.trim() || undefined, status: status || undefined, categoryId: categoryId || undefined },
      parsePagination(page, pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('items.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.itemsService.get(id);
  }

  // Zod pipe bound to @Body() specifically (not @UsePipes) so it never runs
  // against the :id route param — see SuppliersController.
  @Post()
  @RequirePermissions('items.manage')
  create(@Body(new ZodValidationPipe(createItemSchema)) dto: CreateItemDto, @Req() req: Request) {
    return this.itemsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('items.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateItemSchema)) dto: UpdateItemDto,
    @Req() req: Request,
  ) {
    return this.itemsService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id')
  @RequirePermissions('items.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.itemsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
