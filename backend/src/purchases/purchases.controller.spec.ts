import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { PurchasesController } from './purchases.controller';
import type { CreatePurchaseDto } from './dto/purchase.dto';

// A historical purchase skips the approval rules, so POST /purchases must refuse it —
// the dedicated /historical-purchases route calls PurchasesService.create() directly.
describe('PurchasesController.create — source type', () => {
  const request = { session: { userId: 9 }, ip: '127.0.0.1' } as unknown as Request;

  it('refuses sourceType HISTORICAL_IMPORT without touching the service', () => {
    const purchasesService = { create: jest.fn() };
    const controller = new PurchasesController(purchasesService as never, {} as never, {} as never, {} as never);

    expect(() => controller.create({ sourceType: 'HISTORICAL_IMPORT' } as CreatePurchaseDto, request)).toThrow(BadRequestException);
    expect(purchasesService.create).not.toHaveBeenCalled();
  });

  it('passes an operational purchase through', () => {
    const purchasesService = { create: jest.fn().mockResolvedValue({ id: 1 }) };
    const controller = new PurchasesController(purchasesService as never, {} as never, {} as never, {} as never);

    controller.create({ sourceType: 'OPERATIONAL' } as CreatePurchaseDto, request);
    expect(purchasesService.create).toHaveBeenCalledWith({ sourceType: 'OPERATIONAL' }, 9, '127.0.0.1');
  });
});
