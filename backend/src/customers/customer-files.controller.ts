import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CustomerDocumentsService } from './customer-documents.service';

// Serves customer document files — same shape as PurchaseFilesController:
// never a static mount; needs a session with customers.view (the permission
// GET /customers/:id, which exposes filePath, requires).
@Controller('uploads/customers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomerFilesController {
  constructor(private readonly documentsService: CustomerDocumentsService) {}

  @Get(':filename')
  @RequirePermissions('customers.view')
  async download(@Param('filename') filename: string, @Res() res: Response) {
    const absolutePath = await this.documentsService.resolveDocumentFile(filename);
    res.sendFile(absolutePath, {
      headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    });
  }
}
