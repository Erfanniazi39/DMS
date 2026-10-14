"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListPagination } from "@/components/ui/list-pagination";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import type { SortValue } from "@/lib/table-sort";
import { apiFetch, type ApiError } from "@/lib/api";
import { roleLabel } from "@/lib/roles";

type Permission = { id: number; code: string; label: string; module: string; roles: string[] };

const SORT_GETTERS: Record<string, (row: Permission) => SortValue> = {
  label: (row) => row.label,
  code: (row) => row.code,
  module: (row) => row.module,
};

export default function PermissionsSection() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Permission[]>("/access/permissions").then(setPermissions).catch((reason: ApiError) => setError(reason.message));
  }, []);

  const table = useClientTable(permissions, SORT_GETTERS, { pageSize: 10 });

  return <section className="scroll-mt-24 space-y-5" aria-labelledby="permissions-heading"><div><h2 id="permissions-heading" className="text-2xl font-semibold">دسترسی‌ها</h2><p className="mt-2 text-sm text-muted-foreground">فهرست کنترل‌شده دسترسی‌های سامانه و نقش‌های دارای هر دسترسی</p></div><Card><CardHeader><CardTitle className="text-base">فهرست دسترسی‌ها</CardTitle></CardHeader><CardContent>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-right text-sm"><thead className="border-b border-border text-muted-foreground"><tr><SortHeader label="عنوان" sortKey="label" sort={table.sort} onSort={table.onSort} className="px-3 py-3 font-medium" /><SortHeader label="کد فنی" sortKey="code" sort={table.sort} onSort={table.onSort} className="px-3 py-3 font-medium" /><SortHeader label="ماژول" sortKey="module" sort={table.sort} onSort={table.onSort} className="px-3 py-3 font-medium" /><th className="px-3 py-3 font-medium">نقش‌ها</th></tr></thead><tbody className="divide-y divide-border">{table.pageRows.map((permission) => <tr key={permission.id}><td className="px-3 py-3">{permission.label}</td><td className="px-3 py-3 font-mono text-xs text-muted-foreground">{permission.code}</td><td className="px-3 py-3">{permission.module}</td><td className="px-3 py-3">{permission.roles.map((role) => roleLabel(role)).join("، ") || "بدون نقش"}</td></tr>)}</tbody></table></div>}{!error ? <ListPagination className="mt-3" page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} /> : null}</CardContent></Card></section>;
}
