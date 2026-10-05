"use client";

// The logged-in user's session (from GET /auth/me), provided once by the app
// shell (components/app-shell/AppShell.tsx) and read anywhere below it.
// Permissions here are a UI convenience only — the backend re-checks every
// request (SessionAuthGuard + @RequirePermissions).

import { createContext, useContext } from "react";

export type SessionUser = {
  id: number;
  username: string;
  permissions: string[];
};

export const SessionUserContext = createContext<SessionUser | null>(null);

export function useSessionUser() {
  return useContext(SessionUserContext);
}

// Legacy names, kept so existing call sites (which import useAdminUser from
// "@/app/admin/layout") keep working unchanged. Same context, same hook —
// new code should prefer SessionUserContext / useSessionUser.
export const AdminUserContext = SessionUserContext;
export const useAdminUser = useSessionUser;
