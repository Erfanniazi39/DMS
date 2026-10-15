"use client";

import type { ReactNode } from "react";
import { useHasPermission } from "@/lib/session";

// Renders children only when the logged-in user holds the permission — used to
// hide buttons (e.g. «حذف»). UI convenience only; the backend re-checks.
export function HasPermission({ code, children }: { code: string; children: ReactNode }) {
  return useHasPermission(code) ? <>{children}</> : null;
}
