"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { SnapshotView } from "@/components/admin/snapshot-view";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { ENTITY_LABELS, entityLabel, formatDateTime } from "@/lib/audit-labels";
import { useHasPermission } from "@/lib/session";

type DeletedRow = {
  id: number;
  entityType: string;
  entityId: number;
  label: string | null;
  deletedAt: string;
  expiresAt: string;
  restoredAt: string | null;
  restorable: boolean;
  deletedBy: { id: number; username: string } | null;
  restoredBy: { id: number; username: string } | null;
};
type DeletedDetail = DeletedRow & { snapshot: unknown };
type RestoreCheck = { restorable: boolean; reason: string | null };
type RestoreOutcome = { entityType: string; entityId: number; warnings: string[] };

const PAGE_SIZE = 20;
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const TYPE_OPTIONS = { ...ENTITY_LABELS, PurchaseReturn: "برگشت خرید" };

// Where the restored record can be opened. The id is the restored record's own
// (a restored purchase return opens its purchase).
function recordHref(entityType: string, id: number): string | null {
  switch (entityType) {
    case "Purchase":
    case "PurchaseReturn":
      return `/purchases/${id}`;
    case "SalesOrder":
      return `/sales-orders/${id}`;
    case "Customer":
      return `/customers/${id}`;
    case "Unit":
      return "/units";
    case "ItemCategory":
      return "/item-categories";
    case "Item":
      return "/items";
    case "Department":
      return "/departments";
    case "Supplier":
      return `/suppliers/${id}`;
    case "Delivery":
      return `/deliveries/${id}`;
    case "SalesInvoice":
      return `/sales-invoices/${id}`;
    case "GoodsReceipt":
      return `/inventory/receipts/${id}`;
    case "ProductionOutput":
      return `/inventory/production/${id}`;
    case "StockAdjustment":
      return `/inventory/adjustments/${id}`;
    case "StockCount":
      return `/inventory/counts/${id}`;
    case "Role":
      return "/admin/roles";
    default:
      return null;
  }
}

function daysLeft(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function DeletedRecordsContent() {
  const searchParams = useSearchParams();
  const canRestore = useHasPermission("records.restore");
  const entityId = searchParams.get("entityId") ?? "";
  const initialType = searchParams.get("entityType") ?? "";
  const [entityType, setEntityType] = useState(initialType);
  const [q, setQ] = useState("");
  const [restored, setRestored] = useState("");
  const [applied, setApplied] = useState({ entityType: initialType, q: "", restored: "" });
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<Paginated<DeletedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeletedDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [check, setCheck] = useState<RestoreCheck | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (applied.entityType) query.set("entityType", applied.entityType);
    if (applied.q) query.set("q", applied.q);
    if (applied.restored) query.set("restored", applied.restored);
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
  }, [applied, page, entityId, reloadKey]);

  function openDetail(id: number) {
    setDetailError(null);
    setCheck(null);
    setRestoreError(null);
    apiFetch<DeletedDetail>(`/audit/deleted-records/${id}`)
      .then((row) => {
        setDetail(row);
        if (canRestore && row.restorable) {
          apiFetch<RestoreCheck>(`/audit/deleted-records/${id}/restore-check`)
            .then(setCheck)
            .catch((err: ApiError) => setCheck({ restorable: false, reason: err.message ?? "بررسی امکان بازیابی ناموفق بود." }));
        }
      })
      .catch((err: ApiError) => setDetailError(err.message ?? "دریافت سند ناموفق بود."));
  }

  function closeDetail() {
    setDetail(null);
    setDetailError(null);
    setCheck(null);
    setConfirming(false);
    setRestoreError(null);
  }

  async function restore() {
    if (!detail) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const result = await apiFetch<RestoreOutcome>(`/audit/deleted-records/${detail.id}/restore`, { method: "POST" });
      setOutcome(result);
      closeDetail();
      setReloadKey((current) => current + 1);
    } catch (err) {
      setRestoreError((err as ApiError).message ?? "بازیابی ناموفق بود.");
      setConfirming(false);
    } finally {
      setRestoring(false);
    }
  }

  const outcomeHref = outcome ? recordHref(outcome.entityType, outcome.entityId) : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">سندهای حذف‌شده</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            نسخهٔ ذخیره‌شده از اسنادی که حذف شده‌اند. تا پایان مهلت نگهداری (پیش‌فرض ۹۰ روز) می‌توان آن‌ها را مشاهده و در صورت امکان بازیابی کرد؛ پس از آن به‌طور خودکار پاک می‌شوند. اسنادی که پیش از فعال‌شدن این بخش حذف شده‌اند در اینجا نیستند.
          </p>
        </div>

        {outcome ? (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm" role="status">
            <p className="font-medium">«{entityLabel(outcome.entityType) || outcome.entityType}» با موفقیت بازیابی شد.</p>
            {outcome.warnings.map((warning) => <p key={warning} className="mt-1 text-muted-foreground">{warning}</p>)}
            <div className="mt-2 flex gap-3">
              {outcomeHref ? <Link className="text-primary hover:underline" href={outcomeHref}>مشاهدهٔ سند بازیابی‌شده</Link> : null}
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setOutcome(null)}>بستن</button>
            </div>
          </div>
        ) : null}

        <Card>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[14rem_12rem_minmax(0,1fr)_auto]">
              <select className={selectClass} value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="نوع سند">
                <option value="">همهٔ انواع</option>
                {Object.entries(TYPE_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select className={selectClass} value={restored} onChange={(e) => setRestored(e.target.value)} aria-label="وضعیت بازیابی">
                <option value="">همهٔ وضعیت‌ها</option>
                <option value="false">بازیابی‌نشده</option>
                <option value="true">بازیابی‌شده</option>
              </select>
              <input className="h-9 rounded-lg border border-input bg-background px-3 text-sm" placeholder="جستجو در شماره یا عنوان سند" value={q} onChange={(e) => setQ(e.target.value)} />
              <Button size="sm" onClick={() => { setLoading(true); setApplied({ entityType, q: q.trim(), restored }); setPage(1); }}>اعمال</Button>
            </div>
            {entityId ? <p className="text-xs text-muted-foreground">فقط سند شمارهٔ داخلی {entityId} نمایش داده می‌شود. <a className="text-primary hover:underline" href="/admin/deleted-records">نمایش همه</a></p> : null}
            {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">{error}</div> : null}
            {!error && data && data.items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">سند حذف‌شده‌ای یافت نشد.</p> : null}
            {!error && data && data.items.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[46rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">نوع</th>
                      <th className="px-3 py-2 font-medium">شماره / عنوان</th>
                      <th className="px-3 py-2 font-medium">حذف‌کننده</th>
                      <th className="px-3 py-2 font-medium">زمان حذف</th>
                      <th className="px-3 py-2 font-medium">مهلت باقی‌مانده</th>
                      <th className="px-3 py-2 font-medium">وضعیت</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">{TYPE_OPTIONS[row.entityType as keyof typeof TYPE_OPTIONS] ?? row.entityType}</td>
                        <td className="px-3 py-2">{row.label ?? `#${row.entityId}`}</td>
                        <td className="px-3 py-2" dir="ltr">{row.deletedBy?.username ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(row.deletedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{daysLeft(row.expiresAt).toLocaleString("fa-IR")} روز</td>
                        <td className="px-3 py-2">
                          {row.restoredAt ? (
                            <span className="text-xs text-muted-foreground">بازیابی‌شده{row.restoredBy ? ` توسط ${row.restoredBy.username}` : ""}</span>
                          ) : row.restorable ? (
                            <span className="text-xs">قابل بازیابی</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">فقط مشاهده</span>
                          )}
                        </td>
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

      <Dialog open={detail !== null || detailError !== null} onOpenChange={(open) => { if (!open && !restoring) closeDetail(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail ? `${TYPE_OPTIONS[detail.entityType as keyof typeof TYPE_OPTIONS] ?? detail.entityType} ${detail.label ?? ""}` : "سند حذف‌شده"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailError ? <p className="text-sm text-destructive" role="alert">{detailError}</p> : null}
            {detail ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  حذف‌شده توسط {detail.deletedBy?.username ?? "نامشخص"} در {formatDateTime(detail.deletedAt)}. نسخهٔ ذخیره‌شده کامل است؛ اطلاعات حساس (مثل کد ملی و شمارهٔ حساب) فقط در نمایش پوشانده می‌شود و در بازیابی کامل بازمی‌گردد.
                </p>
                {detail.restoredAt ? (
                  <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">این سند در {formatDateTime(detail.restoredAt)} بازیابی شده است.</p>
                ) : canRestore && detail.restorable ? (
                  check === null ? (
                    <p className="text-sm text-muted-foreground">در حال بررسی امکان بازیابی...</p>
                  ) : check.restorable ? (
                    <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">این سند هم‌اکنون قابل بازیابی است.</p>
                  ) : (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">بازیابی ممکن نیست: {check.reason}</p>
                  )
                ) : !detail.restorable ? (
                  <p className="text-sm text-muted-foreground">بازیابی این نوع سند پشتیبانی نمی‌شود؛ فقط مشاهده ممکن است.</p>
                ) : null}
                {restoreError ? <p className="text-sm text-destructive" role="alert">{restoreError}</p> : null}
                <SnapshotView snapshot={detail.snapshot} />
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">نمایش دادهٔ خام (JSON)</summary>
                  <pre dir="ltr" className="mt-2 max-h-[40vh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-left">{JSON.stringify(detail.snapshot, null, 2)}</pre>
                </details>
              </div>
            ) : null}
          </DialogBody>
          {detail && canRestore && detail.restorable && !detail.restoredAt ? (
            <DialogFooter>
              <Button disabled={!check?.restorable || restoring} onClick={() => setConfirming(true)}>
                <RotateCcw /> بازیابی
              </Button>
              <Button variant="outline" onClick={closeDetail} disabled={restoring}>بستن</Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={(open) => { if (!open && !restoring) setConfirming(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بازیابی سند</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-sm">
              «{detail?.label ?? ""}» با همان شماره و تمام اطلاعات ذخیره‌شده (شامل اقلام، شناسه‌ها و شمارهٔ حساب‌ها) دوباره ساخته می‌شود. این کار در گزارش فعالیت‌ها ثبت می‌شود و هر سند را فقط یک بار می‌توان بازیابی کرد.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button disabled={restoring} onClick={() => void restore()}>{restoring ? "در حال بازیابی..." : "بازیابی"}</Button>
            <Button variant="outline" disabled={restoring} onClick={() => setConfirming(false)}>انصراف</Button>
          </DialogFooter>
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
