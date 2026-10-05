"use client";

import type { ReactNode } from "react";
import { useAdminUser } from "@/app/admin/layout";

// Client-side route guard for form pages reached by URL (e.g.
// /purchases/new): without the permission the form isn't mounted at all —
// no options/record fetches, no duplicate 403 toasts — just the same
// dashed "no access" notice the list/detail pages show. UX only; the
// backend's @RequirePermissions stays authoritative.
export function RequirePermission({ permission, message, children }: { permission: string; message: string; children: ReactNode }) {
  const user = useAdminUser();
  if (!user?.permissions.includes(permission)) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }
  return <>{children}</>;
}
