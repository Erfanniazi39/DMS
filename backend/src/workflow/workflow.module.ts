import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowRulesService } from './workflow-rules.service';
import { WorkflowService } from './workflow.service';

// Approval/workflow engine. Depends on Prisma + Audit (both global) and
// LettersModule (notification letters via sendSystemLetter — Letters imports
// no business module, so no cycle);
// owning modules (Purchases, Sales, Purchase Requests) import this module and
// call WorkflowService — it never imports them (one direction, no cycle).
@Module({
  imports: [LettersModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowRulesService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
