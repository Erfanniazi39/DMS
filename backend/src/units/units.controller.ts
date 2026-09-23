import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { UnitsService } from './units.service';

@Controller('units')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  list() {
    return this.unitsService.list();
  }
}
