"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  ReceiptText,
  RotateCw,
  ShoppingCart,
  Wallet,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatJalali, toPersianDigits } from "@/lib/jalali";
import { useAdminUser } from "./layout";
import {
  StatusBadge,
  formatMoney,
  purchasePaymentStatusLabels,
  purchasePaymentStatusTone,
  purchaseStatusLabels,
  purchaseStatusTone,
  type PurchasePaymentStatus,
  type PurchaseStatus,
} from "@/app/purchases/shared";
import {
  purchaseRequestPriorityLabels,
  purchaseRequestPriorityTone,
  purchaseRequestStatusLabels,
  purchaseRequestStatusTone,
  type PurchaseRequestPriority,
  type PurchaseRequestStatus,
} from "@/app/purchase-requests/shared";
import type { TrendPoint } from "./PurchaseTrendChart";

// echarts draws into a real DOM canvas — client-only, and kept out of the
// initial bundle until the chart is actually shown.
const PurchaseTrendChart = dynamic(() => import("./PurchaseTrendChart"), {
  ssr: false,
  loading: () => <SectionMessage message="در حال بارگذاری نمودار..." />,
});

type PeriodKey = "today" | "week" | "month" | "custom";

const periodOptions: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "custom", label: "بازه دلخواه" },
];

type KpiKey = "purchases" | "sales" | "inventory" | "unpaid" | "openRequests";

// sales.manage / inventory.view gating on the Sales and Inventory cards is
// a known, deliberately-deferred issue (see docs/project-knowledge-archive.md
// §2.2/§2.11) — those two cards stay placeholder-only until their modules
// exist. The three purchase cards share the permission the backend's
// /dashboard/purchases-summary endpoint requires.
const kpis: { key: KpiKey; label: string; icon: typeof ShoppingCart; permission: string }[] = [
  { key: "purchases", label: "مجموع خریدها", icon: ShoppingCart, permission: "purchases.manage" },
  { key: "sales", label: "مجموع فروش‌ها", icon: ReceiptText, permission: "sales.manage" },
  { key: "inventory", label: "موجودی کالا", icon: Warehouse, permission: "inventory.view" },
  { key: "unpaid", label: "پرداخت‌های پرداخت‌نشده", icon: Wallet, permission: "purchases.manage" },
  { key: "openRequests", label: "درخواست‌های خرید باز", icon: ClipboardList, permission: "purchases.manage" },
];

type RecentPurchase = {
  id: number;
  purchaseNumber: string;
  purchaseDate: string;
  totalAmount: string;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  supplier: { id: number; name: string };
};

type PurchasesSummary = {
  period: { key: PeriodKey; from: string; to: string; bucket: "day" | "week" };
  totals: { purchaseAmount: string; purchaseCount: number };
  outstanding: { amount: string; purchaseCount: number };
  openPurchaseRequestCount: number;
  trend: TrendPoint[];
  recentPurchases: RecentPurchase[];
  topSuppliers: SupplierSpend[];
};

// Spend data only — purchase amounts per supplier. There is no
// delivery/quality data behind it, so it is labelled as a spend overview.
type SupplierSpend = {
  supplier: { id: number; name: string };
  spend: string;
  purchaseCount: number;
  outstanding: string;
};

type OpenPurchase = {
  id: number;
  purchaseNumber: string;
  purchaseDate: string;
  totalAmount: string;
  outstanding: string;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  supplier: { id: number; name: string };
  ageDays: number;
};

type OpenRequest = {
  id: number;
  requestNumber: string;
  requestDate: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  requesterDepartment: { id: number; name: string };
  ageDays: number;
};

// GET /dashboard/open-items — current state, independent of the period.
type OpenItems = {
  paymentAging: { bucket: "0-30" | "31-60" | "61+"; purchaseCount: number; outstandingAmount: string }[];
  requestAging: { bucket: "0-7" | "8-30" | "31+"; requestCount: number }[];
  openPurchases: { total: number; items: OpenPurchase[] };
  openRequests: { total: number; items: OpenRequest[] };
};

// No due-date exists on Purchase, so these are ages since the purchase /
// request date — deliberately never called "overdue". Rendered as actual
// calendar-date ranges (computed fresh from today) rather than a relative
// "0-30 days" label, so the reader doesn't have to do the date math
// themselves. minAgeDays/maxAgeDays mirror the bucket boundaries the backend
// groups by (see DashboardService) — maxAgeDays null means an open-ended
// "older than" bucket.
const agingBucketRanges: Record<string, { minAgeDays: number; maxAgeDays: number | null }> = {
  "0-30": { minAgeDays: 0, maxAgeDays: 30 },
  "31-60": { minAgeDays: 31, maxAgeDays: 60 },
  "61+": { minAgeDays: 61, maxAgeDays: null },
  "0-7": { minAgeDays: 0, maxAgeDays: 7 },
  "8-30": { minAgeDays: 8, maxAgeDays: 30 },
  "31+": { minAgeDays: 31, maxAgeDays: null },
};

function dateDaysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// formatJalali parses its input with `new Date(...)` — appending T00:00:00
// (same convention used for the custom-period description above) keeps the
// result at local midnight instead of drifting a day in a negative-UTC-offset
// timezone.
function jalaliDaysAgo(days: number): string {
  const date = dateDaysAgo(days);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return formatJalali(`${iso}T00:00:00`);
}

function agingBucketLabel(bucket: string): string {
  const range = agingBucketRanges[bucket];
  if (!range) return bucket;
  if (range.maxAgeDays === null) return `قبل از ${jalaliDaysAgo(range.minAgeDays)}`;
  return `${jalaliDaysAgo(range.maxAgeDays)} تا ${jalaliDaysAgo(range.minAgeDays)}`;
}

// A per-row age (as opposed to the bucket ranges above) is rendered as a
// plain-language duration — "X years, Y months and Z days" — rather than a
// raw day count, which stops being readable once a row is years old. Years
// and months are calendar approximations (365/30-day), fine for this
// "roughly how long has this been open" display.
function formatAgeDuration(totalDays: number): string {
  if (totalDays <= 0) return "امروز";
  const years = Math.floor(totalDays / 365);
  const afterYears = totalDays % 365;
  const months = Math.floor(afterYears / 30);
  const days = afterYears % 30;

  const parts: string[] = [];
  if (years > 0) parts.push(`${toPersianDigits(years)} سال`);
  if (months > 0) parts.push(`${toPersianDigits(months)} ماه`);
  if (days > 0 || parts.length === 0) parts.push(`${toPersianDigits(days)} روز`);

  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join("، ")} و ${parts[parts.length - 1]}`;
}

type OpenItemsTab = "purchases" | "requests";

type ActivityEntry = {
  id: number;
  action: string;
  entityType: "Purchase" | "PurchaseRequest";
  entityId: string | null;
  entityNumber: string | null;
  details: string | null;
  createdAt: string;
  user: { id: number; username: string } | null;
};

// AuditLog.action is a free-form string written by PurchasesService /
// PurchaseRequestsService — these are the values those services write today.
// Anything unrecognised falls back to a generic label (see activityLabel).
const activityActionLabels: Record<string, string> = {
  PURCHASE_CREATED: "ثبت خرید",
  HISTORICAL_PURCHASE_IMPORTED: "ثبت خرید قدیمی",
  PURCHASE_UPDATED: "ویرایش خرید",
  PURCHASE_STATUS_CHANGED: "تغییر وضعیت خرید",
  PURCHASE_CANCELLED: "لغو خرید",
  PURCHASE_DELETED: "حذف خرید",
  PAYMENT_ADDED: "ثبت پرداخت برای خرید",
  PAYMENT_COMPLETED: "ثبت پرداخت برای خرید",
  PAYMENT_REMOVED: "حذف پرداخت از خرید",
  DOCUMENT_ADDED: "افزودن سند به خرید",
  DOCUMENT_REMOVED: "حذف سند از خرید",
  PURCHASE_REQUEST_CREATED: "ثبت درخواست خرید",
  PURCHASE_REQUEST_UPDATED: "ویرایش درخواست خرید",
  PURCHASE_REQUEST_STATUS_CHANGED: "تغییر وضعیت درخواست خرید",
};

function activityLabel(entry: ActivityEntry) {
  const label =
    activityActionLabels[entry.action] ?? (entry.entityType === "Purchase" ? "تغییر در خرید" : "تغییر در درخواست خرید");
  // A deleted purchase no longer resolves to a number, but its
  // PURCHASE_DELETED entry keeps the number in `details`.
  const number = entry.entityNumber ?? (entry.action === "PURCHASE_DELETED" ? entry.details : null) ?? (entry.entityId ? `#${toPersianDigits(entry.entityId)}` : "");
  return number ? `${label} ${number}` : label;
}

function relativeTime(iso: string, now: number) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "لحظاتی پیش";
  if (minutes < 60) return `${toPersianDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toPersianDigits(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${toPersianDigits(days)} روز پیش`;
  return formatJalali(iso);
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center">
      <CircleAlert className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function SectionMessage({ message }: { message: string }) {
  return <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">{message}</p>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 text-center">
      <CircleAlert className="size-5 text-destructive" aria-hidden="true" />
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="gap-1" onClick={onRetry}>
        <RotateCw className="size-3.5" aria-hidden="true" />
        تلاش دوباره
      </Button>
    </div>
  );
}

export default function AdminDashboardPage() {
  const user = useAdminUser();
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [chartMetric, setChartMetric] = useState("خریدها");

  const [summary, setSummary] = useState<PurchasesSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Recent activity isn't period-scoped, so it loads (and retries)
  // independently of the purchases summary.
  const [activity, setActivity] = useState<{ entries: ActivityEntry[]; fetchedAt: number } | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityReloadKey, setActivityReloadKey] = useState(0);

  // Operational "still open" view — loads and retries on its own, like
  // recent activity, since it isn't period-scoped either.
  const [openItems, setOpenItems] = useState<OpenItems | null>(null);
  const [openItemsError, setOpenItemsError] = useState<string | null>(null);
  const [openItemsReloadKey, setOpenItemsReloadKey] = useState(0);
  const [openItemsTab, setOpenItemsTab] = useState<OpenItemsTab>("purchases");

  const canViewPurchases = user?.permissions.includes("purchases.manage") ?? false;
  const customIncomplete = period === "custom" && (!customFrom || !customTo);
  const customReversed = period === "custom" && !!customFrom && !!customTo && customFrom > customTo;
  const rangeInvalid = customIncomplete || customReversed;

  useEffect(() => {
    if (!canViewPurchases || rangeInvalid) return;
    let cancelled = false;
    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period });
        if (period === "custom") {
          params.set("from", customFrom);
          params.set("to", customTo);
        }
        const data = await apiFetch<PurchasesSummary>(`/dashboard/purchases-summary?${params.toString()}`);
        if (!cancelled) setSummary(data);
      } catch (reason) {
        if (!cancelled) {
          setSummary(null);
          setError((reason as ApiError).message ?? "دریافت اطلاعات داشبورد ناموفق بود.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [canViewPurchases, rangeInvalid, period, customFrom, customTo, reloadKey]);

  useEffect(() => {
    if (!canViewPurchases) return;
    let cancelled = false;
    async function loadActivity() {
      setActivityError(null);
      try {
        const entries = await apiFetch<ActivityEntry[]>("/dashboard/recent-activity");
        if (!cancelled) setActivity({ entries, fetchedAt: Date.now() });
      } catch (reason) {
        if (!cancelled) {
          setActivity(null);
          setActivityError((reason as ApiError).message ?? "دریافت فعالیت‌های اخیر ناموفق بود.");
        }
      }
    }
    void loadActivity();
    return () => {
      cancelled = true;
    };
  }, [canViewPurchases, activityReloadKey]);

  useEffect(() => {
    if (!canViewPurchases) return;
    let cancelled = false;
    async function loadOpenItems() {
      setOpenItemsError(null);
      try {
        const data = await apiFetch<OpenItems>("/dashboard/open-items");
        if (!cancelled) setOpenItems(data);
      } catch (reason) {
        if (!cancelled) {
          setOpenItems(null);
          setOpenItemsError((reason as ApiError).message ?? "دریافت موارد باز ناموفق بود.");
        }
      }
    }
    void loadOpenItems();
    return () => {
      cancelled = true;
    };
  }, [canViewPurchases, openItemsReloadKey]);

  if (!user) return null;

  const canViewSales = user.permissions.includes("sales.manage");
  const canViewTransactions = canViewPurchases || canViewSales;
  const visibleKpis = kpis.filter((kpi) => user.permissions.includes(kpi.permission));
  const activeChartMetric = chartMetric === "خریدها" && !canViewPurchases ? "فروش‌ها" : chartMetric;
  const periodLabel = periodOptions.find((option) => option.key === period)?.label ?? "";
  const periodDescription =
    period === "custom" && summary && !rangeInvalid
      ? `${formatJalali(`${summary.period.from}T00:00:00`)} تا ${formatJalali(`${summary.period.to}T00:00:00`)}`
      : periodLabel;
  const retry = () => setReloadKey((key) => key + 1);

  // Shared "not ready" state for every purchase-backed section. Returns
  // null once real data is available (loaded, no error).
  const pendingMessage = customIncomplete
    ? "تاریخ شروع و پایان بازه را انتخاب کنید."
    : customReversed
      ? "تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد."
      : loading || !summary
        ? "در حال بارگذاری..."
        : null;

  function renderKpiBody(key: KpiKey) {
    if (key === "sales" || key === "inventory") {
      return <p className="mt-3 text-sm font-medium text-muted-foreground">اطلاعاتی برای نمایش وجود ندارد</p>;
    }
    if (error && !rangeInvalid) return <p className="mt-3 text-sm font-medium text-destructive">{error}</p>;
    if (pendingMessage || !summary) return <p className="mt-3 text-sm text-muted-foreground">{pendingMessage}</p>;

    let value: string;
    let caption: string;
    if (key === "purchases") {
      value = `${formatMoney(summary.totals.purchaseAmount)} ریال`;
      caption = summary.totals.purchaseCount > 0
        ? `${toPersianDigits(summary.totals.purchaseCount)} خرید — ${periodDescription}`
        : `خریدی در بازه «${periodDescription}» ثبت نشده است`;
    } else if (key === "unpaid") {
      value = `${formatMoney(summary.outstanding.amount)} ریال`;
      caption = summary.outstanding.purchaseCount > 0
        ? `مانده ${toPersianDigits(summary.outstanding.purchaseCount)} خرید — مستقل از بازه`
        : "بدهی پرداخت‌نشده‌ای وجود ندارد";
    } else {
      value = toPersianDigits(summary.openPurchaseRequestCount);
      caption = "ارسال‌شده، تأییدشده یا نیمه‌خریداری‌شده";
    }
    return (
      <>
        <p className="mt-2 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </>
    );
  }

  function renderTrend() {
    if (activeChartMetric !== "خریدها") {
      return <EmptyState message={`برای نمایش روند ${activeChartMetric} هنوز داده‌ای ثبت نشده است.`} />;
    }
    if (error && !rangeInvalid) return <ErrorState message={error} onRetry={retry} />;
    if (pendingMessage || !summary) return <SectionMessage message={pendingMessage ?? ""} />;
    if (summary.totals.purchaseCount === 0) return <EmptyState message="در این بازه خریدی ثبت نشده است." />;
    return <PurchaseTrendChart points={summary.trend} bucket={summary.period.bucket} />;
  }

  function renderActivity() {
    if (!canViewPurchases) return <EmptyState message="هنوز فعالیتی برای نمایش وجود ندارد." />;
    if (activityError) return <ErrorState message={activityError} onRetry={() => setActivityReloadKey((key) => key + 1)} />;
    if (!activity) return <SectionMessage message="در حال بارگذاری..." />;
    if (activity.entries.length === 0) return <EmptyState message="هنوز فعالیتی برای نمایش وجود ندارد." />;
    return (
      <ul className="divide-y divide-border text-sm">
        {activity.entries.map((entry) => {
          const href = entry.entityNumber && entry.entityId
            ? `/admin/${entry.entityType === "Purchase" ? "purchases" : "purchase-requests"}/${entry.entityId}`
            : null;
          const line = (
            <>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{entry.user?.username ?? "سیستم"}</span>
                <span className="text-muted-foreground"> — </span>
                {activityLabel(entry)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(entry.createdAt, activity.fetchedAt)}</span>
            </>
          );
          return (
            <li key={entry.id}>
              {href ? (
                <button type="button" className="flex w-full items-center gap-3 px-1 py-2 text-right transition-colors hover:bg-muted/40" onClick={() => router.push(href)}>{line}</button>
              ) : (
                <div className="flex items-center gap-3 px-1 py-2">{line}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  function renderTransactions() {
    if (!canViewPurchases) return <EmptyState message="هنوز اطلاعاتی برای نمایش وجود ندارد." />;
    if (error && !summary) return <ErrorState message={error} onRetry={retry} />;
    // The recent list isn't period-scoped, so a previously loaded list stays
    // on screen while the period changes or a custom range is being picked.
    if (!summary) return <SectionMessage message={pendingMessage ?? "در حال بارگذاری..."} />;
    if (summary.recentPurchases.length === 0) return <EmptyState message="هنوز خریدی ثبت نشده است." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[44rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">شماره خرید</th>
              <th className="px-3 py-2 font-medium">تاریخ</th>
              <th className="px-3 py-2 font-medium">تأمین‌کننده</th>
              <th className="px-3 py-2 font-medium">مبلغ کل</th>
              <th className="px-3 py-2 font-medium">پرداخت</th>
              <th className="px-3 py-2 font-medium">وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.recentPurchases.map((purchase) => (
              <tr
                key={purchase.id}
                className="cursor-pointer transition-colors hover:bg-muted/40"
                onClick={() => router.push(`/purchases/${purchase.id}`)}
              >
                <td className="px-3 py-2 font-mono text-xs text-foreground">{purchase.purchaseNumber}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(purchase.purchaseDate)}</td>
                <td className="px-3 py-2">{purchase.supplier.name}</td>
                <td className="px-3 py-2 font-medium whitespace-nowrap tabular-nums">{formatMoney(purchase.totalAmount)} ریال</td>
                <td className="px-3 py-2">
                  <StatusBadge label={purchasePaymentStatusLabels[purchase.paymentStatus]} tone={purchasePaymentStatusTone[purchase.paymentStatus]} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge label={purchaseStatusLabels[purchase.status]} tone={purchaseStatusTone[purchase.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const retryOpenItems = () => setOpenItemsReloadKey((key) => key + 1);
  const thClass = "px-3 py-2 font-medium";
  const tdClass = "px-3 py-2";

  // Shared loading/error state for the three sections backed by /open-items.
  function openItemsPending() {
    if (openItemsError) return <ErrorState message={openItemsError} onRetry={retryOpenItems} />;
    if (!openItems) return <SectionMessage message="در حال بارگذاری..." />;
    return null;
  }

  function renderPaymentAging() {
    const pending = openItemsPending();
    if (pending || !openItems) return pending;
    if (openItems.paymentAging.every((row) => row.purchaseCount === 0)) return <EmptyState message="بدهی پرداخت‌نشده‌ای وجود ندارد." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>بازه زمانی</th>
              <th className={thClass}>تعداد خرید</th>
              <th className={thClass}>مبلغ مانده</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {openItems.paymentAging.map((row) => (
              <tr key={row.bucket}>
                <td className={tdClass}>{agingBucketLabel(row.bucket)}</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(row.purchaseCount)}</td>
                <td className={`${tdClass} font-medium whitespace-nowrap tabular-nums`}>{formatMoney(row.outstandingAmount)} ریال</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderRequestAging() {
    const pending = openItemsPending();
    if (pending || !openItems) return pending;
    if (openItems.requestAging.every((row) => row.requestCount === 0)) return <EmptyState message="درخواست خرید بازی وجود ندارد." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>بازه زمانی</th>
              <th className={thClass}>تعداد درخواست</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {openItems.requestAging.map((row) => (
              <tr key={row.bucket}>
                <td className={tdClass}>{agingBucketLabel(row.bucket)}</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(row.requestCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSupplierSpend() {
    if (error && !rangeInvalid) return <ErrorState message={error} onRetry={retry} />;
    if (pendingMessage || !summary) return <SectionMessage message={pendingMessage ?? ""} />;
    if (summary.topSuppliers.length === 0) return <EmptyState message="در این بازه خریدی ثبت نشده است." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>تأمین‌کننده</th>
              <th className={thClass}>مبلغ خرید در دوره</th>
              <th className={thClass}>تعداد خرید</th>
              <th className={thClass}>مانده پرداخت‌نشده</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {summary.topSuppliers.map((row) => (
              <tr key={row.supplier.id}>
                <td className={tdClass}>{row.supplier.name}</td>
                <td className={`${tdClass} font-medium whitespace-nowrap tabular-nums`}>{formatMoney(row.spend)} ریال</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(row.purchaseCount)}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatMoney(row.outstanding)} ریال</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderOpenPurchases(items: OpenPurchase[]) {
    if (items.length === 0) return <EmptyState message="خرید بازی وجود ندارد." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>شماره خرید</th>
              <th className={thClass}>تاریخ</th>
              <th className={thClass}>مدت</th>
              <th className={thClass}>تأمین‌کننده</th>
              <th className={thClass}>مبلغ کل</th>
              <th className={thClass}>مانده</th>
              <th className={thClass}>پرداخت</th>
              <th className={thClass}>وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((purchase) => (
              <tr key={purchase.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/purchases/${purchase.id}`)}>
                <td className={`${tdClass} font-mono text-xs text-foreground`}>{purchase.purchaseNumber}</td>
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{formatJalali(purchase.purchaseDate)}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatAgeDuration(purchase.ageDays)}</td>
                <td className={tdClass}>{purchase.supplier.name}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatMoney(purchase.totalAmount)} ریال</td>
                <td className={`${tdClass} font-medium whitespace-nowrap tabular-nums`}>{formatMoney(purchase.outstanding)} ریال</td>
                <td className={tdClass}><StatusBadge label={purchasePaymentStatusLabels[purchase.paymentStatus]} tone={purchasePaymentStatusTone[purchase.paymentStatus]} /></td>
                <td className={tdClass}><StatusBadge label={purchaseStatusLabels[purchase.status]} tone={purchaseStatusTone[purchase.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderOpenRequests(items: OpenRequest[]) {
    if (items.length === 0) return <EmptyState message="درخواست خرید بازی وجود ندارد." />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>شماره درخواست</th>
              <th className={thClass}>تاریخ</th>
              <th className={thClass}>مدت</th>
              <th className={thClass}>واحد درخواست‌کننده</th>
              <th className={thClass}>اولویت</th>
              <th className={thClass}>وضعیت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((request) => (
              <tr key={request.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/purchase-requests/${request.id}`)}>
                <td className={`${tdClass} font-mono text-xs text-foreground`}>{request.requestNumber}</td>
                <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>{formatJalali(request.requestDate)}</td>
                <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatAgeDuration(request.ageDays)}</td>
                <td className={tdClass}>{request.requesterDepartment.name}</td>
                <td className={tdClass}><StatusBadge label={purchaseRequestPriorityLabels[request.priority]} tone={purchaseRequestPriorityTone[request.priority]} /></td>
                <td className={tdClass}><StatusBadge label={purchaseRequestStatusLabels[request.status]} tone={purchaseRequestStatusTone[request.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderOpenItems() {
    const pending = openItemsPending();
    if (pending || !openItems) return pending;
    const list = openItemsTab === "purchases" ? openItems.openPurchases : openItems.openRequests;
    return (
      <>
        {openItemsTab === "purchases" ? renderOpenPurchases(openItems.openPurchases.items) : renderOpenRequests(openItems.openRequests.items)}
        {list.total > 0 ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            {toPersianDigits(list.items.length)} مورد قدیمی‌تر از {toPersianDigits(list.total)} مورد باز
          </p>
        ) : null}
      </>
    );
  }

  const openItemsTabs: { key: OpenItemsTab; label: string; count: number | null; href: string }[] = [
    { key: "purchases", label: "خریدهای باز", count: openItems?.openPurchases.total ?? null, href: "/purchases" },
    { key: "requests", label: "درخواست‌های باز", count: openItems?.openRequests.total ?? null, href: "/purchase-requests" },
  ];
  const activeOpenItemsHref = openItemsTabs.find((tab) => tab.key === openItemsTab)?.href ?? "/purchases";

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">نمای کلی سامانه</p>
            <h1 className="text-2xl font-semibold tracking-tight">سلام، {user.username}</h1>
            <p className="mt-2 text-sm text-muted-foreground">خلاصه وضعیت کسب‌وکار و فعالیت‌های اخیر</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {period === "custom" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>از</span>
                <JalaliDateInput idPrefix="dashboard-from" value={customFrom} onChange={setCustomFrom} />
                <span>تا</span>
                <JalaliDateInput idPrefix="dashboard-to" value={customTo} onChange={setCustomTo} />
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="size-4" />
              <span className="sr-only">بازه گزارش</span>
              <select className="h-9 rounded-lg border border-input bg-card px-3 text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)}>
                {periodOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </section>

        {visibleKpis.length > 0 ? <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="شاخص‌های کلیدی">
          {visibleKpis.map((kpi) => {
            const KpiIcon = kpi.icon;
            return <Card key={kpi.key} size="sm"><CardContent className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm text-muted-foreground">{kpi.label}</p>{renderKpiBody(kpi.key)}</div><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><KpiIcon className="size-4" /></span></CardContent></Card>;
          })}
        </section> : null}

        {canViewTransactions ? <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
          <Card>
            <CardHeader className="border-b border-border"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>روند خرید و فروش</CardTitle><p className="mt-1 text-sm text-muted-foreground">گزارش دوره: {periodDescription}{summary?.period.bucket === "week" && activeChartMetric === "خریدها" ? " (هفتگی)" : ""}</p></div><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" value={activeChartMetric} onChange={(event) => setChartMetric(event.target.value)}>{canViewPurchases ? <option>خریدها</option> : null}{canViewSales ? <option>فروش‌ها</option> : null}</select></div></CardHeader>
            <CardContent className="pt-4">{renderTrend()}</CardContent>
          </Card>
          <Card><CardHeader className="border-b border-border"><CardTitle>فعالیت‌های اخیر</CardTitle></CardHeader><CardContent className="pt-4">{renderActivity()}</CardContent></Card>
        </section> : null}

        {canViewPurchases ? <section className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader className="border-b border-border"><CardTitle>مدت‌زمان مانده پرداخت خریدها</CardTitle><p className="mt-1 text-sm text-muted-foreground">بر اساس روزهای گذشته از تاریخ خرید — مستقل از بازه</p></CardHeader><CardContent className="pt-4">{renderPaymentAging()}</CardContent></Card>
          <Card><CardHeader className="border-b border-border"><CardTitle>مدت‌زمان درخواست‌های خرید باز</CardTitle><p className="mt-1 text-sm text-muted-foreground">ارسال‌شده، تأییدشده یا نیمه‌خریداری‌شده — مستقل از بازه</p></CardHeader><CardContent className="pt-4">{renderRequestAging()}</CardContent></Card>
        </section> : null}

        {canViewPurchases ? <Card>
          <CardHeader className="border-b border-border"><CardTitle>نمای کلی هزینه به تفکیک تأمین‌کننده</CardTitle><p className="mt-1 text-sm text-muted-foreground">پنج تأمین‌کننده با بیشترین مبلغ خرید — گزارش دوره: {periodDescription}. بر اساس مبلغ خرید؛ شامل داده تحویل یا کیفیت نیست. مانده پرداخت‌نشده مستقل از بازه است.</p></CardHeader>
          <CardContent className="pt-4">{renderSupplierSpend()}</CardContent>
        </Card> : null}

        {canViewPurchases ? <Card>
          <CardHeader className="border-b border-border"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>موارد باز</CardTitle><p className="mt-1 text-sm text-muted-foreground">قدیمی‌ترین خریدها و درخواست‌های خرید باز</p></div><div className="flex items-center gap-2"><div role="tablist" aria-label="نوع موارد باز" className="flex items-center gap-1">{openItemsTabs.map((tab) => <Button key={tab.key} role="tab" aria-selected={openItemsTab === tab.key} variant={openItemsTab === tab.key ? "secondary" : "ghost"} size="sm" onClick={() => setOpenItemsTab(tab.key)}>{tab.label}{tab.count !== null ? ` (${toPersianDigits(tab.count)})` : ""}</Button>)}</div><Button variant="link" size="sm" className="gap-1" onClick={() => router.push(activeOpenItemsHref)}>مشاهده همه<ArrowUpRight className="size-3.5" /></Button></div></div></CardHeader>
          <CardContent className="pt-4">{renderOpenItems()}</CardContent>
        </Card> : null}

        {canViewTransactions ? <Card>
          <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><div><CardTitle>آخرین تراکنش‌ها</CardTitle><p className="mt-1 text-sm text-muted-foreground">خریدها و فروش‌های ثبت‌شده در سامانه</p></div><Button variant="link" size="sm" className="gap-1" disabled={!canViewPurchases} onClick={() => router.push("/purchases")}>مشاهده همه<ArrowUpRight className="size-3.5" /></Button></div></CardHeader>
          <CardContent className="pt-4">{renderTransactions()}<div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{canViewPurchases && summary && summary.recentPurchases.length > 0 ? `${toPersianDigits(summary.recentPurchases.length)} خرید اخیر` : "صفحه ۱ از ۱"}</span><div className="flex items-center gap-1"><Button variant="outline" size="icon-sm" disabled aria-label="صفحه قبل"><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon-sm" disabled aria-label="صفحه بعد"><ChevronLeft className="size-3.5 rotate-180" /></Button></div></div></CardContent>
        </Card> : null}
      </div>
    </div>
  );
}
