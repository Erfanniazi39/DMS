import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { RequireFeature } from '../common/feature-flags';
import { DEFAULT_PAGE_SIZE, parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createWorkflowRuleSchema,
  reorderWorkflowRulesSchema,
  testWorkflowRuleSchema,
  updateWorkflowRuleSchema,
  workflowInboxQuerySchema,
  type CreateWorkflowRuleDto,
  type ReorderWorkflowRulesDto,
  type TestWorkflowRuleDto,
  type UpdateWorkflowRuleDto,
  type WorkflowInboxQuery,
} from './dto/workflow.dto';
import { WorkflowRulesService, type WorkflowActor } from './workflow-rules.service';
import { WorkflowService } from './workflow.service';

function actorOf(req: Request): WorkflowActor {
  // SessionAuthGuard guarantees a session user.
  return { userId: req.session.userId as number, ipAddress: req.ip };
}

// Whole controller is behind the workflowApprovals flag (404 while off).
// Static routes are declared before ':id' ones.
@Controller('workflow')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('workflowApprovals')
export class WorkflowController {
  constructor(
    private readonly rules: WorkflowRulesService,
    private readonly engine: WorkflowService,
  ) {}

  @Get('form-options')
  @RequirePermissions('workflow.manage')
  formOptions() {
    return this.rules.formOptions();
  }

  @Get('rules')
  @RequirePermissions('workflow.manage')
  listRules(@Query('documentType') documentType?: string) {
    return this.rules.list(documentType);
  }

  @Post('rules/reorder')
  @RequirePermissions('workflow.manage')
  reorder(@Body(new ZodValidationPipe(reorderWorkflowRulesSchema)) dto: ReorderWorkflowRulesDto, @Req() req: Request) {
    return this.rules.reorder(dto, actorOf(req));
  }

  @Post('rules/test')
  @RequirePermissions('workflow.manage')
  test(@Body(new ZodValidationPipe(testWorkflowRuleSchema)) dto: TestWorkflowRuleDto) {
    return this.rules.test(dto);
  }

  @Get('rules/:id')
  @RequirePermissions('workflow.manage')
  getRule(@Param('id', ParseIntPipe) id: number) {
    return this.rules.get(id);
  }

  @Post('rules')
  @RequirePermissions('workflow.manage')
  createRule(@Body(new ZodValidationPipe(createWorkflowRuleSchema)) dto: CreateWorkflowRuleDto, @Req() req: Request) {
    return this.rules.create(dto, actorOf(req));
  }

  @Put('rules/:id')
  @RequirePermissions('workflow.manage')
  updateRule(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateWorkflowRuleSchema)) dto: UpdateWorkflowRuleDto, @Req() req: Request) {
    return this.rules.update(id, dto, actorOf(req));
  }

  @Post('rules/:id/activate')
  @RequirePermissions('workflow.manage')
  activate(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.rules.setActive(id, true, actorOf(req));
  }

  @Post('rules/:id/deactivate')
  @RequirePermissions('workflow.manage')
  deactivate(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.rules.setActive(id, false, actorOf(req));
  }

  @Delete('rules/:id')
  @RequirePermissions('workflow.manage')
  removeRule(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.rules.remove(id, actorOf(req));
  }

  @Get('stuck')
  @RequirePermissions('workflow.manage')
  stuck() {
    return this.engine.stuck();
  }

  @Get('inbox/count')
  @RequirePermissions('workflow.inbox')
  async inboxCount(@Req() req: Request) {
    return { count: await this.engine.inboxCount(actorOf(req).userId) };
  }

  @Get('inbox')
  @RequirePermissions('workflow.inbox')
  inbox(@Query(new ZodValidationPipe(workflowInboxQuerySchema)) query: WorkflowInboxQuery, @Req() req: Request) {
    const pagination = parsePagination(query.page, query.pageSize) ?? { page: 1, pageSize: DEFAULT_PAGE_SIZE };
    return this.engine.inbox(actorOf(req).userId, query.tab, pagination);
  }
}
