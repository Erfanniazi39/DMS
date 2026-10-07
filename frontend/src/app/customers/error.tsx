"use client";

import { RouteErrorFallback } from "@/components/route-error-fallback";

// Route-segment error boundary — same as app/purchases/error.tsx.
export default function SegmentError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorFallback title="نمایش صفحه مشتری با خطا مواجه شد." retry={retry} />;
}
