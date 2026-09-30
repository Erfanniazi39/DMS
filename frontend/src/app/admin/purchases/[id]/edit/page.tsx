"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// This page moved to the top-level "/purchases/[id]/edit" route. Anything that still links
// here (an old bookmark, etc.) gets bounced there automatically, keeping any
// query string.
export default function AdminEditPurchaseRedirect() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  useEffect(() => {
    router.replace(`/purchases/${encodeURIComponent(params.id)}/edit${window.location.search}`);
  }, [router, params.id]);
  return null;
}
