import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createPaymentTermSchema,
  updatePaymentTermSchema,
  type CreatePaymentTermDto,
  type UpdatePaymentTermDto,
} from './dto/payment-term.dto';
import { PaymentTermsService } from './payment-terms.service';

// Mirrors CustomerGroupsController. The catalog itself is maintained under
// customers.manage (task decision: reuse customers.view/manage for
// everything except editing a customer's financial profile, which needs
// customers.finance).
@Controller('payment-terms')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PaymentTermsController {
  constructor(private readonly paymentTermsService: PaymentTermsService) {}

  // Active-only, no permission beyond being logged in — backs the payment
  // term dropdown on the customer financial section. Do not gate.
  @Get()
  list() {
    return this.paymentTermsService.list();
  }

  @Get('all')
  @RequirePermissions('customers.view')
  listAll() {
    return this.paymentTermsService.listAll();
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@Body(new ZodValidationPipe(createPaymentTermSchema)) dto: CreatePaymentTermDto, @Req() req: Request) {
    return this.paymentTermsService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updatePaymentTermSchema)) dto: UpdatePaymentTermDto,
    @Req() req: Request,
  ) {
    return this.paymentTermsService.update(id, dto, req.session.userId ?? null, req.ip);
  }
}
