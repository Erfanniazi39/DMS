import { Module } from '@nestjs/common';
import { LetterAttachmentsService } from './letter-attachments.service';
import { LetterLinksService } from './letter-links.service';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';

// Internal correspondence between users. Standalone module: it reads users
// only for "exists and is ACTIVE" and display fields (CLAUDE.md rule 11's
// documented exception). PrismaModule and AuditModule are global.
// Exports LettersService for sendSystemLetter() only (workflow notifications);
// LettersModule itself imports no business module, so no cycle can form.
@Module({
  controllers: [LettersController],
  providers: [LettersService, LetterAttachmentsService, LetterLinksService],
  exports: [LettersService],
})
export class LettersModule {}
