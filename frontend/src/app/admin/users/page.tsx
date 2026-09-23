"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type ApiError } from "@/lib/api";

type UserStatus = "ACTIVE" | "DISABLED" | "LOCKED";
type UserRole = "ADMIN" | "DATA_OPERATOR" | "PURCHASE_MANAGER" | "SALES_MANAGER" | "VIEWER";
// USER records only — no Employee data is joined in or displayed here.
type UserRecord = {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
};

const statusLabels: Record<UserStatus, string> = {
  ACTIVE: "فعال",
  DISABLED: "غیرفعال",
  LOCKED: "قفل‌شده",
};

const roleLabels: Record<string, string> = {
  ADMIN: "مدیر سیستم",
  DATA_OPERATOR: "اپراتور داده",
  PURCHASE_MANAGER: "مسئول خرید",
  SALES_MANAGER: "مسئول فروش",
  VIEWER: "مشاهده‌گر",
};

const roleOptions: UserRole[] = ["ADMIN", "DATA_OPERATOR", "PURCHASE_MANAGER", "SALES_MANAGER", "VIEWER"];
const statusOptions: UserStatus[] = ["ACTIVE", "DISABLED", "LOCKED"];

function formatDate(value: string | null) {
  if (!value) return "وارد نشده";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type EditForm = {
  username: string;
  password: string;
  roleName: UserRole;
  status: UserStatus;
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 8;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ username: "", password: "", roleName: "VIEWER", status: "ACTIVE" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserRecord[]>("/users")
      .then(setUsers)
      .catch((err: ApiError) => {
        if (err.status === 401) router.replace("/login");
        else setError(err.message ?? "دریافت فهرست کاربران ناموفق بود.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  const roles = useMemo(() => Array.from(new Set(users.map((user) => user.role))), [users]);
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return users.filter((user) => {
      const haystack = `${user.username} ${user.email ?? ""} ${user.phone ?? ""}`.toLocaleLowerCase();
      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
      return matchesQuery && (role === "all" || user.role === role) && (status === "all" || user.status === status);
    });
  }, [query, role, status, users]);

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const visibleUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function startEdit(user: UserRecord) {
    setEditingId(user.id);
    setEditForm({ username: user.username, password: "", roleName: user.role as UserRole, status: user.status });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit(user: UserRecord) {
    const payload: Record<string, string> = {};
    if (editForm.username.trim() && editForm.username.trim() !== user.username) {
      payload.username = editForm.username.trim();
    }
    if (editForm.password) {
      if (editForm.password.length < 8) {
        setEditError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
        return;
      }
      payload.password = editForm.password;
    }
    if (editForm.roleName !== user.role) {
      payload.roleName = editForm.roleName;
    }
    if (editForm.status !== user.status) {
      payload.status = editForm.status;
    }

    if (Object.keys(payload).length === 0) {
      cancelEdit();
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await apiFetch<UserRecord>(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, ...updated } : item)));
      setEditingId(null);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401) {
        router.replace("/login");
        return;
      }
      setEditError(apiError.message ?? "به‌روزرسانی کاربر ناموفق بود.");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">کاربران</h1>
            <p className="mt-2 text-sm text-muted-foreground">مشاهده و مدیریت حساب‌های کاربری سامانه</p>
          </div>
          <Button onClick={() => router.push("/admin/add-users")}><UserPlus /> افزودن کاربر</Button>
        </section>

        <Card>
          <CardHeader><CardTitle className="text-base">فهرست کاربران</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کاربر</span>
                <input className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground" placeholder="جستجو بر اساس نام کاربری، ایمیل یا تلفن" value={query} onChange={(event) => updateFilter(setQuery, event.target.value)} />
              </label>
              <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={role} onChange={(event) => updateFilter(setRole, event.target.value)}><option value="all">همه نقش‌ها</option>{roles.map((value) => <option key={value} value={value}>{roleLabels[value] ?? value}</option>)}</select>
              <select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={status} onChange={(event) => updateFilter(setStatus, event.target.value)}><option value="all">همه وضعیت‌ها</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>

            {loading ? <p className="py-12 text-center text-sm text-muted-foreground">در حال بارگذاری کاربران...</p> : null}
            {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
            {!loading && !error && filteredUsers.length === 0 ? <div className="rounded-lg border border-dashed border-border bg-muted/30 p-12 text-center text-sm text-muted-foreground">هنوز کاربری برای نمایش وجود ندارد.</div> : null}
            {!loading && !error && visibleUsers.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[54rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      <th className="px-4 py-3 font-medium">نام کاربری</th>
                      <th className="px-4 py-3 font-medium">ایمیل</th>
                      <th className="px-4 py-3 font-medium">شماره تلفن</th>
                      <th className="px-4 py-3 font-medium">نقش</th>
                      <th className="px-4 py-3 font-medium">آخرین ورود</th>
                      <th className="px-4 py-3 font-medium">وضعیت حساب</th>
                      <th className="px-4 py-3 font-medium">اقدامات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleUsers.map((user) => (
                      <Fragment key={user.id}>
                        <tr className="hover:bg-muted/30">
                          <td className="px-4 py-3 text-muted-foreground">نامشخص</td>
                          <td className="px-4 py-3">{user.username}</td>
                          <td className="px-4 py-3 text-muted-foreground">{user.email || "وارد نشده"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{user.phone || "وارد نشده"}</td>
                          <td className="px-4 py-3">{roleLabels[user.role] ?? user.role}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(user.lastLoginAt)}</td>
                          <td className="px-4 py-3"><span className="font-medium">{statusLabels[user.status]}</span></td>
                          <td className="px-4 py-3">
                            {user.role === "ADMIN" ? (
                              <span className="text-xs text-muted-foreground">قابل ویرایش نیست</span>
                            ) : (
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() => (editingId === user.id ? cancelEdit() : startEdit(user))}
                              >
                                {editingId === user.id ? "بستن" : "ویرایش"}
                              </Button>
                            )}
                          </td>
                        </tr>
                        {editingId === user.id && user.role !== "ADMIN" ? (
                          <tr className="bg-muted/20">
                            <td colSpan={8} className="px-4 py-4">
                              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`edit-username-${user.id}`}>نام کاربری</Label>
                                  <Input
                                    id={`edit-username-${user.id}`}
                                    name={`edit-username-${user.id}`}
                                    autoComplete="off"
                                    value={editForm.username}
                                    onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))}
                                  />
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`edit-password-${user.id}`}>رمز عبور جدید (اختیاری)</Label>
                                  <Input
                                    id={`edit-password-${user.id}`}
                                    name={`edit-password-${user.id}`}
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="بدون تغییر"
                                    value={editForm.password}
                                    onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))}
                                  />
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`edit-role-${user.id}`}>نقش</Label>
                                  <select
                                    id={`edit-role-${user.id}`}
                                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                                    value={editForm.roleName}
                                    onChange={(event) => setEditForm((current) => ({ ...current, roleName: event.target.value as UserRole }))}
                                  >
                                    {roleOptions.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
                                  </select>
                                </div>
                                <div className="flex flex-col gap-2">
                                  <Label htmlFor={`edit-status-${user.id}`}>وضعیت حساب</Label>
                                  <select
                                    id={`edit-status-${user.id}`}
                                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
                                    value={editForm.status}
                                    onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value as UserStatus }))}
                                  >
                                    {statusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
                                  </select>
                                </div>
                              </div>
                              {editError ? <p className="mt-3 text-sm text-destructive" role="alert">{editError}</p> : null}
                              <div className="mt-4 flex gap-2">
                                <Button size="sm" onClick={() => saveEdit(user)} disabled={editSaving}>
                                  {editSaving ? "در حال ذخیره..." : "ذخیره تغییرات"}
                                </Button>
                                <Button size="sm" variant="outline" onClick={cancelEdit} disabled={editSaving}>
                                  انصراف
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground"><span>{filteredUsers.length} کاربر</span><div className="flex items-center gap-2"><span>صفحه {page} از {pageCount}</span><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>قبلی</Button><Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>بعدی</Button></div></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
