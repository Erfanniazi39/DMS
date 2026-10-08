import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { parsePagination } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { DeliveriesService, type DeliveryActor } from './deliveries.service';
import {
  createDeliverySchema,
  deliveryListQuerySchema,
  deliveryQueueQuerySchema,
  postDeliverySchema,
  updateDeliverySchema,
  type CreateDeliveryDto,
  type DeliveryListQuery,
  type DeliveryQueueQuery,
  type PostDeliveryDto,
  type UpdateDeliveryDto,
} from './dto/delivery.dto';

function actorOf(req: Request): DeliveryActor {
  return { userId: req.session.userId ?? null, ipAddress: req.ip };
}

// Reading needs sales.view. Everything that writes — creating / editing /
// deleting a draft and posting — needs sales.deliver: a delivery note is the
// warehouse's document (build plan B5: WAREHOUSE holds sales.deliver but not
// sales.manage, SALESPERSON the reverse), so the person who sells is not the
// one who issues the goods. The create-form lookup (order-context) is
// sales.deliver too, since only its users need it.
@Controller('deliveries')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  @RequirePermissions('sales.view')
  list(@Query(new ZodValidationPipe(deliveryListQuerySchema)) query: DeliveryListQuery) {
    return this.deliveries.list(
      {
        q: query.q?.trim() || undefined,
        status: query.status,
        customerId: query.customerId,
        salesOrderId: query.salesOrderId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      parsePagination(query.page, query.pageSize),
    );
  }

  // Declared before ':id' so they aren't captured by ParseIntPipe.
  @Get('queue')
  @RequirePermissions('sales.view')
  queue(@Query(new ZodValidationPipe(deliveryQueueQuerySchema)) query: DeliveryQueueQuery) {
    return this.deliveries.queue(query.q?.trim() || undefined, parsePagination(query.page, query.pageSize));
  }

  @Get('order-context/:salesOrderId')
  @RequirePermissions('sales.deliver')
  orderContext(@Param('salesOrderId', ParseIntPipe) salesOrderId: number) {
    return this.deliveries.orderContext(salesOrderId);
  }

  @Get(':id')
  @RequirePermissions('sales.view')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.deliveries.get(id);
  }

  @Get(':id/history')
  @RequirePermissions('sales.view')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.deliveries.history(id);
  }

  @Post()
  @RequirePermissions('sales.deliver')
  create(@Body(new ZodValidationPipe(createDeliverySchema)) dto: CreateDeliveryDto, @Req() req: Request) {
    return this.deliveries.createFromOrder(dto, actorOf(req));
  }

  @Patch(':id')
  @RequirePermissions('sales.deliver')
  update(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(updateDeliverySchema)) dto: UpdateDeliveryDto, @Req() req: Request) {
    return this.deliveries.update(id, dto, actorOf(req));
  }

  // DRAFT only.
  @Delete(':id')
  @RequirePermissions('sales.deliver')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.deliveries.remove(id, actorOf(req));
  }

  // DRAFT → POSTED (number + stock issue + order progress).
  @Post(':id/post')
  @RequirePermissions('sales.deliver')
  post(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(postDeliverySchema)) dto: PostDeliveryDto, @Req() req: Request) {
    return this.deliveries.post(id, dto, actorOf(req));
  }
}
