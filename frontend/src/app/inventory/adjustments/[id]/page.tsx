"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { useFeature } from "@/lib/session";
import {
  NoAccess,
  adjustmentTitle,
  batchLabel,
  formatQuantity,
  formatSignedQuantity,
  stockAdjustmentKindLabels,
  stockAdjustmentKindTone,
  stockAdjustmentNeedsApproval,
  stockAdjustmentReasonLabels,
  stockDocumentStatusLabels,
  stockDocumentStatusTone,
  type ItemBatches,
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
  const canApprove = user?.permissions.includes("inventory.approve") ?? false;
  const approvalWorkflowOn = useFeature("inventoryApprovalWorkflow");

  const [adjustment, setAdjustment] = useState<StockAdjustmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"post" | "delete" | "submit" | "approve" | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);
  // I4: a BATCH_CUTOVER approval refused because the batch lines no longer
  // sum to the item's live on-hand (409 BATCH_CUTOVER_QUANTITY_MISMATCH) —
  // kept on screen (not just a toast) since the fix is to edit the document.
  const [cutoverMismatch, setCutoverMismatch] = useState<{ message: string; linesSum?: string; currentOnHand?: string } | null>(null);
  // I4: batchId → batch number for lines that picked an existing batch.
  const [batchNumbers, setBatchNumbers] = useState<Map<number, { batchNumber: string; expiryDate: string | null }>>(new Map());
  // I4: BATCH_CUTOVER's live comparison (item's current on-hand at the
  // document's location, vs. the lines' sum).
  const [cutoverOnHand, setCutoverOnHand] = useState<string | null>(null);

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

  const pickedBatchItemsKey = useMemo(
    () => (adjustment ? [...new Set(adjustment.items.filter((line) => line.batchId !== null).map((line) => line.itemId))].join(",") : ""),
    [adjustment],
  );
  useEffect(() => {
    if (!canView || !pickedBatchItemsKey) return;
    let ignore = false;
    Promise.all(pickedBatchItemsKey.split(",").map((id) => apiFetch<ItemBatches>(`/inventory/items/${id}/batches`).catch(() => null))).then((results) => {
      if (ignore) return;
      const map = new Map<number, { batchNumber: string; expiryDate: string | null }>();
      for (const result of results) for (const batch of result?.batches ?? []) map.set(batch.batchId, { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate });
      setBatchNumbers(map);
    });
    return () => {
      ignore = true;
    };
  }, [canView, pickedBatchItemsKey]);

  const cutoverKey = adjustment && adjustment.kind === "BATCH_CUTOVER" && adjustment.status !== "POSTED" && adjustment.items[0] ? `${adjustment.items[0].itemId}:${adjustment.locationId}:${adjustment.updatedAt}` : "";
  useEffect(() => {
    if (!canView || !cutoverKey) return;
    const [itemId, locationId] = cutoverKey.split(":");
    let ignore = false;
    apiFetch<{ onHand: string }>(`/inventory/items/${itemId}/availability?locationId=${locationId}`)
      .then((data) => {
        if (!ignore) setCutoverOnHand(String(data.onHand));
      })
      .catch(() => {
        if (!ignore) setCutoverOnHand(null);
      });
    return () => {
      ignore = true;
    };
  }, [canView, cutoverKey]);

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

  // B10: this kind/net-quantity needs inventory.approve — submit() instead
  // of post() directly (post() refuses it server-side either way).
  async function submitForApproval() {
    if (!adjustment) return;
    if (!window.confirm(`سند «${adjustmentTitle(adjustment)}» برای تأیید ارسال می‌شود و تا تأیید یا رد، غیرقابل ویرایش خواهد بود. ادامه می‌دهید؟`)) return;
    setBusy("submit");
    try {
      const submitted = await apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustment.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: adjustment.updatedAt }),
      });
      setAdjustment(submitted);
      pushSuccess("سند برای تأیید ارسال شد.");
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ارسال سند برای تأیید ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  // No self-approval, ever (B10) — the backend refuses it either way; the
  // confirm text just sets expectations before the round-trip.
  async function approve() {
    if (!adjustment) return;
    if (
      !window.confirm(
        `با «تأیید»، شماره سند تخصیص می‌یابد و موجودی ${adjustment.items.length.toLocaleString("fa-IR")} ردیف کالا تغییر می‌کند. ادامه می‌دهید؟`,
      )
    )
      return;
    setBusy("approve");
    try {
      const approved = await apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustment.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: adjustment.updatedAt }),
      });
      setAdjustment(approved);
      setCutoverMismatch(null);
      pushSuccess(`سند ${approved.adjustmentNumber ?? ""} تأیید و ثبت نهایی شد.`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.code === "BATCH_CUTOVER_QUANTITY_MISMATCH") {
        const details = (apiError.details ?? {}) as { linesSum?: string; currentOnHand?: string };
        setCutoverMismatch({ message: apiError.message, linesSum: details.linesSum, currentOnHand: details.currentOnHand });
        if (details.currentOnHand !== undefined) setCutoverOnHand(details.currentOnHand);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "تأیید سند ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  function openReject() {
    setRejectReason("");
    setRejectOpen(true);
  }

  async function submitReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustment) return;
    if (!rejectReason.trim()) {
      pushError("علت رد الزامی است.");
      return;
    }
    setRejectSaving(true);
    try {
      const rejected = await apiFetch<StockAdjustmentDetail>(`/inventory/stock-adjustments/${adjustment.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: adjustment.updatedAt, rejectReason: rejectReason.trim() }),
      });
      setAdjustment(rejected);
      pushSuccess("سند رد شد و به حالت پیش‌نویس بازگشت.");
      setRejectOpen(false);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setRejectOpen(false);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "رد سند ناموفق بود.");
    } finally {
      setRejectSaving(false);
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
  const isPendingApproval = adjustment.status === "PENDING_APPROVAL";
  const showDraftActions = canAdjust && isDraft;
  const needsApproval = stockAdjustmentNeedsApproval(
    adjustment.kind,
    adjustment.items.map((line) => Number(line.quantity)),
  );
  // v1 (approval workflow hidden): a decrease is posted directly by an
  // inventory.approve holder; BATCH_CUTOVER has no v1 path.
  const v1DirectKind = adjustment.kind !== "BATCH_CUTOVER";
  const draftAction: "post" | "submit" | "needs-approver" | "unavailable" = !needsApproval
    ? "post"
    : approvalWorkflowOn
      ? "submit"
      : !v1DirectKind
        ? "unavailable"
        : canApprove
          ? "post"
          : "needs-approver";
  const isSelfSubmitted = user !== null && adjustment.submittedByUser?.id === user.id;
  const isCutover = adjustment.kind === "BATCH_CUTOVER";
  const hasBatchColumns = isCutover || adjustment.items.some((line) => line.batchId !== null || line.batchNumber !== null);
  const linesSum = Math.round(adjustment.items.reduce((sum, line) => sum + Number(line.quantity), 0) * 100) / 100;
  const cutoverDifference = cutoverOnHand === null ? null : Math.round((Number(cutoverOnHand) - linesSum) * 100) / 100;

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
              {draftAction === "submit" ? (
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void submitForApproval()}>
                  {busy === "submit" ? "در حال ارسال..." : "ارسال برای تأیید"}
                </Button>
              ) : draftAction === "post" ? (
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void post()}>
                  {busy === "post" ? "در حال ثبت نهایی..." : "ثبت نهایی سند"}
                </Button>
              ) : null}
              <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/inventory/adjustments/${adjustment.id}/edit`)}>
                ویرایش
              </Button>
              <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                {busy === "delete" ? "در حال حذف..." : "حذف"}
              </Button>
            </div>
          ) : null}
          {isPendingApproval && canApprove ? (
            <div className="flex flex-wrap items-center gap-2">
              {isSelfSubmitted ? (
                <span className="text-xs text-muted-foreground">ارسال‌کنندهٔ سند نمی‌تواند آن را تأیید کند؛ کاربر دیگری باید تأیید کند.</span>
              ) : (
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void approve()}>
                  {busy === "approve" ? "در حال تأیید..." : "تأیید"}
                </Button>
              )}
              <Button variant="destructive" disabled={busy !== null} onClick={openReject}>
                رد
              </Button>
            </div>
          ) : null}
        </div>

        {isDraft ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سند پیش‌نویس است و هنوز بر موجودی اثری نداشته است
            {!canAdjust
              ? "."
              : draftAction === "submit"
                ? "؛ این سند نیاز به تأیید دارد — برای ارسال، «ارسال برای تأیید» را بزنید."
                : draftAction === "post"
                  ? needsApproval
                    ? "؛ این سند کاهش موجودی است و با مجوز تأیید شما مستقیماً ثبت نهایی می‌شود — «ثبت نهایی سند» را بزنید."
                    : "؛ برای اعمال، «ثبت نهایی سند» را بزنید."
                  : draftAction === "needs-approver"
                    ? "؛ این سند کاهش موجودی است و ثبت نهایی آن فقط توسط کاربر دارای مجوز «تأیید اسناد موجودی» ممکن است."
                    : "؛ این نوع سند در نسخهٔ فعلی سامانه قابل ثبت نیست."}
          </p>
        ) : null}

        {cutoverMismatch ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <p className="font-medium text-destructive">تأیید انجام نشد: جمع ردیف‌های بچ با موجودی فعلی کالا برابر نیست.</p>
            <p className="mt-1">{cutoverMismatch.message}</p>
            {cutoverMismatch.linesSum !== undefined && cutoverMismatch.currentOnHand !== undefined ? (
              <p className="mt-1 tabular-nums">
                جمع ردیف‌ها: {formatQuantity(cutoverMismatch.linesSum)} — موجودی فعلی: {formatQuantity(cutoverMismatch.currentOnHand)}
              </p>
            ) : null}
            <p className="mt-1 text-muted-foreground">برای اصلاح، سند را «رد» کنید تا به پیش‌نویس بازگردد، سپس مقادیر بچ‌ها را ویرایش و دوباره ارسال کنید.</p>
          </div>
        ) : null}

        {isPendingApproval ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سند در انتظار تأیید است و هنوز بر موجودی اثری نداشته است
            {canApprove ? "؛ برای اعمال بر موجودی، آن را «تأیید» یا «رد» کنید." : ` (ارسال‌کننده: ${adjustment.submittedByUser?.username ?? "-"}).`}
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
              <dt className="text-xs text-muted-foreground">{isPendingApproval || adjustment.postedByUser ? "تأییدکننده" : "ثبت نهایی توسط"}</dt>
              <dd className="mt-1">{adjustment.postedByUser?.username ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ ثبت نهایی</dt>
              <dd className="mt-1">{adjustment.postedAt ? formatJalali(adjustment.postedAt) : "-"}</dd>
            </div>
            {adjustment.reasonCode ? (
              <div>
                <dt className="text-xs text-muted-foreground">کد علت</dt>
                <dd className="mt-1">{stockAdjustmentReasonLabels[adjustment.reasonCode]}</dd>
              </div>
            ) : null}
            {adjustment.submittedByUser ? (
              <div>
                <dt className="text-xs text-muted-foreground">ارسال‌کنندهٔ تأیید</dt>
                <dd className="mt-1">
                  {adjustment.submittedByUser.username}
                  {adjustment.submittedAt ? ` — ${formatJalali(adjustment.submittedAt)}` : ""}
                </dd>
              </div>
            ) : null}
            {adjustment.rejectedByUser ? (
              <div className="col-span-2 md:col-span-3">
                <dt className="text-xs text-muted-foreground">آخرین رد</dt>
                <dd className="mt-1">
                  {adjustment.rejectedByUser.username}
                  {adjustment.rejectedAt ? ` — ${formatJalali(adjustment.rejectedAt)}` : ""}
                  {adjustment.rejectReason ? `: ${adjustment.rejectReason}` : ""}
                </dd>
              </div>
            ) : null}
            <div className="col-span-2 md:col-span-3">
              <dt className="text-xs text-muted-foreground">علت</dt>
              <dd className="mt-1 whitespace-pre-wrap">{adjustment.reason}</dd>
            </div>
          </dl>
        </FormSection>

        {isCutover && adjustment.status !== "POSTED" ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">تبدیل به ردیابی بچ — مقایسه با موجودی فعلی کالا در این انبار:</span>
            <span>
              جمع ردیف‌ها: <span className="font-medium tabular-nums">{formatQuantity(linesSum)}</span>
            </span>
            <span>
              موجودی فعلی (بدون بچ): <span className="font-medium tabular-nums">{cutoverOnHand === null ? "-" : formatQuantity(cutoverOnHand)}</span>
            </span>
            {cutoverDifference === null ? null : cutoverDifference === 0 ? (
              <span className="text-success">برابر است ✓</span>
            ) : (
              <span className="text-destructive">اختلاف {formatQuantity(cutoverDifference)} — تأیید رد خواهد شد</span>
            )}
          </div>
        ) : null}

        <FormSection title="اقلام سند" description={`${adjustment.items.length.toLocaleString("fa-IR")} ردیف`}>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">کد کالا</th>
                  <th className="px-3 py-2 font-medium">نام کالا</th>
                  <th className="px-3 py-2 font-medium">واحد</th>
                  <th className="px-3 py-2 font-medium">مقدار</th>
                  {hasBatchColumns ? <th className="px-3 py-2 font-medium">بچ</th> : null}
                  {hasBatchColumns ? <th className="px-3 py-2 font-medium">تاریخ تولید</th> : null}
                  {hasBatchColumns ? <th className="px-3 py-2 font-medium">تاریخ انقضا</th> : null}
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
                      {hasBatchColumns ? (
                        <td className="px-3 py-2 font-mono text-xs">
                          {line.batchId !== null ? (
                            batchLabel(line.batchId, new Map([...batchNumbers].map(([id, batch]) => [id, batch.batchNumber])))
                          ) : line.batchNumber ? (
                            <span>
                              {line.batchNumber}
                              {adjustment.status !== "POSTED" ? <span className="ms-1 font-sans text-muted-foreground">(بچ جدید)</span> : null}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      ) : null}
                      {hasBatchColumns ? <td className="px-3 py-2 text-muted-foreground">{line.productionDate ? formatJalali(line.productionDate) : "-"}</td> : null}
                      {hasBatchColumns ? (
                        <td className="px-3 py-2 text-muted-foreground">
                          {line.expiryDate ? formatJalali(line.expiryDate) : line.batchId !== null && batchNumbers.get(line.batchId)?.expiryDate ? formatJalali(batchNumbers.get(line.batchId)!.expiryDate) : "-"}
                        </td>
                      ) : null}
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

      <Dialog open={rejectOpen} onOpenChange={(isOpen) => (isOpen ? undefined : !rejectSaving && setRejectOpen(false))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>رد سند</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="stock-adjustment-reject-form" className="grid gap-3 text-sm" onSubmit={submitReject} noValidate>
              <p className="text-muted-foreground">سند «{adjustmentTitle(adjustment)}» رد می‌شود و به حالت پیش‌نویس بازمی‌گردد تا اصلاح و دوباره ارسال شود.</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reject-reason-input">
                  علت رد
                  <RequiredMark />
                </Label>
                <textarea id="reject-reason-input" className={textareaClass} value={rejectReason} maxLength={500} onChange={(event) => setRejectReason(event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="stock-adjustment-reject-form" variant="destructive" disabled={rejectSaving}>
              {rejectSaving ? "در حال رد..." : "رد سند"}
            </Button>
            <Button type="button" variant="outline" disabled={rejectSaving} onClick={() => setRejectOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
