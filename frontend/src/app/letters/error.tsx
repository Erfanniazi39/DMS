"use client";

import { RouteErrorFallback } from "@/components/route-error-fallback";

export default function SegmentError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorFallback title="نمایش نامه‌ها با خطا مواجه شد." retry={retry} />;
}
