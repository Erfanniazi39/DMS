"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatMoney } from "@/lib/format";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { AGING_BUCKETS, agingBucketLabels, NoAccess, type AgingRow } from "../../receipts/shared";

type AgingReportRow = { customerId: number; customerNumber: string; customerName: string; aging: AgingRow };

const ZERO_ROW: AgingRow = { CURRENT: "0", D1_30: "0", D31_60: "0", D61_90: "0", D90_PLUS: "0", total: "0" };

// سالمندی مطالبات — GET /receivables/aging (receivables.view): every
// customer with at least one open invoice, bucketed by days overdue vs
// today (current/۱-۳۰/۳۱-۶۰/۶۱-۹۰/بیش از ۹۰ — build plan §4.3). Sorted by
// total outstanding, largest first — this is a collections worklist.
export default function ReceivablesAgingPage() {
  const { toasts, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("receivables.view") ?? false;

  const [rows, setRows] = useState<AgingReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<AgingReportRow[]>("/receivables/aging")
      .then((data) => {
        if (!ignore) {
          setRows([...data].sort((a, b) => Number(b.aging.total) - Number(a.aging.total)));
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت گزارش سالمندی مطالبات ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [canView, reloadKey]);

  if (!canView) return <NoAccess message="اجازه مشاهده مطالبات را ندارید." />;

  const totals = rows.reduce(
    (sum, row) => {
      for (const bucket of AGING_BUCKETS) sum[bucket] = String(Number(sum[bucket]) + Number(row.aging[bucket]));
      sum.total = String(Number(sum.total) + Number(row.aging.total));
      return sum;
    },
    { ...ZERO_ROW },
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">سالمندی مطالبات</h1>
          <p className="mt-1 text-sm text-muted-foreground">مانده فاکتورهای باز هر مشتری، بر اساس فاصلهٔ سررسید تا امروز</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {loadError && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <p className="text-sm text-destructive" role="alert">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
            </div>
          ) : loading ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : rows.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">هیچ مشتری‌ای مانده باز ندارد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">مشتری</th>
                    {AGING_BUCKETS.map((bucket) => (
                      <th key={bucket} className="px-3 py-2.5 font-medium">{agingBucketLabels[bucket]}</th>
                    ))}
                    <th className="px-3 py-2.5 font-medium">جمع</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.customerId} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5">
                        <Link href={`/customers/${row.customerId}`} className="text-primary hover:underline"><bdi>{row.customerName}</bdi></Link>{" "}
                        <bdi className="font-mono text-[11px] text-muted-foreground">{row.customerNumber}</bdi>
                      </td>
                      {AGING_BUCKETS.map((bucket) => (
                        <td key={bucket} className={`px-3 py-2.5 tabular-nums ${(bucket === "D61_90" || bucket === "D90_PLUS") && Number(row.aging[bucket]) > 0 ? "font-medium text-destructive" : ""}`}>
                          {formatMoney(row.aging[bucket])}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 font-medium tabular-nums">{formatMoney(row.aging.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/20 font-medium">
                  <tr>
                    <td className="px-3 py-2.5">جمع کل</td>
                    {AGING_BUCKETS.map((bucket) => (
                      <td key={bucket} className="px-3 py-2.5 tabular-nums">{formatMoney(totals[bucket])}</td>
                    ))}
                    <td className="px-3 py-2.5 tabular-nums">{formatMoney(totals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
