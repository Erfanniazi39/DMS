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
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
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
  updatePurchaseSchema,
  type CreatePurchaseDocumentDto,
  type CreatePurchaseDto,
  type CreatePurchasePaymentDto,
  type CreatePurchaseReturnDto,
  type UpdatePurchaseDto,
} from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';

const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

@Controller('purchases')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @RequirePermissions('purchases.view')
  list(
    @Query('q') q?: string,
    @Query('purchaseTypeId') purchaseTypeId?: string,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('supplierId') supplierId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    // All / Operational / Historical reporting — omitted returns both kinds.
    @Query('sourceType') sourceType?: string,
    // Opt-in pagination — see parsePagination(). Omitted = full array.
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pagination = parsePagination(page, pageSize);
    return this.purchasesService.list({
      q: q || undefined,
      purchaseTypeId: purchaseTypeId ? Number(purchaseTypeId) : undefined,
      status: status || undefined,
      paymentStatus: paymentStatus || undefined,
      supplierId: supplierId ? Number(supplierId) : undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      sourceType: sourceType || undefined,
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
    return this.purchasesService.addPayment(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/payments/:paymentId')
  @RequirePermissions('purchases.manage')
  removePayment(@Param('id', ParseIntPipe) id: number, @Param('paymentId', ParseIntPipe) paymentId: number, @Req() req: Request) {
    return this.purchasesService.removePayment(id, paymentId, req.session.userId ?? null, req.ip);
  }

  // Return to Vendor — sub-resource of a Purchase, same shape as payments.
  // All four routes (reads included) require purchases.manage.
  @Get(':id/returns')
  @RequirePermissions('purchases.manage')
  listReturns(@Param('id', ParseIntPipe) id: number) {
    return this.purchasesService.listReturns(id);
  }

  @Get(':id/returns/:returnId')
  @RequirePermissions('purchases.manage')
  getReturn(@Param('id', ParseIntPipe) id: number, @Param('returnId', ParseIntPipe) returnId: number) {
    return this.purchasesService.getReturn(id, returnId);
  }

  @Post(':id/returns')
  @RequirePermissions('purchases.manage')
  createReturn(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createPurchaseReturnSchema)) dto: CreatePurchaseReturnDto,
    @Req() req: Request,
  ) {
    return this.purchasesService.createReturn(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/returns/:returnId')
  @RequirePermissions('purchases.manage')
  removeReturn(@Param('id', ParseIntPipe) id: number, @Param('returnId', ParseIntPipe) returnId: number, @Req() req: Request) {
    return this.purchasesService.removeReturn(id, returnId, req.session.userId ?? null, req.ip);
  }

  @Post(':id/documents')
  @RequirePermissions('documents.upload')
  addDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createPurchaseDocumentSchema)) dto: CreatePurchaseDocumentDto,
    @Req() req: Request,
  ) {
    return this.purchasesService.addDocument(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('documents.upload')
  removeDocument(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @Req() req: Request) {
    return this.purchasesService.removeDocument(id, documentId, req.session.userId ?? null, req.ip);
  }

  // File attached to a document record created just above — same
  // metadata-then-file two-step upload pattern as the Employee endpoints.
  @Post(':id/documents/:documentId/file')
  @RequirePermissions('documents.upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'purchases'),
        filename: (_request, file, callback) => {
          const ext = extname(file.originalname).toLowerCase();
          callback(null, `${randomUUID()}${ext}`);
        },
      }),
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
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.purchasesService.setDocumentFile(id, documentId, `/uploads/purchases/${file.filename}`);
  }
}
