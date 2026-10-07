"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  CUSTOMER_STATUSES,
  REASON_REQUIRED_STATUSES,
  RequiredMark,
  StatusBadge,
  customerKindLabels,
  customerStatusLabels,
  customerStatusTone,
  pinnedWarnings,
  primaryContact,
  textareaClass,
  type CustomerDetail,
  type CustomerStatus,
} from "../../shared";
import type { SectionToasts } from "./DetailSection";

// The detail page header: number, name, status badge, group, primary
// contact, pinned WARNING notes and credit hold, plus the status buttons —
// the only way a customer's status changes (PATCH /customers/:id/status,
// same pattern as purchases/[id]/_sections/StatusActions.tsx). The backend
// is authoritative: legal moves (customer-rules.ts — currently any move to a
// different status), a reason for SUSPENDED/ARCHIVED, customers.archive for
// moving into or out of ARCHIVED, and optimistic locking.
//
// Each button opens a small Dialog (opened from a button, not from a Select
// callback — so the RequestPicker landmine does not apply) where the
// reason is entered.

const statusActionLabel: Record<CustomerStatus, string> = {
  ACTIVE: "فعال‌سازی",
  INACTIVE: "غیرفعال‌سازی",
  SUSPENDED: "تعلیق",
  ARCHIVED: "بایگانی",
};

const statusActionVariant: Record<CustomerStatus, "success" | "outline" | "destructive"> = {
  ACTIVE: "success",
  INACTIVE: "outline",
  SUSPENDED: "outline",
  ARCHIVED: "destructive",
};

export function StatusActions({
  customer,
  setCustomer,
  canManage,
  canArchive,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  customer: CustomerDetail;
  setCustomer: (customer: CustomerDetail) => void;
  canManage: boolean;
  canArchive: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const router = useRouter();
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [target, setTarget] = useState<CustomerStatus | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Mirrors backend ALLOWED_CUSTOMER_STATUS_TRANSITIONS (every other status)
  // and the customers.archive gate.
  const targets = canManage
    ? CUSTOMER_STATUSES.filter((status) => status !== customer.status).filter(
        (status) => canArchive || (status !== "ARCHIVED" && customer.status !== "ARCHIVED"),
      )
    : [];
  const reasonRequired = target !== null && REASON_REQUIRED_STATUSES.includes(target);
  const hasChildren =
    customer.contacts.length + customer.addresses.length + customer.notes.length + customer.documents.length + customer.complaints.length > 0;
  const contact = primaryContact(customer);
  const warnings = pinnedWarnings(customer);

  function openDialog(status: CustomerStatus) {
    setTarget(status);
    setReason("");
  }

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    if (reasonRequired && !reason.trim()) {
      pushError("برای تعلیق یا بایگانی مشتری، ذکر دلیل الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<CustomerDetail>(`/customers/${customer.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: target, reason: reason.trim(), updatedAt: customer.updatedAt }),
      });
      setCustomer(updated);
      pushSuccess(`وضعیت مشتری به «${customerStatusLabels[target]}» تغییر کرد.`);
      setTarget(null);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setTarget(null);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "تغییر وضعیت مشتری ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCustomer() {
    if (!window.confirm(`آیا از حذف مشتری «${customer.name}» (${customer.customerNumber}) مطمئن هستید؟`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/customers/${customer.id}`, { method: "DELETE" });
      router.push("/customers");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف مشتری ناموفق بود.");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{customer.name}</h1>
            <span className="font-mono text-sm text-muted-foreground">{customer.customerNumber}</span>
            <StatusBadge label={customerStatusLabels[customer.status]} tone={customerStatusTone[customer.status]} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span>{customerKindLabels[customer.customerKind]}</span>
            <span>گروه: {customer.customerGroup.nameFa}</span>
            {contact ? (
              <span>
                مخاطب اصلی: {contact.name}
                {contact.mobile || contact.phone ? <span dir="ltr" className="ms-1 tabular-nums">({contact.mobile || contact.phone})</span> : null}
              </span>
            ) : null}
          </p>
          {customer.statusReason && customer.status !== "ACTIVE" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              دلیل وضعیت: {customer.statusReason}
              {customer.statusChangedAt ? ` — ${formatJalali(customer.statusChangedAt)}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {targets.map((status) => (
            <Button key={status} size="sm" variant={statusActionVariant[status]} disabled={staleRecord || saving} onClick={() => openDialog(status)}>
              {customer.status === "ARCHIVED" && status === "ACTIVE" ? "خروج از بایگانی" : statusActionLabel[status]}
            </Button>
          ))}
          {canManage ? (
            <Button size="sm" variant="outline" disabled={staleRecord} onClick={() => router.push(`/customers/${customer.id}/edit`)}>
              ویرایش
            </Button>
          ) : null}
          {/* Delete only exists for a customer with no history at all
              (backend CustomersService.remove()); otherwise archive. */}
          {canManage && !hasChildren ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleting}
              onClick={() => void deleteCustomer()}
            >
              حذف
            </Button>
          ) : null}
        </div>
      </div>

      {customer.financialSummary.creditHold || warnings.length > 0 ? (
        <div className="space-y-1.5">
          {customer.financialSummary.creditHold ? (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <Ban className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>این مشتری در توقف اعتباری است.</span>
            </div>
          ) : null}
          {warnings.map((note) => (
            <div key={note.id} role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <Pin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="whitespace-pre-wrap">{note.body}</span>
            </div>
          ))}
        </div>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{target ? `تغییر وضعیت به «${customerStatusLabels[target]}»` : ""}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="customer-status-form" className="grid gap-3" onSubmit={submitStatus} noValidate>
              <p className="text-sm text-muted-foreground">
                وضعیت فعلی: {customerStatusLabels[customer.status]}
              </p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-status-reason">دلیل{reasonRequired ? <RequiredMark /> : null}</Label>
                <textarea
                  id="customer-status-reason"
                  className={textareaClass}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={reasonRequired ? "دلیل تعلیق/بایگانی را بنویسید" : "اختیاری"}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="customer-status-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : "تأیید تغییر وضعیت"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setTarget(null)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
