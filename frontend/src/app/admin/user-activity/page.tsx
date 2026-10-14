"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { ActivityTable, type ActivityRow } from "@/components/admin/activity-table";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { ENTITY_LABELS } from "@/lib/audit-labels";

type UserOption = { id: number; username: string; fullName: string | null };

const PAGE_SIZE = 20;
const ACTION_OPTIONS = [
  { value: "LOGIN", label: "ورود به سامانه" },
  { value: "LOGOUT", label: "خروج از سامانه" },
  { value: "LOGIN_FAILED", label: "ورود ناموفق" },
];
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

type Filters = { userId: string; action: string; entityType: string; from: string; to: string };
const EMPTY_FILTERS: Filters = { userId: "", action: "", entityType: "", from: "", to: "" };

function ActivityContent() {
  const searchParams = useSearchParams();
  const initialUserId = searchParams.get("userId") ?? "";
  const [users, setUsers] = useState<UserOption[]>([]);
  const [draft, setDraft] = useState<Filters>({ ...EMPTY_FILTERS, userId: initialUserId });
  const [applied, setApplied] = useState<Filters>({ ...EMPTY_FILTERS, userId: initialUserId });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ActivityRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserOption[]>("/users").then(setUsers).catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(applied)) if (value) query.set(key, value);
    let active = true;
    apiFetch<Paginated<ActivityRow>>(`/audit/activity?${query}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((err: ApiError) => active && setError(err.message ?? "دریافت فعالیت‌ها ناموفق بود."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [applied, page]);

  function changePage(next: number) {
    setLoading(true);
    setPage(next);
  }
  function applyFilters() {
    setLoading(true);
    setApplied(draft);
    setPage(1);
  }
  function clearFilters() {
    setLoading(true);
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">فعالیت کاربران</h1>
          <p className="mt-2 text-sm text-muted-foreground">گزارش ورود و خروج و عملیات ثبت‌شده توسط کاربران سامانه</p>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">فیلترها</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="space-y-1 text-xs text-muted-foreground">کاربر
                <select className={selectClass} value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })}>
                  <option value="">همه کاربران</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}{u.fullName ? ` — ${u.fullName}` : ""}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">ورود / خروج
                <select className={selectClass} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
                  <option value="">همه</option>
                  {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">بخش
                <select className={selectClass} value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}>
                  <option value="">همه بخش‌ها</option>
                  {Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <div className="space-y-1 text-xs text-muted-foreground">از تاریخ
                <JalaliDateInput idPrefix="activity-from" value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">تا تاریخ
                <JalaliDateInput idPrefix="activity-to" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters}>اعمال فیلتر</Button>
              <Button size="sm" variant="outline" onClick={clearFilters}>پاک کردن</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 pt-4">
            {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
            {!error && data && data.items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">فعالیتی با این فیلترها یافت نشد.</p> : null}
            {!error && data && data.items.length > 0 ? <ActivityTable rows={data.items} showUser /> : null}
            {!data && loading ? <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p> : null}
            {data ? <ListPagination page={page} pageSize={PAGE_SIZE} total={data.total} loading={loading} onPageChange={changePage} /> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function UserActivityPage() {
  return (
    <RequirePermission permission="users.create" message="شما اجازه مشاهده فعالیت کاربران را ندارید.">
      <Suspense fallback={null}>
        <ActivityContent />
      </Suspense>
    </RequirePermission>
  );
}
