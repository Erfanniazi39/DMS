"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/roles";

type Permission = { code: string; label: string; module: string };
// USER records only — no Employee/Department fields, since User is independent of Employee.
type UserPermissionRecord = { id: number; username: string; email: string | null; role: string; rolePermissions: string[]; additionalPermissions: string[]; effectivePermissions: string[] };

export default function UserPermissionsSection() {
  const [users, setUsers] = useState<UserPermissionRecord[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedAdditional, setSelectedAdditional] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userQuery, setUserQuery] = useState("");

  async function load() {
    try {
      const [userData, permissionData] = await Promise.all([apiFetch<UserPermissionRecord[]>("/access/user-permissions"), apiFetch<Permission[]>("/access/permissions")]);
      setUsers(userData); setPermissions(permissionData);
      const current = userData.find((user) => user.id === selectedId) ?? userData[0];
      if (current) { setSelectedId(current.id); setSelectedAdditional(current.additionalPermissions); }
    } catch (error) { setMessage((error as ApiError).message ?? "دریافت دسترسی کاربران ناموفق بود."); }
  }

  useEffect(() => {
    const run = async () => load();
    void run();
    // The user permission data is loaded once when this section mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persian labels come from the backend's PERMISSION_CATALOG via /access/permissions,
  // so newly added permissions are labelled without a frontend change.
  const permissionLabels = useMemo(() => new Map(permissions.map((permission) => [permission.code, permission.label])), [permissions]);
  const permissionLabel = (code: string) => permissionLabels.get(code) ?? code;
  const selected = users.find((user) => user.id === selectedId);
  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return users;
    return users.filter((user) => `${user.username} ${user.email ?? ""}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [users, userQuery]);
  function toggle(code: string) { setSelectedAdditional((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]); }
  async function save() {
    if (selectedId === null || !selected) return;
    setSaving(true);
    try {
      // Never persist a permission as "additional" if the user's role already grants it.
      const codesToSave = selectedAdditional.filter((code) => !selected.rolePermissions.includes(code));
      await apiFetch(`/access/user-permissions/${selectedId}`, { method: "PATCH", body: JSON.stringify({ permissionCodes: codesToSave }) });
      setMessage("دسترسی‌های اضافی ذخیره شد.");
      await load();
    } catch (error) {
      setMessage((error as ApiError).message ?? "ذخیره دسترسی‌ها ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scroll-mt-24 space-y-5" aria-labelledby="user-permissions-heading">
      <div>
        <h2 id="user-permissions-heading" className="text-2xl font-semibold">دسترسی کاربران</h2>
        <p className="mt-2 text-sm text-muted-foreground">دسترسی نهایی هر کاربر از نقش و دسترسی‌های اضافی او تشکیل می‌شود.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">کاربران ({filteredUsers.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <input
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground"
              placeholder="جستجوی کاربر..."
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
            />
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pe-1">
              {filteredUsers.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-muted-foreground">کاربری با این مشخصات یافت نشد.</p>
              ) : (
                filteredUsers.map((user) => (
                  <button key={user.id} className={`w-full rounded-lg border px-3 py-3 text-right ${selectedId === user.id ? "border-primary bg-accent" : "border-border hover:bg-muted"}`} onClick={() => { setSelectedId(user.id); setSelectedAdditional(user.additionalPermissions); }}>
                    <span className="block text-sm font-medium">{user.username}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{roleLabel(user.role)}{user.email ? ` · ${user.email}` : ""}</span>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{selected ? selected.username : "انتخاب کاربر"}</CardTitle></CardHeader>
          <CardContent>
            {selected ? (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium">نقش: {roleLabel(selected.role)}</p>
                  {selected.email ? <p className="mt-1 text-xs text-muted-foreground">ایمیل: {selected.email}</p> : null}
                </div>
                <section>
                  <h3 className="mb-2 text-sm font-medium">دسترسی‌های نقش</h3>
                  <p className="text-sm text-muted-foreground">{selected.rolePermissions.map(permissionLabel).join("، ") || "بدون دسترسی"}</p>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-medium">دسترسی‌های اضافی</h3>
                  <p className="mb-2 text-xs text-muted-foreground">دسترسی‌هایی که از نقش کاربر به او رسیده، در این فهرست نمایش داده نمی‌شوند.</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {permissions
                      .filter((permission) => !selected.rolePermissions.includes(permission.code))
                      .map((permission) => (
                        <label className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted" key={permission.code}>
                          <input type="checkbox" checked={selectedAdditional.includes(permission.code)} onChange={() => toggle(permission.code)} />
                          {permission.label}
                        </label>
                      ))}
                    {permissions.every((permission) => selected.rolePermissions.includes(permission.code)) ? (
                      <p className="text-sm text-muted-foreground sm:col-span-2">تمام دسترسی‌ها از طریق نقش این کاربر تأمین شده است.</p>
                    ) : null}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-medium">دسترسی‌های نهایی</h3>
                  <p className="text-sm text-muted-foreground">{[...new Set([...selected.rolePermissions, ...selectedAdditional])].map(permissionLabel).join("، ") || "بدون دسترسی"}</p>
                </section>
                <Button onClick={save} disabled={saving}>{saving ? "در حال ذخیره..." : "ذخیره دسترسی‌های اضافی"}</Button>
                {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">کاربری برای نمایش وجود ندارد.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
