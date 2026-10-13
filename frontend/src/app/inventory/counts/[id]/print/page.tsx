"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintFields, PrintHeader, PrintSheet, PrintSignatures, PrintToolbar } from "@/components/print/print-document";
import { NoAccess, stockCountScopeLabels, stockCountTitle, type StockCountDetail } from "../../../shared";
import { CountPrintTable } from "../_sections/CountPrintTable";

// سند شمارش موجودی — browser-print page, same pattern as
// receipts/[id]/print/page.tsx (paper-mirror layout, no PDF library). Reads
// GET /inventory/stock-counts/:id (inventory.view) — the backend applies the
// same blind-masking rule here as everywhere else, so a non-approver viewing
// a still-COUNTING blind document simply doesn't get systemQty/variance in
// the response (CountPrintTable hides those columns in that case).
export default function StockCountPrintPage() {
  const params = useParams<{ id: string }>();
  const countId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const [count, setCount] = useState<StockCountDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<StockCountDetail>(`/inventory/stock-counts/${countId}`)
      .then((data) => {
        if (!ignore) setCount(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات سند شمارش ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [countId, canView]);

  if (!canView) return <NoAccess message="اجازه مشاهده اسناد شمارش موجودی را ندارید." />;

  if (!count) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/inventory/counts" className="text-primary hover:underline">بازگشت به اسناد شمارش ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/inventory/counts/${count.id}`} backLabel="بازگشت به سند" />
      <PrintSheet>
        <PrintHeader
          title="سند شمارش موجودی"
          draft={count.status === "DRAFT"}
          meta={[
            ["شماره", <span key="n" className="font-mono">{stockCountTitle(count)}</span>],
            ["تاریخ شمارش", formatJalali(count.countDate)],
            ["انبار", count.location.name],
          ]}
        />

        <PrintFields
          rows={[
            ["نوع شمارش", stockCountScopeLabels[count.scope]],
            ["شمارش کور", count.isBlind ? "دارد" : "ندارد"],
            ["ثبت‌کننده", count.createdByUser?.username ?? null],
            ["تأییدکننده", count.postedByUser?.username ?? null],
          ]}
        />

        <CountPrintTable items={count.items} />

        {count.note ? (
          <div className="mt-4 border border-border p-3">
            <span className="text-muted-foreground">توضیحات: </span>
            <span className="whitespace-pre-wrap">{count.note}</span>
          </div>
        ) : null}

        <PrintSignatures
          boxes={[
            { label: "شمارشگر" },
            { label: "تأییدکننده", name: count.postedByUser?.username ?? null },
          ]}
        />
      </PrintSheet>
    </div>
  );
}
