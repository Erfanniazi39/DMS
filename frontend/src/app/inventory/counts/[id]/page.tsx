"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  formatQuantity,
  stockCountScopeLabels,
  stockCountScopeTone,
  stockCountStatusLabels,
  stockCountStatusTone,
  stockCountTitle,
  type StockAdjustmentReason,
  type StockCountDetail,
} from "../../shared";
import { FormSection } from "../../adjustments/_form/FormSection";
import { CountEntryGrid } from "./_sections/CountEntryGrid";
import { ReviewVarianceGrid } from "./_sections/ReviewVarianceGrid";
import { CancelCountDialog } from "./_sections/CancelCountDialog";
import { HasPermission } from "@/components/has-permission";

type EntryValue = { countedQty: string; reasonCode: "" | StockAdjustmentReason; note: string };
type EntryLine = { stockCountItemId: number; countedQty: number; reasonCode?: StockAdjustmentReason; note?: string };
type ApproveResult = StockCountDetail & { warnings: { itemId: number; available: string }[] };

// Stock-count detail/workflow page (شمارش موجودی, Inventory batch I6).
// B13: blind entry while COUNTING, approval by someone other than the
// submitter (B10's no-self-approval rule, reused), and "stale-line" (409
// COUNT_STALE) detection instead of freezing warehouse operations. The page
// renders a different body per status (DRAFT/COUNTING/REVIEW/POSTED/
// CANCELLED) — see each branch below.
export default function StockCountDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const countId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canCount = user?.permissions.includes("inventory.count") ?? false;
  const canApprove = user?.permissions.includes("inventory.approve") ?? false;

  const [count, setCount] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "save" | "submit" | "approve" | "recount" | "delete" | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  // COUNTING entry grid, keyed by stockCountItemId.
  const [entryValues, setEntryValues] = useState<Record<number, EntryValue>>({});
  // REVIEW: reasonCode choices made on this screen (not yet confirmed by the
  // server), keyed by stockCountItemId, plus which lines are selected for
  // "درخواست شمارش مجدد" and which the backend's last 409 COUNT_STALE named.
  const [reviewReasonOverrides, setReviewReasonOverrides] = useState<Record<number, "" | StockAdjustmentReason>>({});
  const [selectedRecountLineIds, setSelectedRecountLineIds] = useState<Set<number>>(new Set());
  const [staleLineIds, setStaleLineIds] = useState<Set<number>>(new Set());

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);

  const [loadingId, setLoadingId] = useState(countId);
  if (loadingId !== countId) {
    setLoadingId(countId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<StockCountDetail>(`/inventory/stock-counts/${countId}`)
      .then((data) => {
        if (!ignore) {
          setCount(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات سند شمارش ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [countId, canView]);

  // Reset the COUNTING entry grid's local values whenever a fresh copy of
  // the document arrives (initial load, or after start()/enter-count()) —
  // the "adjusting state when props change" pattern (same as
  // JalaliDateInput's syncedValue), not an effect, so it can't cascade.
  const [entryValuesSource, setEntryValuesSource] = useState<StockCountDetail | null>(null);
  if (count && count !== entryValuesSource) {
    setEntryValuesSource(count);
    const next: Record<number, EntryValue> = {};
    for (const item of count.items) {
      next[item.id] = {
        countedQty: item.countedQty !== null ? String(Number(item.countedQty)) : "",
        reasonCode: (item.reasonCode ?? "") as "" | StockAdjustmentReason,
        note: item.note ?? "",
      };
    }
    setEntryValues(next);
  }

  function showError(reason: unknown, fallback: string) {
    const apiError = reason as ApiError;
    if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
    if (apiError.messages?.length) pushErrors(apiError.messages);
    else pushError(apiError.message ?? fallback);
  }

  // Builds the enter-count payload from entryValues — only lines with a
  // non-empty countedQty are included (enter-count accepts any subset).
  function prepareEntryLines(): { lines: EntryLine[]; problems: string[] } {
    const problems: string[] = [];
    const lines: EntryLine[] = [];
    if (!count) return { lines, problems };
    count.items.forEach((item, index) => {
      const value = entryValues[item.id];
      if (!value || value.countedQty.trim() === "") return;
      const row = `ردیف ${(index + 1).toLocaleString("fa-IR")}`;
      const countedQty = parseNumberInput(value.countedQty);
      if (!Number.isFinite(countedQty) || countedQty < 0) {
        problems.push(`${row}: مقدار شمارش‌شده باید عددی غیرمنفی باشد.`);
        return;
      }
      if (Math.abs(countedQty * 100 - Math.round(countedQty * 100)) > 1e-6) {
        problems.push(`${row}: مقدار حداکثر می‌تواند دو رقم اعشار داشته باشد.`);
        return;
      }
      lines.push({
        stockCountItemId: item.id,
        countedQty,
        ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}),
        ...(value.note.trim() ? { note: value.note.trim() } : {}),
      });
    });
    return { lines, problems };
  }

  async function start() {
    if (!count) return;
    if (!window.confirm("با «شروع شمارش»، موجودی سیستم هر ردیف در همین لحظه ثبت می‌شود (مبنای مقایسه با شمارش واقعی). ادامه می‌دهید؟")) return;
    setBusy("start");
    try {
      const started = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/start`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: count.updatedAt }),
      });
      setCount(started);
      pushSuccess("شمارش شروع شد.");
    } catch (reason) {
      showError(reason, "شروع شمارش ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEntry() {
    if (!count) return;
    const { lines, problems } = prepareEntryLines();
    if (problems.length) {
      pushErrors(problems);
      return;
    }
    if (lines.length === 0) {
      pushError("برای حداقل یک ردیف مقدار شمارش‌شده وارد کنید.");
      return;
    }
    setBusy("save");
    try {
      const updated = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/enter-count`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: count.updatedAt, lines }),
      });
      setCount(updated);
      pushSuccess("ثبت شمارش ذخیره شد.");
    } catch (reason) {
      showError(reason, "ثبت شمارش ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function submitForReview() {
    if (!count) return;
    const { lines, problems } = prepareEntryLines();
    if (problems.length) {
      pushErrors(problems);
      return;
    }
    if (!window.confirm("سند برای بررسی ارسال می‌شود و تا پایان بررسی قابل شمارش نخواهد بود. ادامه می‌دهید؟")) return;
    setBusy("submit");
    try {
      let latest = count;
      if (lines.length > 0) {
        latest = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/enter-count`, {
          method: "POST",
          body: JSON.stringify({ updatedAt: latest.updatedAt, lines }),
        });
        setCount(latest);
      }
      const missing = latest.items.filter((item) => item.countedQty === null).length;
      if (missing > 0) {
        pushError(`برای ${missing.toLocaleString("fa-IR")} ردیف هنوز مقدار شمارش‌شده ثبت نشده است؛ پیش از ارسال برای بررسی، همهٔ ردیف‌ها را شمارش کنید.`);
        return;
      }
      const submitted = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: latest.updatedAt }),
      });
      setCount(submitted);
      pushSuccess("سند برای بررسی ارسال شد.");
    } catch (reason) {
      showError(reason, "ارسال برای بررسی ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  function missingReasonLabels(): string[] {
    if (!count) return [];
    return count.items
      .filter((item) => Number(item.varianceQty ?? 0) !== 0 && !(reviewReasonOverrides[item.id] || item.reasonCode))
      .map((item) => `«${item.item.name}» (${item.item.code})`);
  }

  async function approve() {
    if (!count) return;
    const missing = missingReasonLabels();
    if (missing.length > 0) {
      pushError(`علت مغایرت برای این ردیف‌ها الزامی است: ${missing.join("، ")}`);
      return;
    }
    const varianceCount = count.items.filter((item) => Number(item.varianceQty ?? 0) !== 0).length;
    if (!window.confirm(`با «تأیید»، شماره سند تخصیص می‌یابد و مغایرت ${varianceCount.toLocaleString("fa-IR")} ردیف در موجودی ثبت می‌شود. ادامه می‌دهید؟`)) return;
    setBusy("approve");
    try {
      const lines = count.items
        .filter((item) => Number(item.varianceQty ?? 0) !== 0 && reviewReasonOverrides[item.id])
        .map((item) => ({ stockCountItemId: item.id, reasonCode: reviewReasonOverrides[item.id] as StockAdjustmentReason }));
      const result = await apiFetch<ApproveResult>(`/inventory/stock-counts/${count.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: count.updatedAt, lines }),
      });
      setCount(result);
      setStaleLineIds(new Set());
      setSelectedRecountLineIds(new Set());
      pushSuccess(`سند ${result.countNumber ?? ""} تأیید و ثبت نهایی شد.`);
      for (const warning of result.warnings ?? []) {
        const line = result.items.find((item) => item.itemId === warning.itemId);
        const label = line ? `«${line.item.name}» (${line.item.code})` : `کالا #${warning.itemId}`;
        pushError(`هشدار: موجودی قابل‌استفادهٔ ${label} پس از این مغایرت منفی شده است (${formatQuantity(warning.available)}).`);
      }
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      if (apiError.code === "COUNT_STALE") {
        const details = (apiError.details ?? {}) as { stockCountItemIds?: number[] };
        const ids = new Set(details.stockCountItemIds ?? []);
        setStaleLineIds(ids);
        setSelectedRecountLineIds(ids);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "تأیید سند ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  async function requestRecount() {
    if (!count) return;
    const lineIds = [...selectedRecountLineIds];
    if (lineIds.length === 0) {
      pushError("حداقل یک ردیف را برای شمارش مجدد انتخاب کنید.");
      return;
    }
    if (!window.confirm(`${lineIds.length.toLocaleString("fa-IR")} ردیف برای شمارش مجدد به حالت «در حال شمارش» بازمی‌گردد. ادامه می‌دهید؟`)) return;
    setBusy("recount");
    try {
      const updated = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/request-recount`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: count.updatedAt, lineIds }),
      });
      setCount(updated);
      setSelectedRecountLineIds(new Set());
      setStaleLineIds(new Set());
      pushSuccess("درخواست شمارش مجدد ثبت شد؛ سند به حالت «در حال شمارش» بازگشت.");
    } catch (reason) {
      showError(reason, "درخواست شمارش مجدد ناموفق بود.");
    } finally {
      setBusy(null);
    }
  }

  function toggleRecountLine(lineId: number, checked: boolean) {
    setSelectedRecountLineIds((current) => {
      const next = new Set(current);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  async function remove() {
    if (!count) return;
    if (!window.confirm(`آیا از حذف «${stockCountTitle(count)}» مطمئن هستید؟`)) return;
    setBusy("delete");
    try {
      await apiFetch(`/inventory/stock-counts/${count.id}`, { method: "DELETE" });
      router.push("/inventory/counts");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف سند شمارش ناموفق بود.");
      setBusy(null);
    }
  }

  async function submitCancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!count) return;
    if (!cancelReason.trim()) {
      pushError("علت لغو الزامی است.");
      return;
    }
    setCancelSaving(true);
    try {
      const cancelled = await apiFetch<StockCountDetail>(`/inventory/stock-counts/${count.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: count.updatedAt, cancelReason: cancelReason.trim() }),
      });
      setCount(cancelled);
      pushSuccess("سند لغو شد.");
      setCancelOpen(false);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setCancelOpen(false);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "لغو سند ناموفق بود.");
    } finally {
      setCancelSaving(false);
    }
  }

  if (!canView) return <NoAccess message="اجازه مشاهده اسناد شمارش موجودی را ندارید." />;

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!count) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "سند شمارش یافت نشد."}</p>
          <Link href="/inventory/counts" className="text-primary hover:underline">بازگشت به فهرست اسناد ←</Link>
        </div>
      </div>
    );
  }

  const isDraft = count.status === "DRAFT";
  const isCounting = count.status === "COUNTING";
  const isReview = count.status === "REVIEW";
  const isPosted = count.status === "POSTED";
  const isCancelled = count.status === "CANCELLED";
  const canCancelNow = canCount && (isDraft || isCounting || isReview);
  const isSelfSubmitted = user !== null && count.submittedByUser?.id === user.id;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
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
              <h1 className={`text-xl font-semibold tracking-tight ${count.countNumber ? "font-mono" : ""}`}>{stockCountTitle(count)}</h1>
              <StatusBadge label={stockCountStatusLabels[count.status]} tone={stockCountStatusTone[count.status]} />
              <StatusBadge label={stockCountScopeLabels[count.scope]} tone={stockCountScopeTone[count.scope]} />
              <StatusBadge label={count.isBlind ? "شمارش کور" : "شمارش آشکار"} tone="muted" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {count.location.name} — {formatJalali(count.countDate)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCount && isDraft ? (
              <>
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void start()}>
                  {busy === "start" ? "در حال شروع..." : "شروع شمارش"}
                </Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => router.push(`/inventory/counts/${count.id}/edit`)}>
                  ویرایش
                </Button>
                <HasPermission code="inventory.delete">
                <Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>
                  {busy === "delete" ? "در حال حذف..." : "حذف"}
                </Button>
                </HasPermission>
              </>
            ) : null}
            {canCount && isCounting ? (
              <>
                <Button variant="outline" disabled={busy !== null || staleRecord} onClick={() => void saveEntry()}>
                  {busy === "save" ? "در حال ذخیره..." : "ذخیره شمارش"}
                </Button>
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void submitForReview()}>
                  {busy === "submit" ? "در حال ارسال..." : "ارسال برای بررسی"}
                </Button>
              </>
            ) : null}
            {isReview && canApprove ? (
              isSelfSubmitted ? (
                <span className="text-xs text-muted-foreground">ارسال‌کنندهٔ سند نمی‌تواند آن را تأیید کند؛ کاربر دیگری باید تأیید کند.</span>
              ) : (
                <Button variant="success" disabled={busy !== null || staleRecord} onClick={() => void approve()}>
                  {busy === "approve" ? "در حال تأیید..." : "تأیید"}
                </Button>
              )
            ) : null}
            {canCancelNow ? (
              <Button variant="destructive" disabled={busy !== null} onClick={() => { setCancelReason(""); setCancelOpen(true); }}>
                لغو سند
              </Button>
            ) : null}
            <Link href={`/inventory/counts/${count.id}/print`} className={buttonVariants({ variant: "outline" })}>
              <Printer className="size-4" aria-hidden="true" />
              چاپ
            </Link>
          </div>
        </div>

        {isDraft ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            این سند پیش‌نویس است و شمارش هنوز شروع نشده است{canCount ? "؛ برای شروع، «شروع شمارش» را بزنید." : "."}
          </p>
        ) : null}
        {isCounting ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            شمارش در حال انجام است و هنوز بر موجودی اثری نداشته است.
            {count.isBlind ? " این شمارش کور است — موجودی سیستم و مغایرت تا «در انتظار بررسی» برای شمارشگر نمایش داده نمی‌شود." : ""}
          </p>
        ) : null}
        {isReview ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            سند در انتظار بررسی است و هنوز بر موجودی اثری نداشته است
            {canApprove ? "؛ برای اعمال بر موجودی، آن را «تأیید» کنید یا برای ردیف‌های مشکوک «شمارش مجدد» درخواست دهید." : ` (ارسال‌کننده: ${count.submittedByUser?.username ?? "-"}).`}
          </p>
        ) : null}
        {isCancelled ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            این سند لغو شده است{count.cancelledByUser ? ` توسط ${count.cancelledByUser.username}` : ""}
            {count.cancelledAt ? ` — ${formatJalali(count.cancelledAt)}` : ""}.
            {count.cancelReason ? <span className="mt-1 block">علت: {count.cancelReason}</span> : null}
          </p>
        ) : null}
        {isPosted ? (
          <p className="rounded-lg border border-success/40 bg-success/10 px-4 py-2.5 text-sm">
            این سند تأیید و ثبت نهایی شده و غیرقابل ویرایش است. رویدادهای انباری مربوط به مغایرت‌های آن را می‌توان در{" "}
            <Link href="/inventory/movements?referenceType=STOCK_COUNT" className="text-primary hover:underline">دفتر گردش کالا</Link> مشاهده کرد.
          </p>
        ) : null}
        {staleLineIds.size > 0 && isReview ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>برای برخی ردیف‌ها پس از شروع این شمارش رویداد انباری جدید ثبت شده است (در جدول زیر مشخص شده‌اند)؛ ابتدا برای آن‌ها «درخواست شمارش مجدد» دهید.</span>
            {canApprove ? (
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void requestRecount()}>
                {busy === "recount" ? "در حال ارسال..." : "درخواست شمارش مجدد برای ردیف‌های مشخص‌شده"}
              </Button>
            ) : null}
          </div>
        ) : null}

        <FormSection title="اطلاعات سند">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">شماره سند</dt>
              <dd className="mt-1 font-mono">{count.countNumber ?? <span className="font-sans text-muted-foreground">پس از تأیید تخصیص می‌یابد</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">تاریخ شمارش</dt>
              <dd className="mt-1">{formatJalali(count.countDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">انبار</dt>
              <dd className="mt-1">{count.location.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">نوع شمارش</dt>
              <dd className="mt-1">{stockCountScopeLabels[count.scope]} — {count.isBlind ? "کور" : "آشکار"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">ثبت‌کننده</dt>
              <dd className="mt-1">
                {count.createdByUser?.username ?? "-"}
                <span className="ms-1 text-xs text-muted-foreground">{formatJalali(count.createdAt)}</span>
              </dd>
            </div>
            {count.startedAt ? (
              <div>
                <dt className="text-xs text-muted-foreground">تاریخ شروع شمارش</dt>
                <dd className="mt-1">{formatJalali(count.startedAt)}</dd>
              </div>
            ) : null}
            {count.submittedByUser ? (
              <div>
                <dt className="text-xs text-muted-foreground">ارسال‌کنندهٔ بررسی</dt>
                <dd className="mt-1">
                  {count.submittedByUser.username}
                  {count.submittedAt ? ` — ${formatJalali(count.submittedAt)}` : ""}
                </dd>
              </div>
            ) : null}
            {count.postedByUser ? (
              <div>
                <dt className="text-xs text-muted-foreground">تأییدکننده</dt>
                <dd className="mt-1">
                  {count.postedByUser.username}
                  {count.postedAt ? ` — ${formatJalali(count.postedAt)}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
        </FormSection>

        <FormSection title="اقلام شمارش" description={count.items.length ? `${count.items.length.toLocaleString("fa-IR")} ردیف` : undefined}>
          {isDraft ? (
            count.scope === "FULL" ? (
              <p className="text-sm text-muted-foreground">این سند «شمارش کامل» است — پس از «شروع شمارش» یک ردیف برای هر کالای دارای موجودی در این انبار به‌صورت خودکار ساخته می‌شود.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[32rem] text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">کد کالا</th>
                      <th className="px-3 py-2 font-medium">نام کالا</th>
                      <th className="px-3 py-2 font-medium">واحد</th>
                      <th className="px-3 py-2 font-medium">بچ</th>
                      <th className="px-3 py-2 font-medium">توضیح</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {count.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-mono text-xs">{line.item.code}</td>
                        <td className="px-3 py-2">{line.item.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{line.item.unit.nameFa}</td>
                        <td className="px-3 py-2 font-mono text-xs">{line.batch?.batchNumber ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{line.note || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : isCounting ? (
            <div className="space-y-2">
              <CountEntryGrid
                count={count}
                values={entryValues}
                disabled={!canCount || busy !== null}
                onChange={(lineId, patch) => setEntryValues((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }))}
              />
              <p className="text-xs text-muted-foreground">«ذخیره شمارش» بدون ارسال برای بررسی ثبت می‌شود و می‌توان بعداً ادامه داد. مقدار صفر (شمارش قفسهٔ خالی) هم یک مقدار معتبر است.</p>
            </div>
          ) : isReview || isPosted || isCancelled ? (
            <ReviewVarianceGrid
              count={count}
              canApprove={isReview && canApprove}
              reasonOverrides={reviewReasonOverrides}
              onReasonChange={(lineId, reasonCode) => setReviewReasonOverrides((current) => ({ ...current, [lineId]: reasonCode }))}
              selectedLineIds={selectedRecountLineIds}
              onToggleLine={toggleRecountLine}
              staleLineIds={staleLineIds}
            />
          ) : null}
          {isReview && canApprove ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={busy !== null || staleRecord || selectedRecountLineIds.size === 0} onClick={() => void requestRecount()}>
                {busy === "recount" ? "در حال ارسال..." : `درخواست شمارش مجدد (${selectedRecountLineIds.size.toLocaleString("fa-IR")} ردیف انتخاب‌شده)`}
              </Button>
              <span className="text-xs text-muted-foreground">ردیف‌هایی را که به شمارش مجدد نیاز دارند با چک‌باکس انتخاب کنید.</span>
            </div>
          ) : null}
        </FormSection>

        <FormSection title="یادداشت">
          <p className="text-sm whitespace-pre-wrap">{count.note || <span className="text-muted-foreground">-</span>}</p>
        </FormSection>
      </div>

      <CancelCountDialog
        count={count}
        open={cancelOpen}
        reason={cancelReason}
        saving={cancelSaving}
        onReasonChange={setCancelReason}
        onClose={() => setCancelOpen(false)}
        onSubmit={submitCancel}
      />
    </div>
  );
}
