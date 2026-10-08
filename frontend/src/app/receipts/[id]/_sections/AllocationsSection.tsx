"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import { FormSection } from "../../../sales-orders/_form/FormSection";
import { unappliedAmount, type AllocationSuggestion, type CustomerPaymentDetail, type OpenInvoiceRow } from "../../shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

type AllocationLine = { invoiceId: number; invoiceNumber: string | null; dueDate: string | null; openAmount: string; amount: string };

// «تخصیص‌ها» — every PaymentAllocation this payment has ever been the
// source of (active and reversed, oldest first — backend already orders
// them that way). «افزودن تخصیص» opens the same oldest-first-suggestion
// grid as the record-receipt dialog, scoped to this payment's remaining
// unapplied amount. «برگشت» on an active row calls POST
// /receivables/allocations/:id/reverse (stamped, never deleted).
export function AllocationsSection({
  payment,
  canManage,
  onChanged,
  toasts,
}: {
  payment: CustomerPaymentDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [lines, setLines] = useState<AllocationLine[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reversingId, setReversingId] = useState<number | null>(null);

  const unapplied = unappliedAmount(payment);
  const canAllocate = canManage && payment.direction === "RECEIPT" && payment.status !== "CANCELLED" && unapplied > 0;

  // Same render-phase reset as RecordReceiptDialog — avoids a synchronous
  // setState as the first statement of the fetch effect below.
  const [wasDialogOpen, setWasDialogOpen] = useState(dialogOpen);
  if (dialogOpen !== wasDialogOpen) {
    setWasDialogOpen(dialogOpen);
    if (dialogOpen) setLoadingInvoices(true);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    Promise.all([
      apiFetch<OpenInvoiceRow[]>(`/receivables/customers/${payment.customerId}/open-invoices`),
      apiFetch<AllocationSuggestion>(`/receivables/allocations/suggest?customerId=${payment.customerId}&amount=${unapplied}`),
    ])
      .then(([open, suggestion]) => {
        setOpenInvoices(open);
        const suggested = new Map(suggestion.items.map((item) => [item.invoiceId, item.amount]));
        setLines(open.map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, dueDate: invoice.dueDate, openAmount: invoice.openAmount, amount: suggested.get(invoice.id) ?? "0" })));
      })
      .catch((reason) => pushError((reason as ApiError).message ?? "دریافت فاکتورهای باز ناموفق بود."))
      .finally(() => setLoadingInvoices(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen]);

  function setLineAmount(invoiceId: number, value: string) {
    setLines((current) => current.map((line) => (line.invoiceId === invoiceId ? { ...line, amount: value } : line)));
  }

  const requestedTotal = lines.reduce((sum, line) => sum + (parseNumberInput(line.amount) || 0), 0);

  async function submitAllocation() {
    const items = lines.filter((line) => (parseNumberInput(line.amount) || 0) > 0).map((line) => ({ invoiceId: line.invoiceId, amount: parseNumberInput(line.amount) }));
    if (items.length === 0) {
      pushError("حداقل یک مبلغ تخصیص وارد کنید.");
      return;
    }
    if (requestedTotal > unapplied) {
      pushError("جمع تخصیص‌ها از مانده تخصیص‌نیافتهٔ این دریافت بیشتر است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/receivables/allocations", { method: "POST", body: JSON.stringify({ sourcePaymentId: payment.id, items }) });
      pushSuccess(`به ${items.length.toLocaleString("fa-IR")} فاکتور تخصیص یافت.`);
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت تخصیص ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function reverseAllocation(allocationId: number) {
    if (!window.confirm("آیا از برگشت این تخصیص مطمئن هستید؟")) return;
    setReversingId(allocationId);
    try {
      await apiFetch(`/receivables/allocations/${allocationId}/reverse`, { method: "POST", body: JSON.stringify({}) });
      pushSuccess("تخصیص برگشت خورد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "برگشت تخصیص ناموفق بود.");
    } finally {
      setReversingId(null);
    }
  }

  return (
    <>
      <FormSection
        title="تخصیص‌ها"
        description={`تخصیص‌یافته: ${formatMoney(Number(payment.amount) - unapplied)} ریال — تخصیص‌نیافته: ${formatMoney(unapplied)} ریال`}
        action={canAllocate ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            افزودن تخصیص
          </Button>
        ) : undefined}
      >
        {payment.allocationsAsSource.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز تخصیصی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">فاکتور</th>
                  <th className="px-3 py-2 font-medium">مبلغ</th>
                  <th className="px-3 py-2 font-medium">تاریخ تخصیص</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                  <th className="px-3 py-2 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payment.allocationsAsSource.map((allocation) => {
                  const active = allocation.reversedAt === null;
                  return (
                    <tr key={allocation.id} className={active ? undefined : "text-muted-foreground"}>
                      <td className="px-3 py-2 font-mono text-xs">
                        {allocation.targetInvoice ? (
                          <Link href={`/sales-invoices/${allocation.targetInvoice.id}`} className="text-primary hover:underline">
                            {allocation.targetInvoice.invoiceNumber ?? `#${allocation.targetInvoice.id}`}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(allocation.amount)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatJalali(allocation.allocatedAt)}</td>
                      <td className="px-3 py-2">{active ? "فعال" : `برگشت‌خورده${allocation.reversedByUser ? ` — ${allocation.reversedByUser.username}` : ""}`}</td>
                      <td className="px-3 py-2">
                        {active && canManage ? (
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={reversingId !== null} onClick={() => void reverseAllocation(allocation.id)}>
                            {reversingId === allocation.id ? "در حال برگشت..." : "برگشت"}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => !saving && setDialogOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>افزودن تخصیص</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {loadingInvoices ? (
              <p className="py-6 text-center text-sm text-muted-foreground">در حال دریافت فاکتورهای باز...</p>
            ) : openInvoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">این مشتری فاکتور بازی ندارد.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/20 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">شماره فاکتور</th>
                      <th className="px-3 py-2 font-medium">سررسید</th>
                      <th className="px-3 py-2 font-medium">مانده فاکتور</th>
                      <th className="px-3 py-2 font-medium">مبلغ تخصیص</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((line) => (
                      <tr key={line.invoiceId}>
                        <td className="px-3 py-2 font-mono text-xs">{line.invoiceNumber ?? `#${line.invoiceId}`}</td>
                        <td className="px-3 py-2 text-muted-foreground">{line.dueDate ? formatJalali(line.dueDate) : "-"}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(line.openAmount)}</td>
                        <td className="px-3 py-2">
                          <Input className="h-7 w-28" inputMode="decimal" value={line.amount} onChange={(event) => setLineAmount(line.invoiceId, event.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              تخصیص‌یافته در این فرم: {formatMoney(requestedTotal)} ریال از {formatMoney(unapplied)} ریال تخصیص‌نیافته
            </p>
          </DialogBody>
          <DialogFooter>
            <Button disabled={saving || loadingInvoices} onClick={() => void submitAllocation()}>
              {saving ? "در حال ثبت..." : "ثبت تخصیص"}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
