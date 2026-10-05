import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { parsePagination } from '../common/pagination';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import {
  createPurchaseDocumentSchema,
  createPurchasePaymentSchema,
  createPurchaseReturnSchema,
  createPurchaseSchema,
  purchaseListQuerySchema,
  updatePurchasePaymentSchema,
  updatePurchaseSchema,
  type CreatePurchaseDocumentDto,
  type CreatePurchaseDto,
  type CreatePurchasePaymentDto,
  type CreatePurchaseReturnDto,
  type PurchaseListQuery,
  type UpdatePurchaseDto,
  type UpdatePurchasePaymentDto,
} from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';
import { PurchasePaymentsService } from './purchase-payments.service';
import { ALLOWED_DOCUMENT_EXTENSIONS, PurchaseDocumentsService } from './purchase-documents.service';
import { PurchaseReturnsService } from './purchase-returns.service';

@Controller('purchases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchasesController {
  // Each sub-resource is served by its own service; routes, permissions and
  // request/response shapes are unchanged by that split.
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly paymentsService: PurchasePaymentsService,
    private readonly documentsService: PurchaseDocumentsService,
    private readonly returnsService: PurchaseReturnsService,
  ) {}

  @Get()
  @RequirePermissions('purchases.view')
  // Filters are validated by purchaseListQuerySchema (unknown enum values,
  // unparseable dates or non-numeric ids → 400, not a raw 500). sourceType:
  // All / Operational / Historical reporting — omitted returns both kinds.
  // page/pageSize: opt-in pagination — see parsePagination(). Omitted = full
  // array.
  list(@Query(new ZodValidationPipe(purchaseListQuerySchema)) query: PurchaseListQuery) {
    const pagination = parsePagination(query.page, query.pageSize);
    return this.purchasesService.list({
      q: query.q || undefined,
      purchaseTypeId: query.purchaseTypeId,
      status: query.status,
      paymentStatus: query.paymentStatus,
      supplierId: query.supplierId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      sourceType: query.sourceType,
    }, pagination);
  }

  @Get(':id')
  @RequirePermissions('purchases.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.purchasesService.get(id);
  }

  @Post()
  @RequirePermissions('purchases.manage')
  create(@Body(new ZodValidationPipe(createPurchaseSchema)) dto: CreatePurchaseDto, @Req() req: Request) {
    return this.purchasesService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('purchases.edit')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updatePurchaseSchema)) dto: UpdatePurchaseDto,
    @Req() req: Request,
  ) {
    return this.purchasesService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  // Narrow on purpose — see PurchasesService.remove() for why (historical
  // data: a purchase with payments or documents attached can't be deleted).
  @Delete(':id')
  @RequirePermissions('purchases.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.purchasesService.remove(id, req.session.userId ?? null, req.ip);
  }

  @Post(':id/payments')
  @RequirePermissions('purchases.manage')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createPurchasePaymentSchema)) dto: CreatePurchasePaymentDto,
    @Req() req: Request,
  ) {
    return this.paymentsService.addPayment(id, dto, req.session.userId ?? null, req.ip);
  }

  // Edit a payment in place — same permission as adding/removing one.
  @Patch(':id/payments/:paymentId')
  @RequirePermissions('purchases.manage')
  updatePayment(
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body(new ZodValidationPipe(updatePurchasePaymentSchema)) dto: UpdatePurchasePaymentDto,
    @Req() req: Request,
  ) {
    return this.paymentsService.updatePayment(id, paymentId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/payments/:paymentId')
  @RequirePermissions('purchases.manage')
  removePayment(@Param('id', ParseIntPipe) id: number, @Param('paymentId', ParseIntPipe) paymentId: number, @Req() req: Request) {
    return this.paymentsService.removePayment(id, paymentId, req.session.userId ?? null, req.ip);
  }

  // Return to Vendor — sub-resource of a Purchase, same shape as payments.
  // Reading needs only purchases.view; creating/deleting needs
  // purchases.manage specifically (business decision 2026-10-05).
  @Get(':id/returns')
  @RequirePermissions('purchases.view')
  listReturns(@Param('id', ParseIntPipe) id: number) {
    return this.returnsService.listReturns(id);
  }

  @Get(':id/returns/:returnId')
  @RequirePermissions('purchases.view')
  getReturn(@Param('id', ParseIntPipe) id: number, @Param('returnId', ParseIntPipe) returnId: number) {
    return this.returnsService.getReturn(id, returnId);
  }

  @Post(':id/returns')
  @RequirePermissions('purchases.manage')
  createReturn(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createPurchaseReturnSchema)) dto: CreatePurchaseReturnDto,
    @Req() req: Request,
  ) {
    return this.returnsService.createReturn(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/returns/:returnId')
  @RequirePermissions('purchases.manage')
  removeReturn(@Param('id', ParseIntPipe) id: number, @Param('returnId', ParseIntPipe) returnId: number, @Req() req: Request) {
    return this.returnsService.removeReturn(id, returnId, req.session.userId ?? null, req.ip);
  }

  @Post(':id/documents')
  @RequirePermissions('documents.upload')
  addDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createPurchaseDocumentSchema)) dto: CreatePurchaseDocumentDto,
    @Req() req: Request,
  ) {
    return this.documentsService.addDocument(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('documents.upload')
  removeDocument(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @Req() req: Request) {
    return this.documentsService.removeDocument(id, documentId, req.session.userId ?? null, req.ip);
  }

  // File attached to a document record created just above — same
  // metadata-then-file two-step upload pattern as the Employee endpoints.
  //
  // Held in memory (10 MB cap) rather than streamed straight to disk, so
  // PurchaseDocumentsService.setDocumentFile() can verify the purchase/document pair
  // and the file's actual content (magic bytes, not just the extension)
  // BEFORE anything is written — a mismatched id pair or a renamed .exe never
  // leaves an orphan file in uploads/purchases.
  @Post(':id/documents/:documentId/file')
  @RequirePermissions('documents.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
          callback(new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadDocumentFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.documentsService.setDocumentFile(
      id,
      documentId,
      { originalName: file.originalname, buffer: file.buffer },
      req.session.userId ?? null,
      req.ip,
    );
  }
}
