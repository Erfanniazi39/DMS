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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createLetterSchema,
  letterListQuerySchema,
  resolveCodesSchema,
  updateLetterSchema,
  type CreateLetterDto,
  type LetterListQuery,
  type ResolveCodesDto,
  type UpdateLetterDto,
} from './dto/letter.dto';
import { LetterAttachmentsService } from './letter-attachments.service';
import { LetterLinksService } from './letter-links.service';
import { ALLOWED_LETTER_ATTACHMENT_EXTENSIONS, LETTER_ATTACHMENT_TYPES_MESSAGE, MAX_LETTER_ATTACHMENT_BYTES, type LetterAccess } from './letter-rules';
import { LettersService, type LetterActor } from './letters.service';

// Internal letters (نامه‌نگاری). Every user of the system has letters.use;
// what a user may SEE is decided per letter in the service (sender, or a
// recipient of a SENT letter) — a letter you can't see is a 404, not a 403.
function actorOf(req: Request): LetterActor {
  // SessionAuthGuard guarantees a session user.
  return { userId: req.session.userId as number, ipAddress: req.ip };
}

// letters.readAll: management oversight — read-only access to every SENT
// letter (never drafts), each view audited.
function accessOf(req: Request): LetterAccess {
  return { canReadAll: (req.session?.permissions ?? []).includes('letters.readAll') };
}

@Controller('letters')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequirePermissions('letters.use')
export class LettersController {
  constructor(
    private readonly letters: LettersService,
    private readonly attachments: LetterAttachmentsService,
    private readonly links: LetterLinksService,
  ) {}

  @Get()
  list(@Req() req: Request, @Query(new ZodValidationPipe(letterListQuerySchema)) query: LetterListQuery) {
    return this.letters.list(actorOf(req).userId, query, parsePagination(query.page, query.pageSize) ?? { page: 1, pageSize: 20 }, accessOf(req));
  }

  // Static routes before ':id' so ParseIntPipe doesn't capture them.
  @Get('unread-count')
  unreadCount(@Req() req: Request) {
    return this.letters.unreadCount(actorOf(req).userId);
  }

  @Get('directory')
  directory(@Req() req: Request) {
    return this.letters.directory(actorOf(req).userId);
  }

  // POST (a body of codes) but read-only: turns document/item codes found in a
  // letter into links, only for pages the caller's own permissions can open.
  @Post('resolve-codes')
  resolveCodes(@Body(new ZodValidationPipe(resolveCodesSchema)) dto: ResolveCodesDto, @Req() req: Request) {
    return this.links.resolve(dto.codes, req.session?.permissions ?? []);
  }

  @Get('attachments/:attachmentId/file')
  async download(@Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: Request, @Res() res: Response) {
    const { absolutePath, originalName } = await this.attachments.resolveFile(actorOf(req).userId, attachmentId, accessOf(req));
    res.download(absolutePath, originalName, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.get(actorOf(req).userId, id, accessOf(req), req.ip);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createLetterSchema)) dto: CreateLetterDto, @Req() req: Request) {
    return this.letters.create(actorOf(req), dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateLetterSchema)) dto: UpdateLetterDto, @Req() req: Request) {
    return this.letters.update(actorOf(req), id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.remove(actorOf(req), id);
  }

  @Post(':id/send')
  send(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.send(actorOf(req), id);
  }

  // A POST (not a GET) because it changes data — the page calls it on open.
  @Post(':id/read')
  markRead(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.markRead(actorOf(req).userId, id);
  }

  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.archive(actorOf(req).userId, id);
  }

  @Post(':id/unarchive')
  unarchive(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.letters.unarchive(actorOf(req).userId, id);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!ALLOWED_LETTER_ATTACHMENT_EXTENSIONS.has(ext)) {
          callback(new BadRequestException(LETTER_ATTACHMENT_TYPES_MESSAGE), false);
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: MAX_LETTER_ATTACHMENT_BYTES },
    }),
  )
  addAttachment(@Param('id', ParseIntPipe) id: number, @Req() req: Request, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.attachments.add(actorOf(req).userId, id, { originalName: file.originalname, buffer: file.buffer });
  }

  @Delete(':id/attachments/:attachmentId')
  removeAttachment(@Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @Req() req: Request) {
    return this.attachments.remove(actorOf(req).userId, id, attachmentId);
  }
}
