"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { returnReasonLabels, salesReturnStatusLabels, salesReturnStatusTone, salesReturnTitle, type SalesReturnListItem } from "../../../sales-returns/shared";
import type { DeliveryDetail } from "../../shared";

// «مرجوعی‌ها» — this delivery's returns: GET /sales-returns?deliveryId=
// (sales.view, unpaginated — one delivery has few). «ثبت مرجوعی»
// (sales.manage) appears on a POSTED delivery and opens
// /sales-returns/new?deliveryId=…, mirroring sales-orders' DeliveriesSection.
export function ReturnsSection({ delivery, canRequestReturn }: { delivery: DeliveryDetail; canRequestReturn: boolean }) {
  const router = useRouter();
  const [returns, setReturns] = useState<SalesReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    apiFetch<SalesReturnListItem[]>(`/sales-returns?deliveryId=${delivery.id}`)
      .then((data) => {
        if (!ignore) {
          setReturns(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت مرجوعی‌های این حواله ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [delivery.id, retryKey]);

  const canCreate = canRequestReturn && delivery.status === "POSTED";

  return (
    <FormSection
      title="مرجوعی‌ها"
      action={
        canCreate ? (
          <Button size="sm" variant="outline" onClick={() => router.push(`/sales-returns/new?deliveryId=${delivery.id}`)}>
            <Undo2 className="size-3.5" aria-hidden="true" />
            ثبت مرجوعی
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : returns.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {delivery.status === "POSTED" ? "هنوز مرجوعی‌ای برای این حواله ثبت نشده است." : "پس از ثبت حواله می‌توان برای آن مرجوعی ثبت کرد."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[36rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">شماره مرجوعی</th>
                <th className="px-3 py-2 font-medium">تاریخ درخواست</th>
                <th className="px-3 py-2 font-medium">علت</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {returns.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/sales-returns/${row.id}`} className={`text-primary hover:underline ${row.returnNumber ? "font-mono text-xs" : "text-xs"}`}>
                      {salesReturnTitle(row)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(row.requestDate)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{returnReasonLabels[row.reason]}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={salesReturnStatusLabels[row.status]} tone={salesReturnStatusTone[row.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}
