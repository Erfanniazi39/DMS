"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/roles";
import PermissionsSection from "@/components/admin/permissions-section";
import UserPermissionsSection from "@/components/admin/user-permissions-section";

type RoleRecord = { id: number; name: string; userCount: number; permissions: string[] };
type PermissionRecord = { id: number; code: string; label: string; module: string };

function RoleSection() {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [newRole, setNewRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [roleData, permissionData] = await Promise.all([
        apiFetch<RoleRecord[]>("/access/roles"),
        apiFetch<PermissionRecord[]>("/access/permissions"),
      ]);
      setRoles(roleData);
      setPermissions(permissionData);
      const current = roleData.find((role) => role.id === selectedId) ?? roleData[0];
      if (current) {
        setSelectedId(current.id);
        setSelectedPermissions(current.permissions);
      }
    } catch (error) {
      setMessage((error as ApiError).message ?? "دریافت اطلاعات نقش‌ها ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const run = async () => load();
    void run();
    // The role data is loaded once when this section mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRole = roles.find((role) => role.id === selectedId);
  const grouped = permissions.reduce<Record<string, PermissionRecord[]>>((groups, permission) => {
    (groups[permission.module] ??= []).push(permission);
    return groups;
  }, {});

  function togglePermission(code: string) {
    setSelectedPermissions((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code]);
  }

  async function savePermissions() {
    if (selectedId === null) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/access/roles/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ permissionCodes: selectedPermissions }),
      });
      setMessage("دسترسی‌های نقش ذخیره شد.");
      await load();
    } catch (error) {
      setMessage((error as ApiError).message ?? "ذخیره دسترسی‌ها ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function createRole() {
    if (!newRole.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch("/access/roles", {
        method: "POST",
        body: JSON.stringify({ name: newRole.trim(), permissionCodes: [] }),
      });
      setNewRole("");
      setMessage("نقش جدید ایجاد شد.");
      await load();
    } catch (error) {
      setMessage((error as ApiError).message ?? "ایجاد نقش ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scroll-mt-24 space-y-5" aria-labelledby="roles-heading">
      <div>
        <h1 id="roles-heading" className="text-2xl font-semibold">نقش‌ها</h1>
        <p className="mt-2 text-sm text-muted-foreground">مدیریت نقش‌ها و دسترسی‌های وابسته به هر نقش</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">نقش‌های موجود</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {loading ? <p className="text-sm text-muted-foreground">در حال بارگذاری...</p> : roles.map((role) => (
              <button key={role.id} className={`w-full rounded-lg border px-3 py-3 text-right transition-colors ${selectedId === role.id ? "border-primary bg-accent" : "border-border hover:bg-muted"}`} onClick={() => { setSelectedId(role.id); setSelectedPermissions(role.permissions); }}>
                <span className="block text-sm font-medium">{roleLabel(role.name)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{role.name} · {role.userCount} کاربر</span>
              </button>
            ))}
            <div className="border-t border-border pt-3">
              <label className="text-xs text-muted-foreground" htmlFor="new-role">کد نقش جدید</label>
              <div className="mt-2 flex gap-2">
                <input id="new-role" className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" value={newRole} onChange={(event) => setNewRole(event.target.value)} placeholder="مثلاً AUDITOR" />
                <Button size="sm" onClick={createRole} disabled={saving}>ایجاد</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{selectedRole ? roleLabel(selectedRole.name) : "دسترسی‌های نقش"}</CardTitle></CardHeader>
          <CardContent>
            {selectedRole ? <div className="space-y-5">
              {Object.entries(grouped).map(([module, items]) => <fieldset key={module} className="space-y-2"><legend className="mb-2 text-sm font-medium">{module}</legend>{items.map((permission) => <label className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted" key={permission.code}><input type="checkbox" checked={selectedPermissions.includes(permission.code)} onChange={() => togglePermission(permission.code)} /><span>{permission.label}</span><span className="ms-auto text-xs text-muted-foreground">{permission.code}</span></label>)}</fieldset>)}
              <Button onClick={savePermissions} disabled={saving}>{saving ? "در حال ذخیره..." : "ذخیره دسترسی‌ها"}</Button>
              {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
            </div> : <p className="text-sm text-muted-foreground">نقشی برای نمایش وجود ندارد.</p>}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export default function RolesAndPermissionsPage() {
  function scrollToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 scroll-smooth">
      <div className="mx-auto max-w-6xl space-y-8">
        <nav className="sticky top-16 z-10 flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3 shadow-sm" aria-label="بخش‌های نقش‌ها و دسترسی‌ها">
          <a className="rounded-md px-3 py-2 text-sm text-primary hover:bg-accent" href="#roles-section" onClick={(event) => scrollToSection(event, "roles-section")}>نقش‌ها</a>
          <a className="rounded-md px-3 py-2 text-sm text-primary hover:bg-accent" href="#permissions-section" onClick={(event) => scrollToSection(event, "permissions-section")}>دسترسی‌ها</a>
          <a className="rounded-md px-3 py-2 text-sm text-primary hover:bg-accent" href="#user-permissions-section" onClick={(event) => scrollToSection(event, "user-permissions-section")}>دسترسی کاربران</a>
        </nav>
        <div id="roles-section"><RoleSection /></div>
        <div id="permissions-section"><PermissionsSection /></div>
        <div id="user-permissions-section"><UserPermissionsSection /></div>
      </div>
    </div>
  );
}
