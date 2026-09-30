"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// This page moved to the top-level "/purchase-requests/[id]" route. Anything that still links
// here (an old bookmark, etc.) gets bounced there automatically, keeping any
// query string.
export default function AdminPurchaseRequestDetailRedirect() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/purchase-requests/${encodeURIComponent(params.id)}${window.location.search}`);
  }, [router, params.id]);
  return null;
}
