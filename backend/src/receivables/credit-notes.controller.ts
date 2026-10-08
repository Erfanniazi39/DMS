import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { CreditNotesService, type CreditNoteActor } from './credit-notes.service';
import {
  createCreditNoteSchema,
  creditNoteListQuerySchema,
  postCreditNoteSchema,
  type CreateCreditNoteDto,
  type CreditNoteListQuery,
  type PostCreditNoteDto,
} from './dto/credit-note.dto';

function actorOf(req: Request): CreditNoteActor {
  return { userId: req.session.userId ?? null, ipAddress: req.ip };
}

// Reading needs sales.view (a credit note is a sales-side document, read
// the same way an invoice is). Creating/posting/deleting needs sales.invoice
// — mirrors invoicing's own permission (build plan: "create/post needs
// sales.invoice, mirrors invoicing's permission").
@Controller('credit-notes')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Get()
  @RequirePermissions('sales.view')
  list(@Query(new ZodValidationPipe(creditNoteListQuerySchema)) query: CreditNoteListQuery) {
    return this.creditNotes.list(
      {
        q: query.q?.trim() || undefined,
        status: query.status,
        customerId: query.customerId,
        salesInvoiceId: query.salesInvoiceId,
        salesReturnId: query.salesReturnId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.creditNotes.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('sales.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.creditNotes.history(id);
  }

  @Post()
  @RequirePermissions('sales.invoice')
  create(@Body(new ZodValidationPipe(createCreditNoteSchema)) dto: CreateCreditNoteDto, @Req() req: Request) {
    return this.creditNotes.create(dto, actorOf(req));
  }

  @Delete(':id')
  @RequirePermissions('sales.invoice')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.creditNotes.remove(id, actorOf(req));
  }

  @Post(':id/post')
  @RequirePermissions('sales.invoice')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postCreditNoteSchema)) dto: PostCreditNoteDto, @Req() req: Request) {
    return this.creditNotes.post(id, dto, actorOf(req));
  }
}
