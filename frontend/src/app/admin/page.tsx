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
};

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
    if (error && !rangeInvalid) return <p className="mt-3 text-sm font-medium text-destructive">دریافت اطلاعات ناموفق بود</p>;
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

        {canViewTransactions ? <Card>
          <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><div><CardTitle>آخرین تراکنش‌ها</CardTitle><p className="mt-1 text-sm text-muted-foreground">خریدها و فروش‌های ثبت‌شده در سامانه</p></div><Button variant="link" size="sm" className="gap-1" disabled={!canViewPurchases} onClick={() => router.push("/purchases")}>مشاهده همه<ArrowUpRight className="size-3.5" /></Button></div></CardHeader>
          <CardContent className="pt-4">{renderTransactions()}<div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{canViewPurchases && summary && summary.recentPurchases.length > 0 ? `${toPersianDigits(summary.recentPurchases.length)} خرید اخیر` : "صفحه ۱ از ۱"}</span><div className="flex items-center gap-1"><Button variant="outline" size="icon-sm" disabled aria-label="صفحه قبل"><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon-sm" disabled aria-label="صفحه بعد"><ChevronLeft className="size-3.5 rotate-180" /></Button></div></div></CardContent>
        </Card> : null}
      </div>
    </div>
  );
}
