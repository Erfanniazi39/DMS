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
import { CustomersService } from './customers.service';
import { CustomerContactsService } from './customer-contacts.service';
import { CustomerAddressesService } from './customer-addresses.service';
import { CustomerNotesService } from './customer-notes.service';
import { ALLOWED_CUSTOMER_DOCUMENT_EXTENSIONS, CustomerDocumentsService } from './customer-documents.service';
import { CustomerComplaintsService } from './customer-complaints.service';
import { CustomerFinancialService } from './customer-financial.service';
import {
  changeCustomerStatusSchema,
  createCustomerComplaintSchema,
  createCustomerSchema,
  customerAddressSchema,
  customerContactSchema,
  customerDocumentSchema,
  customerListQuerySchema,
  customerNoteSchema,
  updateCustomerComplaintSchema,
  updateCustomerFinancialSchema,
  updateCustomerSchema,
  type ChangeCustomerStatusDto,
  type CreateCustomerComplaintDto,
  type CreateCustomerDto,
  type CustomerAddressDto,
  type CustomerContactDto,
  type CustomerDocumentDto,
  type CustomerListQuery,
  type CustomerNoteDto,
  type UpdateCustomerComplaintDto,
  type UpdateCustomerFinancialDto,
  type UpdateCustomerDto,
} from './dto/customer.dto';

function hasPermission(req: Request, permission: string) {
  return (req.session?.permissions ?? []).includes(permission);
}

// Reading needs customers.view; every write needs customers.manage, except
// the financial profile (customers.finance) and archive/unarchive
// (customers.archive, on top of customers.manage — checked in
// CustomersService.changeStatus()). Each sub-resource is served by its own
// service.
@Controller('customers')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly contactsService: CustomerContactsService,
    private readonly addressesService: CustomerAddressesService,
    private readonly notesService: CustomerNotesService,
    private readonly documentsService: CustomerDocumentsService,
    private readonly complaintsService: CustomerComplaintsService,
    private readonly financialService: CustomerFinancialService,
  ) {}

  @Get()
  @RequirePermissions('customers.view')
  list(@Query(new ZodValidationPipe(customerListQuerySchema)) query: CustomerListQuery) {
    return this.customersService.list(
      {
        q: query.q,
        status: query.status,
        customerGroupId: query.customerGroupId,
        territoryId: query.territoryId,
        customerKind: query.customerKind,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so it isn't captured by ParseIntPipe.
  @Get('assignable-users')
  @RequirePermissions('customers.manage')
  assignableUsers() {
    return this.customersService.listAssignableUsers();
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.customersService.get(id, { canViewSensitive: hasPermission(req, 'customers.manage') || hasPermission(req, 'customers.finance') });
  }

  @Get(':id/history')
  @RequirePermissions('customers.view')
  history(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.customersService.history(id, { canViewFinance: hasPermission(req, 'customers.finance') });
  }

  @Post()
  @RequirePermissions('customers.manage')
  create(@Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerDto, @Req() req: Request) {
    return this.customersService.create(dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerDto, @Req() req: Request) {
    return this.customersService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/status')
  @RequirePermissions('customers.manage')
  changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(changeCustomerStatusSchema)) dto: ChangeCustomerStatusDto,
    @Req() req: Request,
  ) {
    return this.customersService.changeStatus(id, dto, { canArchive: hasPermission(req, 'customers.archive') }, req.session.userId ?? null, req.ip);
  }

  // Narrow on purpose — see CustomersService.remove().
  @Delete(':id')
  @RequirePermissions('customers.manage')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.customersService.remove(id, req.session.userId ?? null, req.ip);
  }

  // --- Contacts ----------------------------------------------------------------

  @Post(':id/contacts')
  @RequirePermissions('customers.manage')
  addContact(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(customerContactSchema)) dto: CustomerContactDto, @Req() req: Request) {
    return this.contactsService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions('customers.manage')
  updateContact(
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body(new ZodValidationPipe(customerContactSchema)) dto: CustomerContactDto,
    @Req() req: Request,
  ) {
    return this.contactsService.update(id, contactId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions('customers.manage')
  removeContact(@Param('id', ParseIntPipe) id: number, @Param('contactId', ParseIntPipe) contactId: number, @Req() req: Request) {
    return this.contactsService.remove(id, contactId, req.session.userId ?? null, req.ip);
  }

  // --- Addresses ---------------------------------------------------------------

  @Post(':id/addresses')
  @RequirePermissions('customers.manage')
  addAddress(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(customerAddressSchema)) dto: CustomerAddressDto, @Req() req: Request) {
    return this.addressesService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions('customers.manage')
  updateAddress(
    @Param('id', ParseIntPipe) id: number,
    @Param('addressId', ParseIntPipe) addressId: number,
    @Body(new ZodValidationPipe(customerAddressSchema)) dto: CustomerAddressDto,
    @Req() req: Request,
  ) {
    return this.addressesService.update(id, addressId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermissions('customers.manage')
  removeAddress(@Param('id', ParseIntPipe) id: number, @Param('addressId', ParseIntPipe) addressId: number, @Req() req: Request) {
    return this.addressesService.remove(id, addressId, req.session.userId ?? null, req.ip);
  }

  // --- Notes -------------------------------------------------------------------

  @Post(':id/notes')
  @RequirePermissions('customers.manage')
  addNote(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(customerNoteSchema)) dto: CustomerNoteDto, @Req() req: Request) {
    return this.notesService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/notes/:noteId')
  @RequirePermissions('customers.manage')
  updateNote(
    @Param('id', ParseIntPipe) id: number,
    @Param('noteId', ParseIntPipe) noteId: number,
    @Body(new ZodValidationPipe(customerNoteSchema)) dto: CustomerNoteDto,
    @Req() req: Request,
  ) {
    return this.notesService.update(id, noteId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/notes/:noteId')
  @RequirePermissions('customers.manage')
  removeNote(@Param('id', ParseIntPipe) id: number, @Param('noteId', ParseIntPipe) noteId: number, @Req() req: Request) {
    return this.notesService.remove(id, noteId, req.session.userId ?? null, req.ip);
  }

  // --- Complaints --------------------------------------------------------------

  @Post(':id/complaints')
  @RequirePermissions('customers.manage')
  addComplaint(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createCustomerComplaintSchema)) dto: CreateCustomerComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintsService.create(id, dto, req.session.userId ?? null, req.ip);
  }

  @Patch(':id/complaints/:complaintId')
  @RequirePermissions('customers.manage')
  updateComplaint(
    @Param('id', ParseIntPipe) id: number,
    @Param('complaintId', ParseIntPipe) complaintId: number,
    @Body(new ZodValidationPipe(updateCustomerComplaintSchema)) dto: UpdateCustomerComplaintDto,
    @Req() req: Request,
  ) {
    return this.complaintsService.update(id, complaintId, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/complaints/:complaintId')
  @RequirePermissions('customers.manage')
  removeComplaint(@Param('id', ParseIntPipe) id: number, @Param('complaintId', ParseIntPipe) complaintId: number, @Req() req: Request) {
    return this.complaintsService.remove(id, complaintId, req.session.userId ?? null, req.ip);
  }

  // --- Financial profile (customers.finance only) --------------------------------

  @Get(':id/financial')
  @RequirePermissions('customers.finance')
  getFinancial(@Param('id', ParseIntPipe) id: number) {
    return this.financialService.get(id);
  }

  @Patch(':id/financial')
  @RequirePermissions('customers.finance')
  updateFinancial(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateCustomerFinancialSchema)) dto: UpdateCustomerFinancialDto,
    @Req() req: Request,
  ) {
    return this.financialService.update(id, dto, req.session.userId ?? null, req.ip);
  }

  // --- Documents -----------------------------------------------------------------

  @Post(':id/documents')
  @RequirePermissions('customers.manage')
  addDocument(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(customerDocumentSchema)) dto: CustomerDocumentDto, @Req() req: Request) {
    return this.documentsService.addDocument(id, dto, req.session.userId ?? null, req.ip);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('customers.manage')
  removeDocument(@Param('id', ParseIntPipe) id: number, @Param('documentId', ParseIntPipe) documentId: number, @Req() req: Request) {
    return this.documentsService.removeDocument(id, documentId, req.session.userId ?? null, req.ip);
  }

  // Same in-memory (10 MB) upload as PurchasesController.uploadDocumentFile().
  @Post(':id/documents/:documentId/file')
  @RequirePermissions('customers.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_CUSTOMER_DOCUMENT_EXTENSIONS.has(ext)) {
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
    return this.documentsService.setDocumentFile(id, documentId, { originalName: file.originalname, buffer: file.buffer }, req.session.userId ?? null, req.ip);
  }
}
