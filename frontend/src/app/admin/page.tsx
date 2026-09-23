"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  ReceiptText,
  ShoppingCart,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminUser } from "./layout";

const kpis = [
  { label: "مجموع خریدها", icon: ShoppingCart, permission: "purchases.manage" },
  { label: "مجموع فروش‌ها", icon: ReceiptText, permission: "sales.manage" },
  { label: "موجودی کالا", icon: Warehouse, permission: "inventory.view" },
  { label: "پرداخت‌های پرداخت‌نشده", icon: ClipboardList, permission: "reports.view" },
];

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 text-center">
      <CircleAlert className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const user = useAdminUser();
  const [period, setPeriod] = useState("این ماه");
  const [chartMetric, setChartMetric] = useState("خریدها");

  if (!user) return null;

  const canViewPurchases = user.permissions.includes("purchases.manage");
  const canViewSales = user.permissions.includes("sales.manage");
  const canViewTransactions = canViewPurchases || canViewSales;
  const visibleKpis = kpis.filter((kpi) => user.permissions.includes(kpi.permission));
  const activeChartMetric = chartMetric === "خریدها" && !canViewPurchases ? "فروش‌ها" : chartMetric;

  return (
    <div className="min-w-0 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">نمای کلی سامانه</p>
            <h1 className="text-2xl font-semibold tracking-tight">سلام، {user.username}</h1>
            <p className="mt-2 text-sm text-muted-foreground">خلاصه وضعیت کسب‌وکار و فعالیت‌های اخیر</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" />
            <span className="sr-only">بازه گزارش</span>
            <select className="h-9 rounded-lg border border-input bg-card px-3 text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" value={period} onChange={(event) => setPeriod(event.target.value)}><option>امروز</option><option>این هفته</option><option>این ماه</option><option>بازه دلخواه</option></select>
          </label>
        </section>

        {visibleKpis.length > 0 ? <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="شاخص‌های کلیدی">
          {visibleKpis.map((kpi) => {
            const KpiIcon = kpi.icon;
            return <Card key={kpi.label} size="sm"><CardContent className="flex items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{kpi.label}</p><p className="mt-3 text-sm font-medium text-muted-foreground">اطلاعاتی برای نمایش وجود ندارد</p></div><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><KpiIcon className="size-4" /></span></CardContent></Card>;
          })}
        </section> : null}

        {canViewTransactions ? <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
          <Card>
            <CardHeader className="border-b border-border"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>روند خرید و فروش</CardTitle><p className="mt-1 text-sm text-muted-foreground">گزارش دوره: {period}</p></div><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20" value={activeChartMetric} onChange={(event) => setChartMetric(event.target.value)}>{canViewPurchases ? <option>خریدها</option> : null}{canViewSales ? <option>فروش‌ها</option> : null}</select></div></CardHeader>
            <CardContent className="pt-4"><EmptyState message={`برای نمایش روند ${activeChartMetric} هنوز داده‌ای ثبت نشده است.`} /></CardContent>
          </Card>
          <Card><CardHeader className="border-b border-border"><CardTitle>فعالیت‌های اخیر</CardTitle></CardHeader><CardContent className="pt-4"><EmptyState message="هنوز فعالیتی برای نمایش وجود ندارد." /></CardContent></Card>
        </section> : null}

        {canViewTransactions ? <Card>
          <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><div><CardTitle>آخرین تراکنش‌ها</CardTitle><p className="mt-1 text-sm text-muted-foreground">خریدها و فروش‌های ثبت‌شده در سامانه</p></div><Button variant="link" size="sm" className="gap-1" disabled>مشاهده همه<ArrowUpRight className="size-3.5" /></Button></div></CardHeader>
          <CardContent className="pt-4"><EmptyState message="هنوز اطلاعاتی برای نمایش وجود ندارد." /><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>صفحه ۱ از ۱</span><div className="flex items-center gap-1"><Button variant="outline" size="icon-sm" disabled aria-label="صفحه قبل"><ChevronLeft className="size-3.5" /></Button><Button variant="outline" size="icon-sm" disabled aria-label="صفحه بعد"><ChevronLeft className="size-3.5 rotate-180" /></Button></div></div></CardContent>
        </Card> : null}
      </div>
    </div>
  );
}
