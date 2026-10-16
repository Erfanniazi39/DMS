import { BadRequestException, Body, Controller, Delete, Get, Post, Put, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { ZodValidationPipe } from '../auth/zod-validation.pipe';
import { CompanyService, LOGO_EXTENSIONS } from './company.service';
import { updateCompanyProfileSchema, type UpdateCompanyProfileDto } from './dto/company.dto';

// Reading the profile and the logo needs only a login (every printed
// document shows them); changing either needs company.manage.
@Controller('company')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  get() {
    return this.company.get();
  }

  @Put()
  @RequirePermissions('company.manage')
  update(@Body(new ZodValidationPipe(updateCompanyProfileSchema)) dto: UpdateCompanyProfileDto, @Req() req: Request) {
    return this.company.update(dto, req.session.userId ?? null, req.ip);
  }

  @Get('logo')
  async logo(@Res() res: Response) {
    const absolutePath = await this.company.resolveLogo();
    res.sendFile(absolutePath, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' } });
  }

  @Post('logo')
  @RequirePermissions('company.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) => {
        if (!LOGO_EXTENSIONS.has(extname(file.originalname).toLowerCase())) {
          callback(new BadRequestException('فقط تصویر با فرمت png، jpg یا jpeg مجاز است'), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(@Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشد');
    return this.company.setLogo({ originalName: file.originalname, buffer: file.buffer }, req.session.userId ?? null, req.ip);
  }

  @Delete('logo')
  @RequirePermissions('company.manage')
  removeLogo(@Req() req: Request) {
    return this.company.removeLogo(req.session.userId ?? null, req.ip);
  }
}
