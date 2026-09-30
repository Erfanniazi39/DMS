import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { createUnitSchema, updateUnitSchema, type CreateUnitDto, type UpdateUnitDto } from './dto/unit.dto';
import { UnitsService } from './units.service';

// Unit writes reuse purchases.manage rather than a dedicated permission —
// Units are only consumed by the Purchase / Purchase Request item forms,
// and the sibling master-data entity PurchaseType is gated the same way.
@Controller('units')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  // Active-only, no permission beyond being logged in — backs the unit
  // dropdown on the Purchase / Purchase Request item forms. Do not gate.
  @Get()
  list() {
    return this.unitsService.list();
  }

  // Every unit including inactive ones, for the admin/units page.
  @Get('all')
  @RequirePermissions('purchases.manage')
  listAll() {
    return this.unitsService.listAll();
  }

  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitDto) {
    return this.unitsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('purchases.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitDto) {
    return this.unitsService.update(id, dto);
  }
}
