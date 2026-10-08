"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatJalali, toPersianDigits } from "@/lib/jalali";
import { formatMoney } from "@/lib/format";
import { useAdminUser } from "@/app/admin/layout";
import {
  NoAccess,
  REPORT_PERIOD_OPTIONS,
  type BacklogOrder,
  type DailySummaryResponse,
  type ReportPeriodKey,
  type SalesByCustomerResponse,
  type SalesByItemResponse,
} from "./shared";

// echarts draws into a real DOM canvas — client-only.
const DailyTrendChart = dynamic(() => import("./DailyTrendChart"), {
  ssr: false,
  loading: () => <p className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">در حال بارگذاری نمودار...</p>,
});

type ReportTab = "backlog" | "byItem" | "byCustomer" | "daily";

const TABS: { key: ReportTab; label: string }[] = [
  { key: "backlog", label: "سفارش‌های عقب‌افتاده" },
  { key: "byItem", label: "فروش به تفکیک کالا" },
  { key: "byCustomer", label: "فروش به تفکیک مشتری" },
  { key: "daily", label: "روند روزانهٔ فروش" },
];

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center">
      <CircleAlert className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
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

const thClass = "px-3 py-2.5 font-medium";
const tdClass = "px-3 py-2.5";

// گزارش‌های فروش — Sales reports (build plan §6/§8, Batch 7). Four
// independent, read-only reports sharing one period selector (except the
// backlog, which is "right now" and isn't period-scoped): open order
// backlog, revenue by item, revenue by customer, and a daily/weekly trend.
// Every number here comes straight from the backend's own
// aggregate/groupBy — nothing is recomputed on the client.
export default function SalesReportsPage() {
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;

  const [tab, setTab] = useState<ReportTab>("backlog");
  const [period, setPeriod] = useState<ReportPeriodKey>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [backlog, setBacklog] = useState<BacklogOrder[] | null>(null);
  const [byItem, setByItem] = useState<SalesByItemResponse | null>(null);
  const [byCustomer, setByCustomer] = useState<SalesByCustomerResponse | null>(null);
  const [daily, setDaily] = useState<DailySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const customIncomplete = period === "custom" && (!customFrom || !customTo);
  const customReversed = period === "custom" && !!customFrom && !!customTo && customFrom > customTo;
  const rangeInvalid = customIncomplete || customReversed;

  useEffect(() => {
    if (!canView) return;
    if (tab !== "backlog" && rangeInvalid) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === "backlog") {
          const data = await apiFetch<BacklogOrder[]>("/sales/reports/backlog");
          if (!cancelled) setBacklog(data);
          return;
        }
        const params = new URLSearchParams({ period });
        if (period === "custom") {
          params.set("from", customFrom);
          params.set("to", customTo);
        }
        if (tab === "byItem") {
          const data = await apiFetch<SalesByItemResponse>(`/sales/reports/by-item?${params.toString()}`);
          if (!cancelled) setByItem(data);
        } else if (tab === "byCustomer") {
          const data = await apiFetch<SalesByCustomerResponse>(`/sales/reports/by-customer?${params.toString()}`);
          if (!cancelled) setByCustomer(data);
        } else {
          const data = await apiFetch<DailySummaryResponse>(`/sales/reports/daily-summary?${params.toString()}`);
          if (!cancelled) setDaily(data);
        }
      } catch (reason) {
        if (!cancelled) setError((reason as ApiError).message ?? "دریافت گزارش ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canView, tab, period, customFrom, customTo, rangeInvalid, reloadKey]);

  if (!canView) return <NoAccess message="اجازه مشاهده گزارش‌های فروش را ندارید." />;

  const retry = () => setReloadKey((key) => key + 1);
  const periodLabel = REPORT_PERIOD_OPTIONS.find((option) => option.key === period)?.label ?? "";

  function periodDescription(echo: { from: string; to: string } | undefined) {
    if (period === "custom" && echo && !rangeInvalid) {
      return `${formatJalali(`${echo.from}T00:00:00`)} تا ${formatJalali(`${echo.to}T00:00:00`)}`;
    }
    return periodLabel;
  }

  function renderBacklog() {
    if (error) return <ErrorState message={error} onRetry={retry} />;
    if (loading || backlog === null) return <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
    if (backlog.length === 0) return <EmptyState message="هیچ سفارش بازی برای تحویل وجود ندارد." />;
    return (
      <div className="space-y-4">
        {backlog.map((order) => (
          <div key={order.id} className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                <span className="font-mono text-xs">{order.orderNumber ?? `#${toPersianDigits(order.id)}`}</span>
                <span className="text-muted-foreground"> — </span>
                <bdi>{order.customer.name}</bdi>
              </span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{formatJalali(order.orderDate)}</span>
                <span className="font-medium text-foreground tabular-nums">{formatMoney(order.totalRemainingValue)} ریال باقی‌مانده</span>
              </span>
            </div>
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/10 text-xs text-muted-foreground">
                <tr>
                  <th className={thClass}>ردیف</th>
                  <th className={thClass}>کالا</th>
                  <th className={thClass}>واحد</th>
                  <th className={thClass}>مقدار باقی‌مانده</th>
                  <th className={thClass}>ارزش باقی‌مانده</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td className={tdClass}>{toPersianDigits(line.lineNo)}</td>
                    <td className={tdClass}>{line.itemName}</td>
                    <td className={`${tdClass} text-muted-foreground`}>{line.unitName}</td>
                    <td className={`${tdClass} tabular-nums`}>{toPersianDigits(Number(line.remainingQty))}</td>
                    <td className={`${tdClass} font-medium tabular-nums`}>{formatMoney(line.remainingValue)} ریال</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }

  function renderByItem() {
    if (error) return <ErrorState message={error} onRetry={retry} />;
    if (loading || !byItem) return <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
    if (byItem.rows.length === 0) return <EmptyState message={`در بازه «${periodDescription(byItem.period)}» فروشی ثبت نشده است.`} />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[40rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>کد کالا</th>
              <th className={thClass}>نام کالا</th>
              <th className={thClass}>واحد</th>
              <th className={thClass}>مقدار فروش‌رفته</th>
              <th className={thClass}>تعداد ردیف فاکتور</th>
              <th className={thClass}>درآمد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {byItem.rows.map((row) => (
              <tr key={row.item.id} className="hover:bg-muted/30">
                <td className={`${tdClass} font-mono text-xs`}>{row.item.code}</td>
                <td className={tdClass}>{row.item.name}</td>
                <td className={`${tdClass} text-muted-foreground`}>{row.item.unit?.nameFa ?? "-"}</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(Number(row.quantity))}</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(row.invoiceLineCount)}</td>
                <td className={`${tdClass} font-medium tabular-nums`}>{formatMoney(row.revenue)} ریال</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderByCustomer() {
    if (error) return <ErrorState message={error} onRetry={retry} />;
    if (loading || !byCustomer) return <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
    if (byCustomer.rows.length === 0) return <EmptyState message={`در بازه «${periodDescription(byCustomer.period)}» فروشی ثبت نشده است.`} />;
    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] text-right text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className={thClass}>مشتری</th>
              <th className={thClass}>مقدار فروش‌رفته</th>
              <th className={thClass}>تعداد فاکتور</th>
              <th className={thClass}>درآمد</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {byCustomer.rows.map((row) => (
              <tr key={row.customer.id} className="hover:bg-muted/30">
                <td className={tdClass}>
                  <bdi>{row.customer.name}</bdi>{" "}
                  <span className="font-mono text-[11px] text-muted-foreground">{row.customer.customerNumber}</span>
                </td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(Number(row.quantity))}</td>
                <td className={`${tdClass} tabular-nums`}>{toPersianDigits(row.invoiceCount)}</td>
                <td className={`${tdClass} font-medium tabular-nums`}>{formatMoney(row.revenue)} ریال</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderDaily() {
    if (error) return <ErrorState message={error} onRetry={retry} />;
    if (loading || !daily) return <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
    if (daily.trend.every((point) => point.confirmedOrderCount === 0 && point.invoicedCount === 0 && point.paymentCount === 0)) {
      return <EmptyState message={`در بازه «${periodDescription(daily.period)}» فعالیتی ثبت نشده است.`} />;
    }
    return <DailyTrendChart points={daily.trend} bucket={daily.period.bucket} />;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">گزارش‌های فروش</h1>
            <p className="mt-1 text-sm text-muted-foreground">عقب‌افتاده‌ها، فروش به تفکیک کالا/مشتری، و روند روزانه</p>
          </div>
          {tab !== "backlog" ? (
            <div className="flex flex-wrap items-center gap-3">
              {period === "custom" ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>از</span>
                  <JalaliDateInput idPrefix="sales-reports-from" value={customFrom} onChange={setCustomFrom} />
                  <span>تا</span>
                  <JalaliDateInput idPrefix="sales-reports-to" value={customTo} onChange={setCustomTo} />
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-4" />
                <span className="sr-only">بازه گزارش</span>
                <select
                  className="h-9 rounded-lg border border-input bg-card px-3 text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value as ReportPeriodKey)}
                >
                  {REPORT_PERIOD_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>

        <div role="tablist" aria-label="نوع گزارش فروش" className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
          {TABS.map((item) => (
            <Button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              variant={tab === item.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {tab === "backlog" ? (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>سفارش‌های عقب‌افتاده</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">سفارش‌های تأییدشده‌ای که هنوز به‌طور کامل تحویل نشده‌اند — وضعیت فعلی، مستقل از بازه</p>
            </CardHeader>
            <CardContent className="pt-4">{renderBacklog()}</CardContent>
          </Card>
        ) : null}

        {tab === "byItem" ? (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>فروش به تفکیک کالا</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">بر اساس فاکتورهای ثبت‌شدهٔ عملیاتی — گزارش دوره: {periodDescription(byItem?.period)}</p>
            </CardHeader>
            <CardContent className="pt-4">{renderByItem()}</CardContent>
          </Card>
        ) : null}

        {tab === "byCustomer" ? (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>فروش به تفکیک مشتری</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">بر اساس فاکتورهای ثبت‌شدهٔ عملیاتی — گزارش دوره: {periodDescription(byCustomer?.period)}</p>
            </CardHeader>
            <CardContent className="pt-4">{renderByCustomer()}</CardContent>
          </Card>
        ) : null}

        {tab === "daily" ? (
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle>روند روزانهٔ فروش</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                سفارش‌های تأییدشده، فاکتورهای صادرشده و دریافت‌های تکمیل‌شده — گزارش دوره: {periodDescription(daily?.period)}
                {daily?.period.bucket === "week" ? " (هفتگی)" : ""}
              </p>
            </CardHeader>
            <CardContent className="pt-4">{renderDaily()}</CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
