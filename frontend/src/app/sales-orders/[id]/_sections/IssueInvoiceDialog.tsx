"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatJalali, JALALI_MAX_YEAR } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { deliveryTitle } from "../../../deliveries/shared";
import type { SalesInvoiceDetail, SalesInvoiceQueueRow } from "../../../sales-invoices/shared";
import type { SectionToasts } from "../../../receipts/RecordReceiptDialog";

// «صدور فاکتور» from the order page: picks one of THIS order's posted
// deliveries that no posted invoice covers yet (GET /sales-invoices/queue,
// narrowed to the order), creates the invoice draft (POST /sales-invoices)
// and — by default — posts it in the same action (POST :id/post), so the
// user doesn't have to open the invoice page. A delivery that already has a
// draft is posted instead of re-created (B7: one invoice per delivery).
export function IssueInvoiceDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  onDone,
  toasts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderNumber: string | null;
  onDone: () => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [rows, setRows] = useState<SalesInvoiceQueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [deliveryId, setDeliveryId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [postNow, setPostNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRows([]);
      setDeliveryId("");
      setInvoiceDate("");
      setPostNow(true);
      setLoading(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    apiFetch<SalesInvoiceQueueRow[]>(`/sales-invoices/queue${orderNumber ? `?q=${encodeURIComponent(orderNumber)}` : ""}`)
      .then((data) => {
        if (ignore) return;
        const mine = data.filter((row) => row.salesOrderId === orderId);
        setRows(mine);
        if (mine.length > 0) setDeliveryId(String(mine[0].id));
      })
      .catch((reason: unknown) => {
        if (!ignore) pushError((reason as ApiError).message ?? "دریافت حواله‌های بدون فاکتور ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, orderNumber]);

  const selected = rows.find((row) => String(row.id) === deliveryId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      pushError("حواله را انتخاب کنید.");
      return;
    }
    if (invoiceDate && invoiceDate < selected.deliveryDate.slice(0, 10)) {
      pushError("تاریخ فاکتور نمی‌تواند پیش از تاریخ تحویل باشد.");
      return;
    }
    setSaving(true);
    try {
      let invoice: SalesInvoiceDetail;
      if (selected.draftInvoiceId) {
        invoice = await apiFetch<SalesInvoiceDetail>(`/sales-invoices/${selected.draftInvoiceId}`);
      } else {
        invoice = await apiFetch<SalesInvoiceDetail>("/sales-invoices", {
          method: "POST",
          body: JSON.stringify({ deliveryId: selected.id, invoiceDate: invoiceDate || undefined }),
        });
      }
      if (postNow) {
        try {
          const posted = await apiFetch<SalesInvoiceDetail>(`/sales-invoices/${invoice.id}/post`, { method: "POST", body: JSON.stringify({ updatedAt: invoice.updatedAt }) });
          pushSuccess(`فاکتور ${posted.invoiceNumber ?? ""} صادر و ثبت شد.`);
        } catch (postReason) {
          pushError(`پیش‌نویس فاکتور ساخته شد، اما ثبت آن ناموفق بود: ${(postReason as ApiError).message ?? "خطای نامشخص"}`);
        }
      } else {
        pushSuccess("پیش‌نویس فاکتور ساخته شد.");
      }
      onDone();
      onOpenChange(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "صدور فاکتور ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen || saving ? undefined : onOpenChange(false))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>صدور فاکتور</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">در حال دریافت حواله‌ها...</p>
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              حواله‌ٔ ثبت‌شده‌ای که فاکتور نشده باشد برای این سفارش وجود ندارد. ابتدا یک حواله ثبت کنید.
            </p>
          ) : (
            <form id="issue-invoice-form" className="grid gap-4" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="issue-invoice-delivery">حواله تحویل<RequiredMark /></Label>
                <select id="issue-invoice-delivery" className={selectClass} value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)}>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {deliveryTitle(row)} — {formatJalali(row.deliveryDate)}{row.draftInvoiceId ? " (پیش‌نویس فاکتور دارد)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {selected && !selected.draftInvoiceId ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="issue-invoice-date-year">تاریخ فاکتور</Label>
                  <JalaliDateInput idPrefix="issue-invoice-date" value={invoiceDate} minDate={selected.deliveryDate.slice(0, 10)} maxYear={JALALI_MAX_YEAR} onChange={setInvoiceDate} />
                  <p className="text-xs text-muted-foreground">خالی بگذارید تا امروز (یا تاریخ تحویل، اگر دیرتر است) ثبت شود.</p>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={postNow} onChange={(event) => setPostNow(event.target.checked)} />
                ثبت نهایی فاکتور بلافاصله (شماره و سررسید صادر می‌شود)
              </label>
            </form>
          )}
        </DialogBody>
        <DialogFooter>
          {rows.length > 0 ? (
            <Button type="submit" form="issue-invoice-form" disabled={saving}>
              {saving ? "در حال صدور..." : "صدور فاکتور"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
