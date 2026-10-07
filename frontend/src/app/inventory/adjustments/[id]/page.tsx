"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  adjustmentTitle,
  formatQuantity,
  formatSignedQuantity,
  stockAdjustmentKindLabels,
  stockAdjustmentKindTone,
  stockDocumentStatusLabels,
  stockDocumentStatusTone,
  type StockAdjustmentDetail,
} from "../../shared";
import { FormSection } from "../_form/FormSection";

// Stock adjustment detail. A DRAFT can be edited, deleted, or posted
// ("ثبت نهایی") by inventory.adjust users; posting assigns the
// ADJ-<year>-NNNNNN number and writes the stock movements in one backend
// transaction (it fails as a whole — e.g. when stock would go negative).
// A POSTED document is read-only forever.
export default function StockAdjustmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const adjustmentId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canAdjust = user?.permissions.includes("inventory.adjust") ?? false;

  const [adjustment, setAdjustment] = useState<StockAdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"post" | "delete" | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  const [loadingId, setLoadingId] = useState(adjustmentId);
  if (loadingId !== adjustmentId) {
    setLoadingId(adjustmentId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustmentId}`)
      .then((data) => {
        if (!ignore) {
          setAdjustment(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات سند ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [adjustmentId, canView]);

  async function post() {
    if (!adjustment) return;
    if (
      !window.confirm(
        `با «ثبت نهایی»، شماره سند تخصیص می‌یابد و موجودی ${adjustment.items.length.toLocaleString("fa-IR")} ردیف کالا تغییر می‌کند. سند ثبت‌شده دیگر قابل ویرایش یا حذف نیست. ادامه می‌دهید؟`,
      )
    )
      return;
    setBusy("post");
    try {
      const posted = await apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustment.id}/post`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: adjustment.updatedAt }),
      });
      setAdjustment(posted);
      pushSuccess(`سند ${posted.adjustmentNumber ?? ""} ثبت نهایی شد و موجودی به‌روزرسانی شد.`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      // NEGATIVE_STOCK and other refusals carry a specific Persian message.
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت نهایی سند ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!adjustment) return;
    if (!window.confirm(`آیا از حذف «${adjustmentTitle(adjustment)}» مطمئن هستید؟`)) return;
    setBusy("delete");
    try {
      await apiFetch(`/inventory/stock-adjustments/${adjustment.id}`, { method: "DELETE" });
      router.push("/inventory/adjustments");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سند ناموفق بود.");
      setBusy(null);
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده اسناد موجودی را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!adjustment) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "سند یافت نشد."}</p>
          <Link href="/inventory/adjustments" className="text-primary hover:underline">بازگشت به فهرست اسناد ←</Link>
        </div>
      </div>
    );
  }

  const isDraft = adjustment.status === "DRAFT";
  const showDraftActions = canAdjust && isDraft;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این سند پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${adjustment.adjustmentNumber ? "font-mono" : ""}`}>{adjustmentTitle(adjustment)}</h1>
              <StatusBadge label={stockDocumentStatusLabels[adjustment.status]} tone={stockDocumentStatusTone[adjustment.status]} />
              <StatusBadge label={stockAdjustmentKindLabels[adjustment.kind]} tone={stockAdjustmentKindTone[adjustment.kind]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatJalali(adjustment.adjustmentDate)}</p>
          </div>
          {showDraftActions ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void post()}>
                {busy === "post" ? "در حال ثبت نهایی..." : "ثبت نهایی سند"}
              </Button>
              <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/inventory/adjustments/${adjustment.id}/edit`)}>
                ویرایش
              </Button>
              <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                {busy === "delete" ? "در حال حذف..." : "حذف"}
              </Button>
            </div>
          ) : null}
        </div>

        {isDraft ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سند پیش‌نویس است و هنوز بر موجودی اثری نداشته است{canAdjust ? "؛ برای اعمال، «ثبت نهایی سند» را بزنید." : "."}
          </p>
        ) : null}

        <FormSection title="اطلاعات سند">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">شماره سند</dt>
              <dd className="mt-1 font-mono">{adjustment.adjustmentNumber ?? <span className="font-sans text-muted-foreground">پس از ثبت نهایی تخصیص می‌یابد</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">نوع سند</dt>
              <dd className="mt-1">{stockAdjustmentKindLabels[adjustment.kind]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ سند</dt>
              <dd className="mt-1">{formatJalali(adjustment.adjustmentDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">انبار</dt>
              <dd className="mt-1">{adjustment.location.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت‌کننده</dt>
              <dd className="mt-1">{adjustment.createdByUser?.username ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ ایجاد</dt>
              <dd className="mt-1">{formatJalali(adjustment.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت نهایی توسط</dt>
              <dd className="mt-1">{adjustment.postedByUser?.username ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ ثبت نهایی</dt>
              <dd className="mt-1">{adjustment.postedAt ? formatJalali(adjustment.postedAt) : "-"}</dd>
            </div>
            <div className="col-span-2 md:col-span-3">
              <dt className="text-xs text-muted-foreground">علت</dt>
              <dd className="mt-1 whitespace-pre-wrap">{adjustment.reason}</dd>
            </div>
          </dl>
        </FormSection>

        <FormSection title="اقلام سند" description={`${adjustment.items.length.toLocaleString("fa-IR")} ردیف`}>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">کد کالا</th>
                  <th className="px-3 py-2 font-medium">نام کالا</th>
                  <th className="px-3 py-2 font-medium">واحد</th>
                  <th className="px-3 py-2 font-medium">مقدار</th>
                  <th className="px-3 py-2 font-medium">توضیح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {adjustment.items.map((line) => {
                  const quantity = Number(line.quantity);
                  return (
                    <tr key={line.id}>
                      <td className="px-3 py-2 font-mono text-xs">{line.item.code}</td>
                      <td className="px-3 py-2">{line.item.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{line.item.unit.nameFa}</td>
                      <td className={`px-3 py-2 font-medium tabular-nums ${quantity < 0 ? "text-destructive" : ""}`} dir="ltr">
                        {adjustment.kind === "CORRECTION" ? formatSignedQuantity(quantity) : formatQuantity(quantity)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{line.note || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{adjustment.note || <span className="text-muted-foreground">-</span>}</p>
        </FormSection>
      </div>
    </div>
  );
}
