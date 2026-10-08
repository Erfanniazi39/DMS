"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { salesInvoiceTitle, type SalesInvoiceDetail } from "../../shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

// The invoice's action buttons (page header). Same dedicated-action pattern
// as deliveries/[id]/_sections/StatusActions.tsx:
//   DRAFT  → «ثبت فاکتور» (POST :id/post, sales.invoice) — one-way; assigns
//            the INV number and the due date, and adds the quantities to the
//            delivery / order lines' invoiced counters. Plus «حذف»
//            (sales.invoice). There is no draft edit: a wrong draft is
//            deleted and re-created from the delivery.
//   POSTED → nothing but «چاپ» — a posted invoice is immutable.
// The dialog is opened from a button (never from a Select callback). The call
// sends the page's updatedAt; RECORD_MODIFIED disables further actions until
// the page is reloaded.
export function StatusActions({
  invoice,
  onUpdated,
  canInvoice,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  invoice: SalesInvoiceDetail;
  onUpdated: (invoice: SalesInvoiceDetail) => void;
  canInvoice: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const router = useRouter();
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const showDraftActions = canInvoice && invoice.status === "DRAFT";
  const disabled = staleRecord || saving || deleting;

  function closeDialog() {
    if (saving) return;
    setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await apiFetch<SalesInvoiceDetail>(`/sales-invoices/${invoice.id}/post`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: invoice.updatedAt }),
      });
      onUpdated(updated);
      pushSuccess(`فاکتور ${updated.invoiceNumber ?? ""} ثبت شد.`);
      setOpen(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        setOpen(false);
      }
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت فاکتور ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`آیا از حذف «${salesInvoiceTitle(invoice)}» مطمئن هستید؟`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/sales-invoices/${invoice.id}`, { method: "DELETE" });
      router.push("/sales-invoices");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف فاکتور ناموفق بود.");
      setDeleting(false);
    }
  }

  // What «ثبت» will set (display only; the backend computes it).
  const dueDays = invoice.paymentDueDays;
  const dueDate = new Date(new Date(invoice.invoiceDate).getTime() + dueDays * 24 * 60 * 60 * 1000);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showDraftActions ? (
          <>
            <Button variant="success" disabled={disabled} onClick={() => setOpen(true)}>
              ثبت فاکتور
            </Button>
            <Button variant="destructive" disabled={disabled} onClick={() => void remove()}>{deleting ? "در حال حذف..." : "حذف"}</Button>
          </>
        ) : null}
        <Link href={`/sales-invoices/${invoice.id}/print`} className={buttonVariants({ variant: "outline" })}>
          <Printer className="size-4" aria-hidden="true" />
          چاپ
        </Link>
      </div>

      <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ثبت فاکتور فروش</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="invoice-post-form" className="grid gap-3 text-sm" onSubmit={submit} noValidate>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                <dt className="text-muted-foreground">مبلغ کل</dt>
                <dd className="font-medium tabular-nums">{formatMoney(invoice.totalAmount)} ریال</dd>
                <dt className="text-muted-foreground">سررسید</dt>
                <dd>
                  {formatJalali(dueDate)}{" "}
                  <span className="text-xs text-muted-foreground">({dueDays > 0 ? `${dueDays.toLocaleString("fa-IR")} روز پس از تاریخ فاکتور` : "همان روز — نقدی"})</span>
                </dd>
              </dl>
              <p className="text-muted-foreground">
                با ثبت، شمارهٔ فاکتور و سررسید تخصیص می‌یابد و مقدار فاکتورشدهٔ حواله و سفارش به‌روز می‌شود. فاکتور ثبت‌شده قابل ویرایش یا حذف نیست.
              </p>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="invoice-post-form" variant="success" disabled={saving}>
              {saving ? "در حال ثبت..." : "ثبت فاکتور"}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
