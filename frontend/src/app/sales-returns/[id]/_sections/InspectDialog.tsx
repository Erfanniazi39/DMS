"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatQuantity } from "../../shared";
import type { SalesReturnDetail } from "../../shared";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

type Disposition = { restock: string; writeOff: string };

// «بازرسی و تعیین تکلیف» — RECEIVED → INSPECTED (POST :id/inspect,
// sales.approve — the disposition is a judgment call matching who can
// discount, B3). Per line, restockQty + writeOffQty must equal
// receivedQty exactly; every line with receivedQty > 0 defaults to "همه به
// انبار برگردد" (restock = receivedQty, write-off = 0) but both fields stay
// editable. Stock effects RETURN_RESTOCK (QC −r, ON_HAND +r) and/or
// RETURN_WRITE_OFF (QC −w) run server-side.
export function InspectDialog({
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
  const receivedLines = salesReturn.items.filter((line) => Number(line.receivedQty) > 0);
  const [dispositions, setDispositions] = useState<Record<number, Disposition>>({});
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDispositions(Object.fromEntries(receivedLines.map((line) => [line.id, { restock: line.receivedQty, writeOff: "0" }])));
  }

  function closeDialog() {
    if (saving) return;
    onOpenChange(false);
  }

  function setField(lineId: number, field: keyof Disposition, value: string) {
    setDispositions((current) => ({ ...current, [lineId]: { ...current[lineId], [field]: value } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    const items = receivedLines.map((line) => {
      const disposition = dispositions[line.id] ?? { restock: line.receivedQty, writeOff: "0" };
      const restockQty = Number(disposition.restock);
      const writeOffQty = Number(disposition.writeOff);
      if (!Number.isFinite(restockQty) || restockQty < 0 || !Number.isFinite(writeOffQty) || writeOffQty < 0) {
        problems.push(`کالای «${line.itemName}»: مقدار نامعتبر است.`);
      } else if (Math.abs(restockQty + writeOffQty - Number(line.receivedQty)) > 1e-6) {
        problems.push(`کالای «${line.itemName}»: جمع بازگشت به انبار و ضایعات باید برابر مقدار دریافت‌شده (${formatQuantity(line.receivedQty)}) باشد.`);
      }
      return { salesReturnItemId: line.id, restockQty, writeOffQty };
    });
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<SalesReturnDetail>(`/sales-returns/${salesReturn.id}/inspect`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: salesReturn.updatedAt, items }),
      });
      onUpdated(updated);
      pushSuccess("بازرسی و تعیین تکلیف ثبت شد.");
      onOpenChange(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        onOpenChange(false);
      }
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت بازرسی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>بازرسی و تعیین تکلیف مرجوعی</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="return-inspect-form" className="grid gap-3" onSubmit={submit} noValidate>
            <p className="text-sm text-muted-foreground">برای هر ردیف، جمع «بازگشت به انبار» و «ضایعات» باید برابر مقدار دریافت‌شده باشد.</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[36rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="px-2 py-2 font-medium">دریافت‌شده</th>
                    <th className="w-28 px-2 py-2 font-medium">بازگشت به انبار</th>
                    <th className="w-28 px-2 py-2 font-medium">ضایعات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {receivedLines.map((line) => {
                    const disposition = dispositions[line.id] ?? { restock: line.receivedQty, writeOff: "0" };
                    const sum = Number(disposition.restock || 0) + Number(disposition.writeOff || 0);
                    const mismatch = Math.abs(sum - Number(line.receivedQty)) > 1e-6;
                    return (
                      <tr key={line.id} className={mismatch ? "bg-destructive/10" : undefined}>
                        <td className="px-2 py-2">{line.itemName}</td>
                        <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatQuantity(line.receivedQty)}</td>
                        <td className="px-2 py-1.5">
                          <Input aria-label={`بازگشت به انبار ${line.itemName}`} inputMode="decimal" className="h-8 tabular-nums" value={disposition.restock} onChange={(event) => setField(line.id, "restock", event.target.value)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input aria-label={`ضایعات ${line.itemName}`} inputMode="decimal" className="h-8 tabular-nums" value={disposition.writeOff} onChange={(event) => setField(line.id, "writeOff", event.target.value)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="return-inspect-form" disabled={saving || staleRecord}>
            {saving ? "در حال ثبت..." : "ثبت بازرسی"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
