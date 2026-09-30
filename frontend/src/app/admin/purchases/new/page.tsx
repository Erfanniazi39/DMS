"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// This page moved to the top-level "/purchases/new" route. Anything that still links
// here (an old bookmark, etc.) gets bounced there automatically, keeping any
// query string (e.g. "?prefill=" on the new-purchase form).
export default function AdminNewPurchaseRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/purchases/new${window.location.search}`);
  }, [router]);
  return null;
}
