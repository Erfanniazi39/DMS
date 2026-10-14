import { CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// v1 scope switches (business-owner decision, 2026-10-13): built-and-tested
// features hidden from v1 are off by default — the feature behaves as if it
// doesn't exist (404), its data and code stay untouched. Override any flag
// with its env var set to "true" or "false" — read on every call, never
// cached, so tests can flip a flag per case.
export const FEATURE_ENV = {
  salesBackorders: 'DMS_FEATURE_SALES_BACKORDERS',
  inventoryApprovalWorkflow: 'DMS_FEATURE_APPROVAL_WORKFLOW',
  inventoryBatchTracking: 'DMS_FEATURE_BATCH_TRACKING',
  inventoryStockCounts: 'DMS_FEATURE_STOCK_COUNTS',
  inventoryDamagedAndReturns: 'DMS_FEATURE_DAMAGED_AND_RETURNS',
  customerCreditLimit: 'DMS_FEATURE_CREDIT_LIMIT',
  // Customer reference data hidden in v1 (owner, 2026-10-13): territories
  // (مناطق فروش) and payment terms (شرایط پرداخت). Data stays; admin pages,
  // their endpoints and the pickers on customer/sales screens disappear.
  customerTerritories: 'DMS_FEATURE_TERRITORIES',
  paymentTerms: 'DMS_FEATURE_PAYMENT_TERMS',
  // Sales documents moving stock (owner, 2026-10-14): OFF in v1 — order
  // confirmation doesn't reserve, delivery posting doesn't issue, sales
  // returns don't receive/restock. No stock balance changes at all, so rule 10
  // (no balance change without a StockMovement) still holds. Turn on once
  // Inventory is finished (after v1.0).
  salesStockEffects: 'DMS_FEATURE_SALES_STOCK',
} as const;

export type FeatureFlag = keyof typeof FEATURE_ENV;

// salesBackorders is ON in v1 (owner, 2026-10-13): a stock shortfall on a
// sales order becomes a backorder instead of blocking confirmation. Set
// DMS_FEATURE_SALES_BACKORDERS=false for the hard stock block instead.
const FEATURE_DEFAULTS: Partial<Record<FeatureFlag, boolean>> = { salesBackorders: true };

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const value = process.env[FEATURE_ENV[flag]];
  if (value === 'true') return true;
  if (value === 'false') return false;
  return FEATURE_DEFAULTS[flag] ?? false;
}

export function featureFlags(): Record<FeatureFlag, boolean> {
  return Object.fromEntries((Object.keys(FEATURE_ENV) as FeatureFlag[]).map((flag) => [flag, isFeatureEnabled(flag)])) as Record<
    FeatureFlag,
    boolean
  >;
}

export const FEATURE_KEY = 'requiredFeature';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const flag = this.reflector.getAllAndOverride<FeatureFlag | undefined>(FEATURE_KEY, [context.getHandler(), context.getClass()]);
    if (flag && !isFeatureEnabled(flag)) throw new NotFoundException();
    return true;
  }
}

// Controller- or method-level only, never inside services — service specs
// for hidden features must keep exercising the dormant code unchanged.
export const RequireFeature = (flag: FeatureFlag) => applyDecorators(SetMetadata(FEATURE_KEY, flag), UseGuards(FeatureGuard));
