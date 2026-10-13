"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  formatQuantity,
  goodsReceiptTitle,
  qcRemaining,
  stockDocumentStatusLabels,
  stockDocumentStatusTone,
  type GoodsReceiptDetail,
} from "../../shared";
import { FormSection } from "../../adjustments/_form/FormSection";
import { InboundLinesTable } from "../../_inbound/InboundLinesTable";
import { useBatchExpiry } from "../../_inbound/useBatchExpiry";

// Goods receipt detail (Inventory batch I5) — modelled on
// adjustments/[id]/page.tsx. A DRAFT can be edited, deleted, or posted
// («ثبت نهایی» → GRN-<year>-NNNNNN, GOODS_RECEIPT movements into ON_HAND, or
// into QC when inspectionRequired) by inventory.receive users. A POSTED
// receipt is immutable; if it was received into QC, the «آزادسازی از کنترل
// کیفیت» section releases any partial quantity per line (B19). Every action
// sends the receipt's latest updatedAt — it changes after each release, and
// the page always keeps the response's fresh copy.
export default function GoodsReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const receiptId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canReceive = user?.permissions.includes("inventory.receive") ?? false;
  const canCost = user?.permissions.includes("inventory.cost") ?? false;
  const canViewPurchases = user?.permissions.includes("purchases.view") ?? false;

  const [receipt, setReceipt] = useState<GoodsReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"post" | "delete" | "release" | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // QC release inputs, keyed by goods-receipt line id.
  const [releaseQty, setReleaseQty] = useState<Record<number, string>>({});

  const [loadingId, setLoadingId] = useState(receiptId);
  if (loadingId !== receiptId) {
    setLoadingId(receiptId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<GoodsReceiptDetail>(`/inventory/goods-receipts/${receiptId}`)
      .then((data) => {
        if (!ignore) {
          setReceipt(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات رسید ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [receiptId, canView]);

  const batchExpiry = useBatchExpiry(receipt?.items, canView && receipt?.status === "POSTED");

  function showError(reason: unknown, fallback: string) {
    const apiError = reason as ApiError;
    if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
    // ITEM_KIND_NOT_ALLOWED / EXPIRY_REQUIRED / BATCH_DATA_MISMATCH /
    // QC_RELEASE_EXCEEDS_REMAINING all carry a specific Persian message.
    if (apiError.messages?.length) pushErrors(apiError.messages);
    else pushError(apiError.message ?? fallback);
  }

  async function post() {
    if (!receipt) return;
    const destination = receipt.inspectionRequired ? "به «کنترل کیفیت» وارد می‌شود (تا آزادسازی قابل استفاده نیست)" : "به موجودی انبار اضافه می‌شود";
    if (
      !window.confirm(
        `با «ثبت نهایی»، شماره رسید تخصیص می‌یابد و کالای ${receipt.items.length.toLocaleString("fa-IR")} ردیف ${destination}. رسید ثبت‌شده دیگر قابل ویرایش یا حذف نیست. ادامه می‌دهید؟`,
      )
    )
      return;
    setBusy("post");
    try {
      const posted = await apiFetch<GoodsReceiptDetail>(`/inventory/goods-receipts/${receipt.id}/post`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: receipt.updatedAt }),
      });
      setReceipt(posted);
      pushSuccess(`رسید ${posted.receiptNumber ?? ""} ثبت نهایی شد${posted.inspectionRequired ? " و کالا در کنترل کیفیت است" : " و موجودی به‌روزرسانی شد"}.`);
    } catch (reason) {
      showError(reason, "ثبت نهایی رسید ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!receipt) return;
    if (!window.confirm(`آیا از حذف «${goodsReceiptTitle(receipt)}» مطمئن هستید؟`)) return;
    setBusy("delete");
    try {
      await apiFetch(`/inventory/goods-receipts/${receipt.id}`, { method: "DELETE" });
      router.push("/inventory/receipts");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف رسید ناموفق بود.");
      setBusy(null);
    }
  }

  function fillAllRemaining() {
    if (!receipt) return;
    const next: Record<number, string> = {};
    for (const line of receipt.items) {
      const remaining = qcRemaining(line);
      if (remaining > 0) next[line.id] = String(remaining);
    }
    setReleaseQty(next);
  }

  async function release() {
    if (!receipt) return;
    // Client-side checks are UX only — the backend re-checks every line
    // under its lock (409 QC_RELEASE_EXCEEDS_REMAINING).
    const problems: string[] = [];
    const lines: { goodsReceiptItemId: number; quantity: number }[] = [];
    for (const line of receipt.items) {
      const raw = (releaseQty[line.id] ?? "").trim();
      if (!raw) continue;
      const row = `ردیف ${line.lineNo.toLocaleString("fa-IR")}`;
      const quantity = parseNumberInput(raw);
      const remaining = qcRemaining(line);
      if (!Number.isFinite(quantity) || quantity <= 0) problems.push(`${row}: مقدار آزادسازی باید عددی بزرگ‌تر از صفر باشد.`);
      else if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-6) problems.push(`${row}: مقدار حداکثر می‌تواند دو رقم اعشار داشته باشد.`);
      else if (quantity > remaining) problems.push(`${row}: مقدار آزادسازی (${formatQuantity(quantity)}) بیش از مقدار باقی‌مانده در کنترل کیفیت (${formatQuantity(remaining)}) است.`);
      else lines.push({ goodsReceiptItemId: line.id, quantity });
    }
    if (problems.length) {
      pushErrors(problems);
      return;
    }
    if (lines.length === 0) {
      pushError("برای حداقل یک ردیف مقدار آزادسازی وارد کنید.");
      return;
    }
    if (!window.confirm(`${lines.length.toLocaleString("fa-IR")} ردیف از کنترل کیفیت آزاد و به موجودی قابل استفادهٔ انبار منتقل می‌شود. این عمل برگشت‌پذیر نیست. ادامه می‌دهید؟`)) return;
    setBusy("release");
    try {
      const updated = await apiFetch<GoodsReceiptDetail>(`/inventory/goods-receipts/${receipt.id}/release-qc`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: receipt.updatedAt, lines }),
      });
      setReceipt(updated);
      setReleaseQty({});
      pushSuccess("آزادسازی از کنترل کیفیت ثبت شد و موجودی انبار به‌روزرسانی شد.");
    } catch (reason) {
      showError(reason, "آزادسازی از کنترل کیفیت ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده رسیدهای انبار را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "رسید یافت نشد."}</p>
          <Link href="/inventory/receipts" className="text-primary hover:underline">بازگشت به فهرست رسیدها ←</Link>
        </div>
      </div>
    );
  }

  const isDraft = receipt.status === "DRAFT";
  const isPosted = receipt.status === "POSTED";
  const showQc = isPosted && receipt.inspectionRequired;
  const qcPendingLines = showQc ? receipt.items.filter((line) => qcRemaining(line) > 0) : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این رسید پس از بارگذاری این صفحه تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className={`text-xl font-semibold tracking-tight ${receipt.receiptNumber ? "font-mono" : ""}`}>{goodsReceiptTitle(receipt)}</h1>
              <StatusBadge label={stockDocumentStatusLabels[receipt.status]} tone={stockDocumentStatusTone[receipt.status]} />
              {receipt.inspectionRequired ? <StatusBadge label="نیازمند کنترل کیفیت" tone="accent" /> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              رسید انبار — {receipt.supplierName} — {formatJalali(receipt.receiptDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canReceive && isDraft ? (
              <>
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void post()}>
                  {busy === "post" ? "در حال ثبت نهایی..." : "ثبت نهایی رسید"}
                </Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/inventory/receipts/${receipt.id}/edit`)}>
                  ویرایش
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                  {busy === "delete" ? "در حال حذف..." : "حذف"}
                </Button>
              </>
            ) : null}
            <Link href={`/inventory/receipts/${receipt.id}/print`} className={buttonVariants({ variant: "outline" })}>
              <Printer className="size-4" aria-hidden="true" />
              چاپ
            </Link>
          </div>
        </div>

        {isDraft ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این رسید پیش‌نویس است و هنوز بر موجودی اثری نداشته است{canReceive ? "؛ برای اعمال، «ثبت نهایی رسید» را بزنید." : "."}
          </p>
        ) : null}

        <FormSection title="اطلاعات رسید">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">شماره رسید</dt>
              <dd className="mt-1 font-mono">{receipt.receiptNumber ?? <span className="font-sans text-muted-foreground">پس از ثبت نهایی تخصیص می‌یابد</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ رسید</dt>
              <dd className="mt-1">{formatJalali(receipt.receiptDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تأمین‌کننده</dt>
              <dd className="mt-1">
                {receipt.supplierName}
                <span className="ms-1 font-mono text-xs text-muted-foreground">({receipt.supplier.code})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">شماره سند تأمین‌کننده</dt>
              <dd className="mt-1">{receipt.supplierDocumentNumber || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">خرید مرتبط</dt>
              <dd className="mt-1 font-mono text-xs">
                {receipt.purchaseId && receipt.purchaseNumber ? (
                  canViewPurchases ? (
                    <Link href={`/purchases/${receipt.purchaseId}`} className="text-primary hover:underline">
                      {receipt.purchaseNumber}
                    </Link>
                  ) : (
                    receipt.purchaseNumber
                  )
                ) : (
                  <span className="font-sans text-muted-foreground">-</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">انبار</dt>
              <dd className="mt-1">{receipt.location.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">کنترل کیفیت</dt>
              <dd className="mt-1">{receipt.inspectionRequired ? "دارد" : "ندارد"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت‌کننده</dt>
              <dd className="mt-1">
                {receipt.createdByUser?.username ?? "-"}
                <span className="ms-1 text-xs text-muted-foreground">{formatJalali(receipt.createdAt)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت نهایی توسط</dt>
              <dd className="mt-1">
                {receipt.postedByUser?.username ?? "-"}
                {receipt.postedAt ? <span className="ms-1 text-xs text-muted-foreground">{formatJalali(receipt.postedAt)}</span> : null}
              </dd>
            </div>
          </dl>
        </FormSection>

        <FormSection title="اقلام رسید" description={`${receipt.items.length.toLocaleString("fa-IR")} ردیف`}>
          <InboundLinesTable lines={receipt.items} showCost={canCost} qc={showQc} batchExpiry={batchExpiry} />
        </FormSection>

        {showQc ? (
          <FormSection
            title="آزادسازی از کنترل کیفیت"
            description={qcPendingLines.length ? `${qcPendingLines.length.toLocaleString("fa-IR")} ردیف در انتظار` : "همهٔ ردیف‌ها آزاد شده‌اند"}
            action={
              canReceive && qcPendingLines.length ? (
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={fillAllRemaining}>
                  پر کردن با کل باقی‌مانده
                </Button>
              ) : undefined
            }
          >
            {qcPendingLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">کل کالای این رسید از کنترل کیفیت آزاد شده و در موجودی انبار است.</p>
            ) : !canReceive ? (
              <p className="text-sm text-muted-foreground">کالای این رسید در کنترل کیفیت است. آزادسازی نیازمند مجوز «رسید و برگشت کالا» است.</p>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[36rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="w-10 px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">کالا</th>
                        <th className="px-3 py-2 font-medium">بچ</th>
                        <th className="px-3 py-2 font-medium">باقی‌مانده در کنترل کیفیت</th>
                        <th className="w-40 px-3 py-2 font-medium">مقدار آزادسازی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {qcPendingLines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{line.lineNo.toLocaleString("fa-IR")}</td>
                          <td className="px-3 py-1.5">
                            {line.item.name} <span className="font-mono text-xs text-muted-foreground">({line.item.code})</span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">{line.batchNumber ?? "-"}</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {formatQuantity(qcRemaining(line))} <span className="text-xs text-muted-foreground">{line.item.unit.nameFa}</span>
                          </td>
                          <td className="px-3 py-1.5">
                            <Input
                              aria-label={`مقدار آزادسازی ردیف ${line.lineNo}`}
                              dir="ltr"
                              inputMode="decimal"
                              value={releaseQty[line.id] ?? ""}
                              onChange={(event) => setReleaseQty((current) => ({ ...current, [line.id]: event.target.value }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void release()}>
                    {busy === "release" ? "در حال آزادسازی..." : "آزادسازی از کنترل کیفیت"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    آزادسازی جزئی مجاز است. ردیف‌های خالی نادیده گرفته می‌شوند. رد کالا در کنترل کیفیت (برگشت به تأمین‌کننده) هنوز در سیستم پیاده‌سازی نشده است.
                  </span>
                </div>
              </div>
            )}
          </FormSection>
        ) : null}

        <FormSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{receipt.note || <span className="text-muted-foreground">-</span>}</p>
        </FormSection>
      </div>
    </div>
  );
}
