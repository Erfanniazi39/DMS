"use client";

// The logged-in user's session (from GET /auth/me), provided once by the app
// shell (components/app-shell/AppShell.tsx) and read anywhere below it.
// Permissions here are a UI convenience only — the backend re-checks every
// request (SessionAuthGuard + @RequirePermissions).

import { createContext, useContext } from "react";

// v1 scope switches from the backend (common/feature-flags.ts) — a hidden
// feature's nav entries and routes disappear; its data stays.
export type FeatureFlag =
  | "salesBackorders"
  | "inventoryApprovalWorkflow"
  | "inventoryBatchTracking"
  | "inventoryStockCounts"
  | "inventoryDamagedAndReturns"
  | "customerCreditLimit"
  | "customerTerritories"
  | "paymentTerms"
  | "salesStockEffects";

export type SessionUser = {
  id: number;
  username: string;
  permissions: string[];
  features: Record<FeatureFlag, boolean>;
};

export function useFeature(flag: FeatureFlag) {
  return useContext(SessionUserContext)?.features?.[flag] ?? false;
}

export const SessionUserContext = createContext<SessionUser | null>(null);

export function useSessionUser() {
  return useContext(SessionUserContext);
}

// Legacy names, kept so existing call sites (which import useAdminUser from
// "@/app/admin/layout") keep working unchanged. Same context, same hook —
// new code should prefer SessionUserContext / useSessionUser.
export const AdminUserContext = SessionUserContext;
export const useAdminUser = useSessionUser;
