"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, formatQuantity, stockBucketLabels, type IntegrityResult } from "../shared";

// Ledger-vs-balance integrity check (build plan §2.3 finding 4):
// InventoryService.verifyBalances() existed but nothing called it. Admin
// diagnostic only — never writes anything, and does not fix a mismatch; a
// real mismatch should never happen (stock-ledger.ts applyMovements() is the
// only writer of both tables together) and needs manual investigation if it
// ever does.
//
// Gate: inventory.manage (I3) — "admin-level inventory configuration", moved
// here from inventory.adjust (I1's stand-in, before this permission existed).
// WAREHOUSE (inventory.adjust only) loses access; INVENTORY_MANAGER keeps it.
export default function InventoryIntegrityPage() {
  const { toasts, pushError, dismiss } = useToasts();
  const user = useAdminUser();
  const canCheck = user?.permissions.includes("inventory.manage") ?? false;

  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  function runCheck() {
    setChecking(true);
    apiFetch<IntegrityResult>("/inventory/integrity")
      .then(setResult)
      .catch((reason: unknown) => pushError((reason as ApiError).message ?? "بررسی یکپارچگی موجودی ناموفق بود."))
      .finally(() => {
        setChecking(false);
        setLoading(false);
      });
  }

  useEffect(() => {
    if (!canCheck) return;
    // Deferred (not called synchronously in the effect body) — same
    // convention as /inventory/page.tsx, which sidesteps the
    // react-hooks/set-state-in-effect rule the same way.
    const timeout = setTimeout(runCheck, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCheck]);

  if (!canCheck) return <NoAccess message="اجازه بررسی یکپارچگی موجودی را ندارید." />;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">بررسی یکپارچگی موجودی</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              مقایسهٔ مانده هر کالا/انبار با مجموع رویدادهای دفتر موجودی — این صفحه چیزی را اصلاح نمی‌کند، فقط عدم‌تطابق را نشان می‌دهد.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={checking} onClick={runCheck}>
            <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
            بررسی دوباره
          </Button>
        </div>

        {loading ? (
          <p className="py-14 text-center text-sm text-muted-foreground">در حال بررسی...</p>
        ) : !result ? (
          <p className="py-14 text-center text-sm text-muted-foreground">بررسی انجام نشد.</p>
        ) : result.ok ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            هیچ عدم‌تطابقی پیدا نشد — مانده هر کالا/انبار دقیقاً برابر مجموع رویدادهای آن است.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              {(result.mismatches.length + (result.batchMismatches?.length ?? 0)).toLocaleString("fa-IR")} مورد عدم‌تطابق پیدا شد — نیاز به بررسی دستی دارد.
            </div>
            {result.mismatches.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">کالا</th>
                    <th className="px-3 py-2.5 font-medium">انبار</th>
                    <th className="px-3 py-2.5 font-medium">نوع موجودی</th>
                    <th className="px-3 py-2.5 font-medium">مانده ذخیره‌شده</th>
                    <th className="px-3 py-2.5 font-medium">مجموع رویدادها</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.mismatches.map((mismatch, index) => (
                    <tr key={index}>
                      <td className="px-3 py-2 font-mono text-xs">#{mismatch.itemId}</td>
                      <td className="px-3 py-2 font-mono text-xs">#{mismatch.locationId}</td>
                      <td className="px-3 py-2">{stockBucketLabels[mismatch.bucket]}</td>
                      <td className="px-3 py-2 font-medium tabular-nums text-destructive">{formatQuantity(mismatch.balance)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{formatQuantity(mismatch.ledger)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            ) : null}
            {result.batchMismatches && result.batchMismatches.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <p className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">عدم‌تطابق‌های بچ</p>
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">نوع</th>
                      <th className="px-3 py-2.5 font-medium">کالا</th>
                      <th className="px-3 py-2.5 font-medium">انبار</th>
                      <th className="px-3 py-2.5 font-medium">بچ</th>
                      <th className="px-3 py-2.5 font-medium">نوع موجودی</th>
                      <th className="px-3 py-2.5 font-medium">مانده ذخیره‌شده</th>
                      <th className="px-3 py-2.5 font-medium">مقدار مورد انتظار</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.batchMismatches.map((mismatch, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2">{batchMismatchLabels[mismatch.kind]}</td>
                        <td className="px-3 py-2 font-mono text-xs">#{mismatch.itemId}</td>
                        <td className="px-3 py-2 font-mono text-xs">#{mismatch.locationId}</td>
                        <td className="px-3 py-2 font-mono text-xs">{"batchId" in mismatch ? `#${mismatch.batchId}` : "-"}</td>
                        <td className="px-3 py-2">{stockBucketLabels[mismatch.bucket]}</td>
                        <td className="px-3 py-2 font-medium tabular-nums text-destructive">{"balance" in mismatch ? formatQuantity(mismatch.balance) : "-"}</td>
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{"ledger" in mismatch ? formatQuantity(mismatch.ledger) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

// I4: the three batch-aware mismatch kinds from verifyBalances().
const batchMismatchLabels: Record<NonNullable<IntegrityResult["batchMismatches"]>[number]["kind"], string> = {
  BATCH_LEDGER: "مانده بچ ≠ مجموع رویدادهای بچ",
  BATCH_SUM: "مانده کالا ≠ مجموع مانده بچ‌ها",
  UNEXPECTED_BATCH: "بچ در رویدادی که نباید بچ داشته باشد",
};
