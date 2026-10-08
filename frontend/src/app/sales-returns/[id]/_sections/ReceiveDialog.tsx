"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatQuantity } from "../../shared";
import type { SalesReturnDetail } from "../../shared";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

// «دریافت کالا» — APPROVED → RECEIVED (POST :id/receive, sales.deliver).
// Every line defaults to its full requestedQty (the common case: everything
// claimed actually arrived) but stays editable — the warehouse may receive
// less (build plan §4.2's receivedQty is a distinct column from
// requestedQty for exactly this). Stock effect RETURN_RECEIPT (QC +q) runs
// server-side.
export function ReceiveDialog({
  open,
  onOpenChange,
  salesReturn,
  onUpdated,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesReturn: SalesReturnDetail;
  onUpdated: (salesReturn: SalesReturnDetail) => void;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuantities(Object.fromEntries(salesReturn.items.map((line) => [line.id, line.requestedQty])));
  }

  function closeDialog() {
    if (saving) return;
    onOpenChange(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = salesReturn.items.map((line) => ({ salesReturnItemId: line.id, receivedQty: Number(quantities[line.id] ?? line.requestedQty) }));
    for (const item of items) {
      if (!Number.isFinite(item.receivedQty) || item.receivedQty < 0) {
        pushError("مقدار دریافت‌شده نامعتبر است.");
        return;
      }
    }
    setSaving(true);
    try {
      const updated = await apiFetch<SalesReturnDetail>(`/sales-returns/${salesReturn.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: salesReturn.updatedAt, items }),
      });
      onUpdated(updated);
      pushSuccess("دریافت کالا ثبت شد.");
      onOpenChange(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        onOpenChange(false);
      }
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت دریافت کالا ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>دریافت کالای مرجوعی</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="return-receive-form" className="grid gap-3" onSubmit={submit} noValidate>
            <p className="text-sm text-muted-foreground">مقدار واقعاً دریافت‌شدهٔ هر ردیف را تأیید یا اصلاح کنید؛ موجودی «در انتظار کنترل کیفیت» به همین میزان افزایش می‌یابد.</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[32rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="px-2 py-2 font-medium">درخواستی</th>
                    <th className="w-32 px-2 py-2 font-medium">دریافت‌شده</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {salesReturn.items.map((line) => (
                    <tr key={line.id}>
                      <td className="px-2 py-2">{line.itemName}</td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(line.requestedQty)}</td>
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={`مقدار دریافت‌شدهٔ ${line.itemName}`}
                          inputMode="decimal"
                          className="h-8 tabular-nums"
                          value={quantities[line.id] ?? line.requestedQty}
                          onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="return-receive-form" disabled={saving || staleRecord}>
            {saving ? "در حال ثبت..." : "ثبت دریافت"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
