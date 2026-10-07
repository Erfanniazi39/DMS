import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createTerritorySchema,
  updateTerritorySchema,
  type CreateTerritoryDto,
  type UpdateTerritoryDto,
} from './dto/territory.dto';
import { TerritoriesService } from './territories.service';

// Mirrors ItemCategoriesController. Gated on the customers.* pair (Customer
// Group is customer master data).
@Controller('territories')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class TerritoriesController {
  constructor(private readonly territoriesService: TerritoriesService) {}

  // Active-only, no permission beyond being logged in — backs the territory
  // dropdown on the Customer form and list filter. Do not gate.
  @Get()
  list() {
    return this.territoriesService.list();
  }

  // Every territory including inactive ones, for the /territories page.
  @Get('all')
  @RequirePermissions('customers.view')
  listAll() {
    return this.territoriesService.listAll();
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@Body(new ZodValidationPipe(createTerritorySchema)) dto: CreateTerritoryDto, @Req() req: Request) {
    return this.territoriesService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateTerritorySchema)) dto: UpdateTerritoryDto,
    @Req() req: Request,
  ) {
    return this.territoriesService.update(id, dto, req.session.userId ?? null, req.ip);
  }
}
