import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination, parseSort } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { costAccessOf } from './goods-receipts.controller';
import { ProductionOutputsService } from './production-outputs.service';
import {
  createProductionOutputSchema,
  postProductionOutputSchema,
  productionOutputListQuerySchema,
  updateProductionOutputSchema,
  type CreateProductionOutputDto,
  type PostProductionOutputDto,
  type ProductionOutputListQuery,
  type UpdateProductionOutputDto,
} from './dto/production-output.dto';

// Production output (رسید تولید) — Inventory batch I5, build plan §5.11.
// Reading needs inventory.view; create/edit/delete/post need
// inventory.receive (the inbound-stock permission — production output is
// how finished goods are received into stock). Costs in responses are
// masked unless inventory.cost.
@Controller('inventory/production-outputs')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ProductionOutputsController {
  constructor(private readonly outputsService: ProductionOutputsService) {}

  // Declared before ':id' so it isn't captured by ParseIntPipe.
  @Get('form-options')
  @RequirePermissions('inventory.receive')
  formOptions() {
    return this.outputsService.formOptions();
  }

  @Get()
  @RequirePermissions('inventory.view')
  list(@Query(new ZodValidationPipe(productionOutputListQuerySchema)) query: ProductionOutputListQuery) {
    return this.outputsService.list({ q: query.q?.trim() || undefined, status: query.status, sort: parseSort(query.sortBy, query.sortDir) }, parsePagination(query.page, query.pageSize));
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.outputsService.get(id, costAccessOf(req));
  }

  @Post()
  @RequirePermissions('inventory.receive')
  create(@Body(new ZodValidationPipe(createProductionOutputSchema)) dto: CreateProductionOutputDto, @Req() req: Request) {
    return this.outputsService.create(dto, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('inventory.receive')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateProductionOutputSchema)) dto: UpdateProductionOutputDto, @Req() req: Request) {
    return this.outputsService.update(id, dto, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT → POSTED: assigns PRD-<year>-NNNNNN and writes PRODUCTION_OUTPUT
  // ON_HAND movements at each line's batch.
  @Post(':id/post')
  @RequirePermissions('inventory.receive')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postProductionOutputSchema)) dto: PostProductionOutputDto, @Req() req: Request) {
    return this.outputsService.post(id, dto.updatedAt, costAccessOf(req), req.session.userId ?? null, req.ip);
  }

  // DRAFT only — a posted output can never be deleted.
  @Delete(':id')
  @RequirePermissions('inventory.delete')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.outputsService.remove(id, req.session.userId ?? null, req.ip);
  }
}
