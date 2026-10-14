"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { ENTITY_LABELS, entityLabel, formatDateTime } from "@/lib/audit-labels";

type DeletedRow = {
  id: number;
  entityType: string;
  entityId: number;
  label: string | null;
  deletedAt: string;
  expiresAt: string;
  deletedBy: { id: number; username: string } | null;
};
type DeletedDetail = DeletedRow & { snapshot: unknown };

const PAGE_SIZE = 20;
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

function DeletedRecordsContent() {
  const searchParams = useSearchParams();
  const entityId = searchParams.get("entityId") ?? "";
  const [entityType, setEntityType] = useState(searchParams.get("entityType") ?? "");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ entityType: searchParams.get("entityType") ?? "", q: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<DeletedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeletedDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (applied.entityType) query.set("entityType", applied.entityType);
    if (applied.q) query.set("q", applied.q);
    if (entityId) query.set("entityId", entityId);
    let active = true;
    apiFetch<Paginated<DeletedRow>>(`/audit/deleted-records?${query}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((err: ApiError) => active && setError(err.message ?? "دریافت فهرست ناموفق بود."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [applied, page, entityId]);

  function openDetail(id: number) {
    setDetailError(null);
    apiFetch<DeletedDetail>(`/audit/deleted-records/${id}`)
      .then(setDetail)
      .catch((err: ApiError) => setDetailError(err.message ?? "دریافت سند ناموفق بود."));
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">سندهای حذف‌شده</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            نسخهٔ ذخیره‌شده از اسنادی که حذف شده‌اند. این فهرست فقط برای مشاهده است و پس از پایان مهلت نگهداری (پیش‌فرض ۹۰ روز) به‌طور خودکار پاک می‌شود. اسنادی که پیش از فعال‌شدن این بخش حذف شده‌اند در اینجا نیستند.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)_auto]">
              <select className={selectClass} value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="نوع سند">
                <option value="">همهٔ انواع</option>
                {Object.entries(ENTITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                <option value="PurchaseReturn">برگشت خرید</option>
              </select>
              <input className="h-9 rounded-lg border border-input bg-background px-3 text-sm" placeholder="جستجو در شمارهٔ سند" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button size="sm" onClick={() => { setLoading(true); setApplied({ entityType, q: q.trim() }); setPage(1); }}>اعمال</Button>
            </div>
            {entityId ? <p className="text-xs text-muted-foreground">فقط سند شمارهٔ داخلی {entityId} نمایش داده می‌شود. <a className="text-primary hover:underline" href="/admin/deleted-records">نمایش همه</a></p> : null}
            {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
            {!error && data && data.items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">سند حذف‌شده‌ای یافت نشد.</p> : null}
            {!error && data && data.items.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[40rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">نوع</th>
                      <th className="px-3 py-2 font-medium">شماره / عنوان</th>
                      <th className="px-3 py-2 font-medium">حذف‌کننده</th>
                      <th className="px-3 py-2 font-medium">زمان حذف</th>
                      <th className="px-3 py-2 font-medium">نگهداری تا</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{entityLabel(row.entityType) || row.entityType}</td>
                        <td className="px-3 py-2">{row.label ?? `#${row.entityId}`}</td>
                        <td className="px-3 py-2" dir="ltr">{row.deletedBy?.username ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(row.deletedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(row.expiresAt)}</td>
                        <td className="px-3 py-2"><Button variant="link" size="sm" onClick={() => openDetail(row.id)}>مشاهده</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {!data && loading ? <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p> : null}
            {data ? <ListPagination page={page} pageSize={PAGE_SIZE} total={data.total} loading={loading} onPageChange={(next) => { setLoading(true); setPage(next); }} /> : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detail !== null || detailError !== null} onOpenChange={(open) => { if (!open) { setDetail(null); setDetailError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail ? `${entityLabel(detail.entityType) || detail.entityType} ${detail.label ?? ""}` : "سند حذف‌شده"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailError ? <p className="text-sm text-destructive" role="alert">{detailError}</p> : null}
            {detail ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">حذف‌شده توسط {detail.deletedBy?.username ?? "نامشخص"} در {formatDateTime(detail.deletedAt)}. اطلاعات حساس (مثل کد ملی) پوشانده شده است.</p>
                <pre dir="ltr" className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-left text-xs">{JSON.stringify(detail.snapshot, null, 2)}</pre>
              </div>
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DeletedRecordsPage() {
  return (
    <RequirePermission permission="users.create" message="شما اجازه مشاهده سندهای حذف‌شده را ندارید.">
      <Suspense fallback={null}>
        <DeletedRecordsContent />
      </Suspense>
    </RequirePermission>
  );
}
