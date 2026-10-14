import { Module } from '@nestjs/common';
import { LetterAttachmentsService } from './letter-attachments.service';
import { LetterLinksService } from './letter-links.service';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';

// Internal correspondence between users. Standalone module: it reads users
// only for "exists and is ACTIVE" and display fields (CLAUDE.md rule 11's
// documented exception). PrismaModule and AuditModule are global.
@Module({
  controllers: [LettersController],
  providers: [LettersService, LetterAttachmentsService, LetterLinksService],
})
export class LettersModule {}
