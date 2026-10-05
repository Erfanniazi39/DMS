"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type ApiError } from "@/lib/api";
import { ROLE_LABELS, type RoleName } from "@/lib/roles";

type Role = RoleName;
type AccountStatus = "ACTIVE" | "DISABLED" | "LOCKED";

const statusLabels: Record<AccountStatus, string> = {
  ACTIVE: "فعال",
  DISABLED: "غیرفعال",
  LOCKED: "قفل‌شده",
};

const emptyForm = {
  username: "",
  password: "",
  email: "",
  phone: "",
  roleName: "VIEWER" as Role,
  status: "ACTIVE" as AccountStatus,
};

// USER accounts are created independently here — there is no Employee
// selector, and creating a User never creates or references an Employee.
export default function AddUsersPage() {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  // Phone numbers must be exactly 11 Latin digits — strip anything that
  // isn't an ASCII 0-9 (symbols, spaces, Persian/Arabic-indic digits) and
  // cap the length while typing.
  function updatePhone(value: string) {
    const digitsOnly = value.replace(/[^0-9]/g, "").slice(0, 11);
    update("phone", digitsOnly);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          roleName: form.roleName,
          status: form.status,
        }),
      });
      setSuccess("کاربر جدید با موفقیت ایجاد شد.");
      setForm(emptyForm);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401) {
        router.replace("/login");
        return;
      }
      setError(apiError.message ?? "ایجاد کاربر ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">افزودن کاربر</h1>
        <p className="mt-1 text-sm text-muted-foreground">ایجاد یک حساب کاربری مستقل برای ورود به سامانه.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">اطلاعات حساب</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" autoComplete="off">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-username">نام کاربری</Label>
                <Input
                  id="new-username"
                  name="new-username"
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) => update("username", event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-account-password">رمز عبور</Label>
                <Input
                  id="new-account-password"
                  name="new-account-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => update("password", event.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">ایمیل</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">شماره تلفن</Label>
                <Input
                  id="phone"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="09xxxxxxxxx"
                  value={form.phone}
                  onChange={(event) => updatePhone(event.target.value)}
                  maxLength={11}
                  pattern="[0-9]{11}"
                  title="شماره تلفن باید دقیقاً ۱۱ رقم انگلیسی باشد"
                />
                {form.phone && form.phone.length !== 11 ? (
                  <p className="text-xs text-muted-foreground">شماره تلفن باید ۱۱ رقم باشد ({form.phone.length} رقم وارد شده).</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="roleName">نقش</Label>
                <select
                  id="roleName"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.roleName}
                  onChange={(event) => update("roleName", event.target.value as Role)}
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="status">وضعیت حساب</Label>
                <select
                  id="status"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.status}
                  onChange={(event) => update("status", event.target.value as AccountStatus)}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="text-sm text-success" role="status">
                {success}
              </p>
            ) : null}
            <Button type="submit" disabled={loading}>
              {loading ? "در حال ایجاد..." : "ایجاد کاربر"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
