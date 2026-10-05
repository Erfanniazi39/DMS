import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { PurchaseDocumentsService } from './purchase-documents.service';

// Serves Purchase document files. Replaces the old unauthenticated
// `useStaticAssets('/uploads')` mount for this folder (QA 2026-10-05: a bare
// request with no session could fetch any purchase document). Same URL as
// before — PurchaseDocument.filePath is still `/uploads/purchases/<file>`,
// so the frontend's `/api${document.filePath}` links keep working — but now
// it needs a logged-in session with purchases.view, the same permission
// GET /purchases/:id (which exposes filePath) requires.
@Controller('uploads/purchases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchaseFilesController {
  constructor(private readonly documentsService: PurchaseDocumentsService) {}

  @Get(':filename')
  @RequirePermissions('purchases.view')
  async download(@Param('filename') filename: string, @Res() res: Response) {
    const absolutePath = await this.documentsService.resolveDocumentFile(filename);
    res.sendFile(absolutePath, {
      headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    });
  }
}
