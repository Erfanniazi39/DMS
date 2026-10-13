"use client";

import { useEffect, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, formatQuantity, type LowStockRow } from "../../shared";

// گزارش کمبود موجودی (I3, B14): فقط کالاهایی که کاربر خودش برایشان آستانه
// تعیین کرده و «موجودی قابل فروش» (موجودی انبار منهای رزروشده) آن‌ها از آن
// آستانه کمتر شده است — این صفحه هیچ درخواست خریدی ایجاد نمی‌کند، فقط عدد
// را نشان می‌دهد. گزارش، نه فرم — با inventory.view قابل مشاهده است (ویرایش
// آستانه‌ها نیازمند inventory.manage در صفحه «آستانه‌های موجودی» است).
export default function LowStockReportPage() {
  const { toasts, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;

  const [rows, setRows] = useState<LowStockRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<LowStockRow[]>("/inventory/reports/low-stock");
        if (!cancelled) setRows(data);
      } catch (reason) {
        if (!cancelled) {
          setRows(null);
          setError((reason as ApiError).message ?? "دریافت گزارش کمبود موجودی ناموفق بود.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, reloadKey]);

  if (!canView) return <NoAccess message="اجازه مشاهده موجودی را ندارید." />;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">گزارش کمبود موجودی</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              کالاهایی که موجودی قابل فروش آن‌ها از آستانه تعیین‌شده (حداقل موجودی) کمتر است.
              برای تعیین یا ویرایش آستانه‌ها به «آستانه‌های موجودی» مراجعه کنید.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            به‌روزرسانی
          </Button>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center text-sm">
            <p className="text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>تلاش دوباره</Button>
          </div>
        ) : loading ? (
          <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری گزارش...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            هیچ کالایی زیر آستانه تعیین‌شده نیست — یا هنوز آستانه‌ای تعیین نشده است.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">کد کالا</th>
                  <th className="px-3 py-2.5 font-medium">نام کالا</th>
                  <th className="px-3 py-2.5 font-medium">واحد</th>
                  <th className="px-3 py-2.5 font-medium">انبار</th>
                  <th className="px-3 py-2.5 font-medium">موجودی قابل فروش</th>
                  <th className="px-3 py-2.5 font-medium">حداقل موجودی</th>
                  <th className="px-3 py-2.5 font-medium">کسری</th>
                  <th className="px-3 py-2.5 font-medium">مقدار سفارش مجدد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-xs">{row.item.code}</td>
                    <td className="px-3 py-2">{row.item.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.item.unit.nameFa}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.location.name}</td>
                    <td className="px-3 py-2 font-medium tabular-nums text-destructive">
                      <span className="inline-flex items-center gap-1.5">
                        <TriangleAlert className="size-3.5" aria-hidden="true" />
                        {formatQuantity(row.available)}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.minQty)}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{formatQuantity(row.shortfall)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(row.reorderQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
