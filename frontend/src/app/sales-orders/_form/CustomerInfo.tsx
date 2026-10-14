"use client";

import { useEffect, useState } from "react";
import { apiFetch, type ApiError } from "@/lib/api";
import type { CustomerContext } from "../shared";
import { CustomerPanel } from "./CustomerPanel";

// CustomerPanel for screens that only know the customer id (e.g. the
// historical-sales blocks): fetches GET /sales-orders/customer-context/:id
// itself (sales.manage). The order form keeps its own fetch — it also needs
// the delivery addresses from the same response.
export function CustomerInfo({ customerId }: { customerId: number | null }) {
  const [state, setState] = useState<{ customerId: number; context: CustomerContext | null; error: string | null } | null>(null);

  useEffect(() => {
    if (customerId === null) return;
    let ignore = false;
    apiFetch<CustomerContext>(`/sales-orders/customer-context/${customerId}`)
      .then((context) => {
        if (!ignore) setState({ customerId, context, error: null });
      })
      .catch((reason: unknown) => {
        if (!ignore) setState({ customerId, context: null, error: (reason as ApiError).message ?? "دریافت اطلاعات مشتری ناموفق بود." });
      });
    return () => {
      ignore = true;
    };
  }, [customerId]);

  const current = customerId !== null && state?.customerId === customerId ? state : null;
  return <CustomerPanel context={current?.context ?? null} loading={customerId !== null && current === null} error={current?.error ?? null} />;
}
