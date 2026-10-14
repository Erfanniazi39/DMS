"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { ActivityTable, type ActivityRow } from "@/components/admin/activity-table";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/audit-labels";
import { roleLabel } from "@/lib/roles";

type UserDetail = {
  id: number;
  username: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
  createdAt: string;
  lastLoginAt: string | null;
  rolePermissions: string[];
  additionalPermissions: string[];
};
type Permission = { code: string; label: string; module: string };

const STATUS_LABELS = { ACTIVE: "فعال", DISABLED: "غیرفعال", LOCKED: "قفل‌شده" } as const;
const PAGE_SIZE = 10;

function Field({ label, value, ltr }: { label: string; value: string | null | undefined; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm" dir={ltr && value ? "ltr" : undefined}>{value || "وارد نشده"}</dd>
    </div>
  );
}

function UserDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = Number(params.id);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loadError, setError] = useState<string | null>(null);
  const error = Number.isInteger(userId) ? loadError : "شناسه کاربر نامعتبر است.";
  const [activity, setActivity] = useState<Paginated<ActivityRow> | null>(null);
  const [page, setPage] = useState(1);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(userId)) return;
    Promise.all([apiFetch<UserDetail>(`/users/${userId}`), apiFetch<Permission[]>("/access/permissions")])
      .then(([detail, perms]) => {
        setUser(detail);
        setPermissions(perms);
      })
      .catch((err: ApiError) => {
        if (err.status === 401) router.replace("/login");
        else setError(err.message ?? "دریافت اطلاعات کاربر ناموفق بود.");
      });
  }, [userId, router]);

  useEffect(() => {
    if (!Number.isInteger(userId)) return;
    apiFetch<Paginated<ActivityRow>>(`/audit/activity?userId=${userId}&page=${page}&pageSize=${PAGE_SIZE}`)
      .then((data) => {
        setActivity(data);
        setActivityError(null);
      })
      .catch((err: ApiError) => setActivityError(err.message ?? "دریافت فعالیت‌ها ناموفق بود."));
  }, [userId, page]);

  const labelByCode = useMemo(() => new Map(permissions.map((p) => [p.code, p])), [permissions]);
  const permissionGroups = useMemo(() => {
    if (!user) return [];
    const codes = [...new Set([...user.rolePermissions, ...user.additionalPermissions])];
    const groups = new Map<string, { label: string; extra: boolean }[]>();
    for (const code of codes) {
      const info = labelByCode.get(code);
      const moduleName = info?.module ?? "سایر";
      groups.set(moduleName, [...(groups.get(moduleName) ?? []), { label: info?.label ?? code, extra: !user.rolePermissions.includes(code) }]);
    }
    return [...groups.entries()];
  }, [user, labelByCode]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{user ? user.username : "جزئیات کاربر"}</h1>
            {user?.fullName ? <p className="mt-1 text-sm text-muted-foreground">{user.fullName}</p> : null}
          </div>
          <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowRight className="size-4" />بازگشت به کاربران</Link>
        </div>

        {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}

        {user ? (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base">اطلاعات حساب</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="نام کاربری" value={user.username} ltr />
                  <Field label="نام و نام خانوادگی" value={user.fullName} />
                  <Field label="نقش" value={roleLabel(user.role)} />
                  <Field label="وضعیت حساب" value={STATUS_LABELS[user.status]} />
                  <Field label="ایمیل" value={user.email} ltr />
                  <Field label="شماره تلفن" value={user.phone} ltr />
                  <Field label="تاریخ ایجاد حساب" value={formatDateTime(user.createdAt)} />
                  <Field label="آخرین ورود" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : null} />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">دسترسی‌های نهایی</CardTitle></CardHeader>
              <CardContent>
                {permissionGroups.length === 0 ? <p className="text-sm text-muted-foreground">بدون دسترسی</p> : (
                  <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    {permissionGroups.map(([module, items]) => (
                      <div key={module}>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">{module}</p>
                        <ul className="space-y-0.5 text-sm">
                          {items.map((item) => <li key={item.label}>{item.label}{item.extra ? <span className="ms-1 text-xs text-muted-foreground">(اضافی)</span> : null}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-4 text-xs text-muted-foreground">برای تغییر دسترسی‌ها به صفحه «نقش‌ها و دسترسی‌ها» بروید.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">فعالیت‌های اخیر</CardTitle>
                <Link href={`/admin/user-activity?userId=${user.id}`} className="text-xs text-primary hover:underline">مشاهده در گزارش فعالیت کاربران</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {activityError ? <p className="text-sm text-destructive" role="alert">{activityError}</p> : null}
                {activity && activity.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">فعالیتی برای این کاربر ثبت نشده است.</p> : null}
                {activity && activity.items.length > 0 ? (
                  <>
                    <ActivityTable rows={activity.items} showUser={false} />
                    <ListPagination page={page} pageSize={PAGE_SIZE} total={activity.total} onPageChange={setPage} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : !error ? <p className="py-12 text-center text-sm text-muted-foreground">در حال بارگذاری...</p> : null}
      </div>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RequirePermission permission="users.create" message="شما اجازه مشاهده اطلاعات کاربران را ندارید.">
      <UserDetailContent />
    </RequirePermission>
  );
}
