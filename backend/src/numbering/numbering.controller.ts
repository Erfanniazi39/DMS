import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { updateNumberingSchema, type UpdateNumberingDto } from './dto/numbering.dto';
import { NumberingService } from './numbering.service';

@Controller('numbering')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('numbering.manage')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  list() {
    return this.numbering.list();
  }

  @Put(':docType')
  update(@Param('docType') docType: string, @Body(new ZodValidationPipe(updateNumberingSchema)) dto: UpdateNumberingDto, @Req() req: Request) {
    return this.numbering.update(docType, dto, req.session.userId ?? null, req.ip);
  }

  // Back to the default format (the counter keeps its value).
  @Delete(':docType')
  reset(@Param('docType') docType: string, @Req() req: Request) {
    return this.numbering.reset(docType, req.session.userId ?? null, req.ip);
  }
}
