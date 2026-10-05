"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney } from "@/lib/format";
import { employeeFullName } from "@/lib/reference-options";
import { purchaseStatusLabels, purchaseStatusTone } from "../../purchases/shared";
import {
  isLinkablePurchaseRequestStatus,
  purchaseRequestPriorityLabels,
  purchaseRequestPriorityTone,
  purchaseRequestStatusLabels,
  purchaseRequestStatusTone,
  type PurchaseRequestDetail,
  type PurchaseRequestStatus,
} from "../shared";

// Why "ثبت خرید" is disabled, per request status (only APPROVED and
// PARTIALLY_PURCHASED allow creating a purchase — see canCreatePurchases).
const createPurchaseBlockedReason: Record<PurchaseRequestStatus, string | undefined> = {
  DRAFT: "ابتدا درخواست را تأیید کنید",
  SUBMITTED: "ابتدا درخواست را تأیید کنید",
  APPROVED: undefined,
  PARTIALLY_PURCHASED: undefined,
  COMPLETED: "همه اقلام این درخواست خریداری شده است",
  REJECTED: "این درخواست رد شده است و نمی‌توان برای آن خرید ثبت کرد",
  CANCELLED: "این درخواست لغو شده است و نمی‌توان برای آن خرید ثبت کرد",
};

// Opens the existing, shared Purchase creation form with this request (and
// the given item(s)) pre-filled — used by the "ثبت خرید"/"ایجاد خرید"/"خرید
// باقی‌مانده" actions below. Deliberately not a separate purchase-creation
// flow: PurchaseForm reads this same ?prefill= param and otherwise behaves
// exactly like a normal new-purchase form.
function buildNewPurchaseUrl(
  purchaseRequestId: number,
  items: { name: string; quantity: number; unitId: number; purchaseRequestItemId: number }[],
) {
  const prefill = { purchaseRequestId, items };
  return `/purchases/new?prefill=${encodeURIComponent(JSON.stringify(prefill))}`;
}

export default function PurchaseRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = Number(params.id);
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("purchases.view") ?? false;
  const canEdit = user?.permissions.includes("purchases.edit") ?? false;
  const canManagePurchases = user?.permissions.includes("purchases.manage") ?? false;

  const [request, setRequest] = useState<PurchaseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);
  // The request changed since this page loaded it (RECORD_MODIFIED on
  // تایید/رد) — the actions stay disabled until the data is reloaded.
  const [staleRecord, setStaleRecord] = useState(false);

  // Shortcut for the same status change already possible from the edit
  // form's "وضعیت" field — PATCH /purchase-requests/:id requires the whole
  // record (items included, see PurchaseRequestsService.update()), so the
  // request's own current values are sent back unchanged apart from status.
  // Shared by both "تایید" (APPROVED) and "رد" (REJECTED) — the only two
  // status changes offered as a one-click shortcut here.
  async function setRequestStatus(status: "APPROVED" | "REJECTED", successMessage: string, errorMessage: string) {
    if (!request) return;
    try {
      const updated = await apiFetch<PurchaseRequestDetail>(`/purchase-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          requestDate: request.requestDate,
          requesterDepartmentId: request.requesterDepartment.id,
          requestedByEmployeeId: request.requestedByEmployee?.id,
          priority: request.priority,
          note: request.note ?? "",
          status,
          // Optimistic locking: the version this page loaded.
          updatedAt: request.updatedAt,
          // Each line's id lets the backend update it in place, keeping
          // any Purchase lines linked to it (PurchaseRequestsService.update()).
          items: request.items.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unitId: item.unit.id,
            requiredDate: item.requiredDate || undefined,
            note: item.note ?? "",
          })),
        }),
      });
      setRequest(updated);
      pushSuccess(successMessage);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") setStaleRecord(true);
      pushError(apiError.message ?? errorMessage);
    }
  }

  async function approveRequest() {
    setApproving(true);
    try {
      await setRequestStatus("APPROVED", "درخواست خرید تأیید شد.", "تأیید درخواست خرید ناموفق بود.");
    } finally {
      setApproving(false);
    }
  }

  async function declineRequest() {
    if (!window.confirm("آیا از رد این درخواست خرید مطمئن هستید؟")) return;
    setDeclining(true);
    try {
      await setRequestStatus("REJECTED", "درخواست خرید رد شد.", "رد درخواست خرید ناموفق بود.");
    } finally {
      setDeclining(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    async function loadRequest() {
      setLoading(true);
      try {
        setRequest(await apiFetch<PurchaseRequestDetail>(`/purchase-requests/${requestId}`));
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات درخواست خرید ناموفق بود.");
      } finally {
        setLoading(false);
      }
    }
    void loadRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, canView]);

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          اجازه دسترسی به درخواست‌های خرید را ندارید.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          درخواست خرید یافت نشد.
        </p>
      </div>
    );
  }

  // The request's own status already reflects whether it's meaningful to
  // buy against it right now — a request that's still a DRAFT/SUBMITTED
  // plan, or already REJECTED/CANCELLED/COMPLETED, doesn't offer these
  // actions. This is a display-only guard: it does not change what the
  // backend accepts (Purchase Request stays an optional, non-blocking layer
  // in front of Purchase either way). Creating a purchase also needs
  // purchases.manage (POST /purchases), so the actions are hidden without it.
  const canCreatePurchases = canManagePurchases && isLinkablePurchaseRequestStatus(request.status);
  const itemsWithRemaining = request.items.filter((item) => item.remainingQuantity > 0);
  // "تایید" is a shortcut for the DRAFT/SUBMITTED → APPROVED step — the same
  // transition the edit form's status field already allows.
  const canApprove = canEdit && (request.status === "DRAFT" || request.status === "SUBMITTED");

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-6">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این درخواست پس از بارگذاری این صفحه توسط کاربر دیگری تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">درخواست خرید {request.requestNumber}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{formatJalali(request.requestDate)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge label={purchaseRequestPriorityLabels[request.priority]} tone={purchaseRequestPriorityTone[request.priority]} />
            <StatusBadge label={purchaseRequestStatusLabels[request.status]} tone={purchaseRequestStatusTone[request.status]} />
            {canApprove ? (
              <Button variant="success" disabled={approving || declining || staleRecord} onClick={() => void approveRequest()}>
                {approving ? "در حال تأیید..." : "تایید"}
              </Button>
            ) : null}
            {canApprove ? (
              <Button variant="destructive" disabled={approving || declining || staleRecord} onClick={() => void declineRequest()}>
                {declining ? "در حال رد کردن..." : "رد"}
              </Button>
            ) : null}
            {canManagePurchases ? (
              <Button
                variant="default"
                disabled={!canCreatePurchases || itemsWithRemaining.length === 0}
                title={
                  !canCreatePurchases
                    ? createPurchaseBlockedReason[request.status]
                    : itemsWithRemaining.length === 0
                      ? "همه اقلام این درخواست خریداری شده است"
                      : undefined
                }
                onClick={() =>
                  router.push(
                    buildNewPurchaseUrl(
                      request.id,
                      itemsWithRemaining.map((item) => ({
                        name: item.name,
                        quantity: item.remainingQuantity,
                        unitId: item.unit.id,
                        purchaseRequestItemId: item.id,
                      })),
                    ),
                  )
                }
              >
                ثبت خرید
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="outline" onClick={() => router.push(`/purchase-requests/${request.id}/edit`)}>
                ویرایش
              </Button>
            ) : null}
          </div>
        </div>

        {/* 1. اطلاعات درخواست */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">اطلاعات درخواست</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">شماره درخواست</dt>
                <dd className="mt-1 font-mono">{request.requestNumber}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تاریخ درخواست</dt>
                <dd className="mt-1">{formatJalali(request.requestDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">دپارتمان درخواست‌کننده</dt>
                <dd className="mt-1">{request.requesterDepartment.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">درخواست‌کننده</dt>
                <dd className="mt-1">{request.requestedByEmployee ? employeeFullName(request.requestedByEmployee) : "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">تاریخ ثبت</dt>
                <dd className="mt-1">{formatJalali(request.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">ثبت‌شده توسط</dt>
                <dd className="mt-1">{request.createdByUser?.username ?? "-"}</dd>
              </div>
              <div className="col-span-2 md:col-span-3">
                <dt className="text-xs text-muted-foreground">یادداشت</dt>
                <dd className="mt-1 whitespace-pre-wrap">{request.note || "-"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* 2. اقلام درخواستی — با مقدار خریداری‌شده/باقی‌مانده، که از روی
            خریدهای مرتبط با هر قلم محاسبه می‌شود (نه یک مقدار ذخیره‌شده). */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">اقلام درخواستی</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Bounded height with its own scroll — a request with many
                items scrolls inside this box instead of stretching the
                whole page, and the header row stays visible (sticky) while
                scrolling it. */}
            <div className="max-h-[26rem] overflow-auto rounded-lg border border-border">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">نام / شرح</th>
                    <th className="px-4 py-2 font-medium">مقدار درخواستی</th>
                    <th className="px-4 py-2 font-medium">مقدار خریداری‌شده</th>
                    <th className="px-4 py-2 font-medium">مقدار باقی‌مانده</th>
                    <th className="px-4 py-2 font-medium">واحد</th>
                    <th className="px-4 py-2 font-medium">تاریخ موردنیاز</th>
                    <th className="px-4 py-2 font-medium">یادداشت</th>
                    <th className="px-4 py-2 font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {request.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2">{item.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatMoney(item.quantity)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatMoney(item.purchasedQuantity)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{formatMoney(item.remainingQuantity)}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.unit.nameFa}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.requiredDate ? formatJalali(item.requiredDate) : "-"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.note || "-"}</td>
                      <td className="px-4 py-2">
                        {item.remainingQuantity <= 0 ? (
                          <span className="text-success" aria-label="این قلم به‌طور کامل خریداری شده است">
                            ✓
                          </span>
                        ) : canCreatePurchases ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              router.push(
                                buildNewPurchaseUrl(request.id, [
                                  { name: item.name, quantity: item.remainingQuantity, unitId: item.unit.id, purchaseRequestItemId: item.id },
                                ]),
                              )
                            }
                          >
                            {item.purchasedQuantity > 0 ? "خرید باقی‌مانده" : "ایجاد خرید"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 3. خریدهای مرتبط — یک درخواست ممکن است هنوز به هیچ خریدی منجر
            نشده باشد، دقیقاً یک خرید داشته باشد، یا (برای خرید تجمیعی/جزئی
            در آینده) بیش از یک خرید داشته باشد. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">خریدهای مرتبط</CardTitle>
          </CardHeader>
          <CardContent>
            {request.purchases.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                هنوز خریدی از این درخواست ثبت نشده است.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[36rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">شماره خرید</th>
                      <th className="px-4 py-2 font-medium">تاریخ خرید</th>
                      <th className="px-4 py-2 font-medium">وضعیت</th>
                      <th className="px-4 py-2 font-medium">مبلغ کل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {request.purchases.map((purchase) => (
                      <tr key={purchase.id} className="cursor-pointer hover:bg-muted/30" onClick={() => router.push(`/purchases/${purchase.id}`)}>
                        <td className="px-4 py-2 font-mono text-xs">
                          <Link href={`/purchases/${purchase.id}`} className="text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
                            {purchase.purchaseNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{formatJalali(purchase.purchaseDate)}</td>
                        <td className="px-4 py-2">
                          <StatusBadge label={purchaseStatusLabels[purchase.status]} tone={purchaseStatusTone[purchase.status]} />
                        </td>
                        <td className="px-4 py-2">{formatMoney(purchase.totalAmount)} ریال</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
