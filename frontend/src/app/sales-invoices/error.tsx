"use client";

import { RouteErrorFallback } from "@/components/route-error-fallback";

// Route-segment error boundary — keeps the admin chrome and shows a Persian
// fallback instead of a blank/crashed page.
export default function SegmentError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorFallback title="نمایش صفحه فاکتور فروش با خطا مواجه شد." retry={retry} />;
}
