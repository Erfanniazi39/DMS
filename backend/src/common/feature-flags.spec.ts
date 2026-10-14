import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { FeatureGuard, featureFlags, isFeatureEnabled } from './feature-flags';

const context = { getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
const reflectorReturning = (flag: string | undefined) => ({ getAllAndOverride: jest.fn().mockReturnValue(flag) }) as unknown as Reflector;

describe('feature flags', () => {
  afterEach(() => {
    delete process.env.DMS_FEATURE_STOCK_COUNTS;
  });

  it('v1 defaults: only salesBackorders is on; every hidden feature is off', () => {
    // The jest setup turns salesStockEffects on so the sales specs exercise the dormant stock code.
    delete process.env.DMS_FEATURE_SALES_STOCK;
    const { salesBackorders, ...hidden } = featureFlags();
    expect(salesBackorders).toBe(true);
    expect(Object.values(hidden).every((enabled) => !enabled)).toBe(true);
  });

  it('an explicit "false" overrides an on-by-default flag', () => {
    process.env.DMS_FEATURE_SALES_BACKORDERS = 'false';
    expect(isFeatureEnabled('salesBackorders')).toBe(false);
    delete process.env.DMS_FEATURE_SALES_BACKORDERS;
  });

  it('a flag turns on only for the exact value "true", read on every call', () => {
    process.env.DMS_FEATURE_STOCK_COUNTS = '1';
    expect(isFeatureEnabled('inventoryStockCounts')).toBe(false);
    process.env.DMS_FEATURE_STOCK_COUNTS = 'true';
    expect(isFeatureEnabled('inventoryStockCounts')).toBe(true);
  });

  it('FeatureGuard 404s a route whose feature is off, and lets it through once on', () => {
    const guard = new FeatureGuard(reflectorReturning('inventoryStockCounts'));
    expect(() => guard.canActivate(context)).toThrow(NotFoundException);
    process.env.DMS_FEATURE_STOCK_COUNTS = 'true';
    expect(guard.canActivate(context)).toBe(true);
  });

  it('FeatureGuard ignores routes with no @RequireFeature', () => {
    expect(new FeatureGuard(reflectorReturning(undefined)).canActivate(context)).toBe(true);
  });
});
