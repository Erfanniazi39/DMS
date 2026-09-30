"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// This page moved to the top-level "/purchase-requests/new" route. Anything that still links
// here (an old bookmark, etc.) gets bounced there automatically, keeping any
// query string.
export default function AdminNewPurchaseRequestRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/purchase-requests/new${window.location.search}`);
  }, [router]);
  return null;
}
