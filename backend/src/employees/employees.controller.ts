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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { EmployeesService } from './employees.service';
import { createEmployeeSchema, updateEmployeeSchema, type CreateEmployeeDto, type UpdateEmployeeDto } from './dto/employee.dto';

const ALLOWED_PHOTO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ALLOWED_CONTRACT_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);

@Controller('employees')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermissions('employees.view')
  list() { return this.employeesService.list(); }

  @Get(':id')
  @RequirePermissions('employees.view')
  get(@Param('id', ParseIntPipe) id: number) { return this.employeesService.get(id); }

  @Post()
  @RequirePermissions('employees.manage')
  create(@Body(new ZodValidationPipe(createEmployeeSchema)) dto: CreateEmployeeDto) { return this.employeesService.create(dto); }

  // The Zod pipe is bound to the @Body() parameter specifically, not to the
  // method with @UsePipes(). A method-level pipe runs against EVERY
  // parameter — including the :id route param — and since createEmployeeSchema
  // /updateEmployeeSchema expect a whole employee object, running it against
  // the raw "id" string produced "Invalid input: expected object, received
  // string" on every edit. Scoping the pipe to @Body() only fixes that.
  @Patch(':id')
  @RequirePermissions('employees.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateEmployeeSchema)) dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  // Employee photo (اختیاری/optional): stored as a plain file on disk under
  // uploads/employees, not in the database — only its relative URL path is
  // saved on the Employee row. Uploading is a separate step from create/update
  // so the main employee form stays a normal JSON request; the frontend
  // saves the employee first, then uploads the photo against its id.
  @Post(':id/photo')
  @RequirePermissions('employees.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'employees'),
        filename: (_request, file, callback) => {
          const ext = extname(file.originalname).toLowerCase();
          callback(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (_request, file, callback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_PHOTO_EXTENSIONS.has(ext)) {
          callback(new BadRequestException('فقط فایل تصویری با فرمت jpg، png یا webp مجاز است'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadPhoto(@Param('id', ParseIntPipe) id: number, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایل تصویری ارسال نشده است');
    return this.employeesService.updatePhoto(id, `/uploads/employees/${file.filename}`);
  }

  @Delete(':id/photo')
  @RequirePermissions('employees.manage')
  removePhoto(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.updatePhoto(id, null);
  }

  // Contract document (اختیاری/optional): a scan or photo of the signed
  // contract — PDF or image. Same on-disk/separate-upload pattern as the
  // employee photo above, reusing the same uploads/employees folder.
  @Post(':id/contract-document')
  @RequirePermissions('employees.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads', 'employees'),
        filename: (_request, file, callback) => {
          const ext = extname(file.originalname).toLowerCase();
          callback(null, `${randomUUID()}${ext}`);
        },
      }),
      fileFilter: (_request, file, callback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_CONTRACT_DOCUMENT_EXTENSIONS.has(ext)) {
          callback(new BadRequestException('فقط فایل PDF یا تصویر با فرمت jpg، jpeg یا png مجاز است'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadContractDocument(@Param('id', ParseIntPipe) id: number, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.employeesService.updateContractDocument(id, `/uploads/employees/${file.filename}`);
  }

  @Delete(':id/contract-document')
  @RequirePermissions('employees.manage')
  removeContractDocument(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.updateContractDocument(id, null);
  }
}
