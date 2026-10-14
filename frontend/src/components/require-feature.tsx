"use client";

import type { ReactNode } from "react";
import { useFeature, type FeatureFlag } from "@/lib/session";

// Route guard for features hidden in v1 (reached by a direct URL or an old
// link). The backend 404s the same feature's endpoints, so nothing below
// is mounted — no fetches, no error toasts.
export function RequireFeature({ feature, children }: { feature: FeatureFlag; children: ReactNode }) {
  if (!useFeature(feature)) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          این بخش در نسخهٔ فعلی سامانه فعال نیست.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
