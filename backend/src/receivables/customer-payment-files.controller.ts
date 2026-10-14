import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CustomerPaymentDocumentsService } from './customer-payment-documents.service';

// Serves customer-payment document files — session + receivables.view (the
// permission that exposes the file path). Same pattern as
// PurchaseFilesController: never mounted statically.
@Controller('uploads/customer-payments')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomerPaymentFilesController {
  constructor(private readonly documents: CustomerPaymentDocumentsService) {}

  @Get(':filename')
  @RequirePermissions('receivables.view')
  async download(@Param('filename') filename: string, @Res() res: Response) {
    const absolutePath = await this.documents.resolveFile(filename);
    res.sendFile(absolutePath, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
  }
}
