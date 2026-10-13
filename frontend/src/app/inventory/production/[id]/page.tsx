"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { NoAccess, employeeLabel, productionOutputTitle, stockDocumentStatusLabels, stockDocumentStatusTone, type ProductionOutputDetail } from "../../shared";
import { FormSection } from "../../adjustments/_form/FormSection";
import { InboundLinesTable } from "../../_inbound/InboundLinesTable";
import { useBatchExpiry } from "../../_inbound/useBatchExpiry";

// Production output detail (Inventory batch I5) — same shape as
// receipts/[id]/page.tsx minus QC (finished goods post straight to ON_HAND).
// A DRAFT can be edited, deleted, or posted («ثبت نهایی» → PRD-<year>-NNNNNN,
// PRODUCTION_OUTPUT movements) by inventory.receive users; POSTED is immutable.
export default function ProductionOutputDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const outputId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canReceive = user?.permissions.includes("inventory.receive") ?? false;
  const canCost = user?.permissions.includes("inventory.cost") ?? false;

  const [output, setOutput] = useState<ProductionOutputDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"post" | "delete" | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  const [loadingId, setLoadingId] = useState(outputId);
  if (loadingId !== outputId) {
    setLoadingId(outputId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<ProductionOutputDetail>(`/inventory/production-outputs/${outputId}`)
      .then((data) => {
        if (!ignore) {
          setOutput(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات رسید تولید ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [outputId, canView]);

  const batchExpiry = useBatchExpiry(output?.items, canView && output?.status === "POSTED");

  async function post() {
    if (!output) return;
    if (
      !window.confirm(
        `با «ثبت نهایی»، شماره رسید تولید تخصیص می‌یابد و محصول ${output.items.length.toLocaleString("fa-IR")} ردیف به موجودی انبار اضافه می‌شود. رسید ثبت‌شده دیگر قابل ویرایش یا حذف نیست. ادامه می‌دهید؟`,
      )
    )
      return;
    setBusy("post");
    try {
      const posted = await apiFetch<ProductionOutputDetail>(`/inventory/production-outputs/${output.id}/post`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: output.updatedAt }),
      });
      setOutput(posted);
      pushSuccess(`رسید تولید ${posted.outputNumber ?? ""} ثبت نهایی شد و موجودی به‌روزرسانی شد.`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      // ITEM_KIND_NOT_ALLOWED / EXPIRY_REQUIRED / BATCH_DATA_MISMATCH carry a specific Persian message.
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت نهایی رسید تولید ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!output) return;
    if (!window.confirm(`آیا از حذف «${productionOutputTitle(output)}» مطمئن هستید؟`)) return;
    setBusy("delete");
    try {
      await apiFetch(`/inventory/production-outputs/${output.id}`, { method: "DELETE" });
      router.push("/inventory/production");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف رسید تولید ناموفق بود.");
      setBusy(null);
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده رسیدهای تولید را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!output) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "رسید تولید یافت نشد."}</p>
          <Link href="/inventory/production" className="text-primary hover:underline">بازگشت به فهرست رسیدهای تولید ←</Link>
        </div>
      </div>
    );
  }

  const isDraft = output.status === "DRAFT";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این رسید تولید پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${output.outputNumber ? "font-mono" : ""}`}>{productionOutputTitle(output)}</h1>
              <StatusBadge label={stockDocumentStatusLabels[output.status]} tone={stockDocumentStatusTone[output.status]} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">رسید تولید — {formatJalali(output.productionDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canReceive && isDraft ? (
              <>
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void post()}>
                  {busy === "post" ? "در حال ثبت نهایی..." : "ثبت نهایی رسید تولید"}
                </Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/inventory/production/${output.id}/edit`)}>
                  ویرایش
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                  {busy === "delete" ? "در حال حذف..." : "حذف"}
                </Button>
              </>
            ) : null}
            <Link href={`/inventory/production/${output.id}/print`} className={buttonVariants({ variant: "outline" })}>
              <Printer className="size-4" aria-hidden="true" />
              چاپ
            </Link>
          </div>
        </div>

        {isDraft ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این رسید تولید پیش‌نویس است و هنوز بر موجودی اثری نداشته است{canReceive ? "؛ برای اعمال، «ثبت نهایی رسید تولید» را بزنید." : "."}
          </p>
        ) : null}

        <FormSection title="اطلاعات رسید تولید">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">شماره رسید</dt>
              <dd className="mt-1 font-mono">{output.outputNumber ?? <span className="font-sans text-muted-foreground">پس از ثبت نهایی تخصیص می‌یابد</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ تولید</dt>
              <dd className="mt-1">{formatJalali(output.productionDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تولیدکننده</dt>
              <dd className="mt-1">{output.producedByEmployee ? employeeLabel(output.producedByEmployee) : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">انبار</dt>
              <dd className="mt-1">{output.location.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت‌کننده</dt>
              <dd className="mt-1">
                {output.createdByUser?.username ?? "-"}
                <span className="ms-1 text-xs text-muted-foreground">{formatJalali(output.createdAt)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت نهایی توسط</dt>
              <dd className="mt-1">
                {output.postedByUser?.username ?? "-"}
                {output.postedAt ? <span className="ms-1 text-xs text-muted-foreground">{formatJalali(output.postedAt)}</span> : null}
              </dd>
            </div>
          </dl>
        </FormSection>

        <FormSection title="اقلام تولیدشده" description={`${output.items.length.toLocaleString("fa-IR")} ردیف`}>
          <InboundLinesTable lines={output.items} showCost={canCost} showCostEstimated batchExpiry={batchExpiry} />
          {isDraft && output.items.some((line) => line.batchNumber !== null && !line.productionDate) ? (
            <p className="mt-2 text-xs text-muted-foreground">برای ردیف‌های بدون تاریخ تولید، تاریخ تولید سند ({formatJalali(output.productionDate)}) هنگام ثبت نهایی برای بچ ثبت می‌شود.</p>
          ) : null}
        </FormSection>

        <FormSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{output.note || <span className="text-muted-foreground">-</span>}</p>
        </FormSection>
      </div>
    </div>
  );
}
