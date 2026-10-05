"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shared fallback UI for the route-level error boundaries (app/*/error.tsx).
// Defense in depth: one malformed record must degrade to this message inside
// the normal admin chrome (the segment's layout stays mounted), never take
// down the whole page for every user. The error itself is deliberately not
// shown or logged here — it may contain record data.
export function RouteErrorFallback({ title, retry }: { title: string; retry: () => void }) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">
          ممکن است یکی از رکوردها داده نامعتبر داشته باشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت با مدیر سیستم تماس بگیرید.
        </p>
        <Button variant="outline" size="sm" onClick={() => retry()}>
          تلاش دوباره
        </Button>
      </div>
    </div>
  );
}
