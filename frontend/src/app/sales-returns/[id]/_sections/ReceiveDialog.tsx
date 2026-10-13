"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatJalali, toJalali } from "@/lib/jalali";
import { formatQuantity } from "../../shared";
import type { SalesReturnDetail } from "../../shared";

export type SectionToasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };

// GET /sales-returns/:id/receive-options (I4, sales.deliver): per return
// line, whether the item is batch-tracked and which batch(es) the original
// delivery line actually issued from (quantity = issued from that batch).
type IssuedBatch = { batchId: number; batchNumber: string; expiryDate: string | null; quantity: string };
type ReceiveOptionLine = {
  salesReturnItemId: number;
  itemId: number;
  itemName: string;
  batchTracked: boolean;
  requestedQty: string;
  batches: IssuedBatch[];
};
type ReceiveOptions = { salesReturnId: number; lines: ReceiveOptionLine[] };

const EXPIRY_MAX_YEAR = Math.min(toJalali(new Date()).jy + 15, 1499);

function issuedBatchLabel(batch: IssuedBatch): string {
  const expiry = batch.expiryDate ? ` — انقضا ${formatJalali(batch.expiryDate)}` : "";
  return `${batch.batchNumber} — صادرشده ${formatQuantity(batch.quantity)}${expiry}`;
}

// «دریافت کالا» — APPROVED → RECEIVED (POST :id/receive, sales.deliver).
// Every line defaults to its full requestedQty (the common case: everything
// claimed actually arrived) but stays editable — the warehouse may receive
// less (build plan §4.2's receivedQty is a distinct column from
// requestedQty for exactly this). Stock effect RETURN_RECEIPT (QC +q) runs
// server-side.
//
// I4 (§5.4a R7, B22, B24): a batch-tracked item's return lands in one
// specific batch. Per line, from receive-options: one issued batch → shown
// and auto-selected; several (a FEFO-split delivery) → the user must pick
// one (a return line goes back into exactly one batch — a split return is two
// return documents, B24); none (the delivery predates the item's cutover to
// batch tracking, B22) → the user types the lot number printed on the goods
// (+ optional expiry). The backend validates every choice. The batch picker is
// a plain native <select> inside an already-open dialog — nothing here opens
// another dialog or confirm from a picker (build plan §9's landmine).
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
  const [batchChoice, setBatchChoice] = useState<Record<number, string>>({});
  const [lotNumber, setLotNumber] = useState<Record<number, string>>({});
  const [lotExpiry, setLotExpiry] = useState<Record<number, string>>({});
  const [options, setOptions] = useState<ReceiveOptions | "loading" | "error">("loading");
  const [optionsKey, setOptionsKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuantities(Object.fromEntries(salesReturn.items.map((line) => [line.id, line.requestedQty])));
      setBatchChoice({});
      setLotNumber({});
      setLotExpiry({});
      setOptions("loading");
      setOptionsKey((key) => key + 1);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<ReceiveOptions>(`/sales-returns/${salesReturn.id}/receive-options`)
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        // Exactly one issued batch → auto-selected (nothing to decide).
        setBatchChoice(Object.fromEntries(data.lines.filter((line) => line.batchTracked && line.batches.length === 1).map((line) => [line.salesReturnItemId, String(line.batches[0].batchId)])));
      })
      .catch(() => {
        if (!cancelled) setOptions("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, salesReturn.id, optionsKey]);

  const optionByLine = new Map(options !== "loading" && options !== "error" ? options.lines.map((line) => [line.salesReturnItemId, line]) : []);
  const anyTracked = [...optionByLine.values()].some((line) => line.batchTracked);
  const optionsReady = options !== "loading" && options !== "error";

  function closeDialog() {
    if (saving) return;
    onOpenChange(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!optionsReady) return;
    const problems: string[] = [];
    const items = salesReturn.items.map((line) => {
      const receivedQty = Number(quantities[line.id] ?? line.requestedQty);
      if (!Number.isFinite(receivedQty) || receivedQty < 0) problems.push(`«${line.itemName}»: مقدار دریافت‌شده نامعتبر است.`);
      const option = optionByLine.get(line.id);
      const entry: { salesReturnItemId: number; receivedQty: number; batchId?: number; batchNumber?: string; expiryDate?: string } = { salesReturnItemId: line.id, receivedQty };
      if (option?.batchTracked && receivedQty > 0) {
        if (option.batches.length === 0) {
          const typed = (lotNumber[line.id] ?? "").trim();
          if (!typed) problems.push(`«${line.itemName}»: شماره بچ کالای مرجوعی را وارد کنید.`);
          else entry.batchNumber = typed;
          if (lotExpiry[line.id]) entry.expiryDate = lotExpiry[line.id];
        } else {
          const chosen = batchChoice[line.id];
          if (!chosen) problems.push(`«${line.itemName}»: این ردیف از چند بچ صادر شده است؛ بچ مرجوعی را انتخاب کنید.`);
          else entry.batchId = Number(chosen);
        }
      }
      return entry;
    });
    if (problems.length) {
      pushErrors(problems);
      return;
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
      <DialogContent className={anyTracked ? "max-w-4xl" : "max-w-2xl"}>
        <DialogHeader>
          <DialogTitle>دریافت کالای مرجوعی</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="return-receive-form" className="grid gap-3" onSubmit={submit} noValidate>
            <p className="text-sm text-muted-foreground">مقدار واقعاً دریافت‌شدهٔ هر ردیف را تأیید یا اصلاح کنید؛ موجودی «در انتظار کنترل کیفیت» به همین میزان افزایش می‌یابد.</p>
            {options === "error" ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                <span className="text-destructive">دریافت اطلاعات بچ ردیف‌ها ناموفق بود؛ بدون آن ثبت دریافت ممکن نیست.</span>
                <Button type="button" size="sm" variant="outline" onClick={() => {
                  setOptions("loading");
                  setOptionsKey((key) => key + 1);
                }}>
                  تلاش دوباره
                </Button>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[32rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">کالا</th>
                    <th className="px-2 py-2 font-medium">درخواستی</th>
                    <th className="w-32 px-2 py-2 font-medium">دریافت‌شده</th>
                    {anyTracked ? <th className="w-80 px-2 py-2 font-medium">بچ</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {salesReturn.items.map((line) => {
                    const option = optionByLine.get(line.id);
                    const receivedQty = Number(quantities[line.id] ?? line.requestedQty);
                    return (
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
                        {anyTracked ? (
                          <td className="px-2 py-1.5">
                            {!option?.batchTracked ? (
                              <span className="text-xs text-muted-foreground">بدون ردیابی بچ</span>
                            ) : receivedQty === 0 ? (
                              <span className="text-xs text-muted-foreground">دریافتی ندارد</span>
                            ) : option.batches.length === 1 ? (
                              <span className="text-xs">
                                <span className="font-mono">{option.batches[0].batchNumber}</span>
                                <span className="ms-1 text-muted-foreground">(تنها بچ صادرشده — خودکار)</span>
                              </span>
                            ) : option.batches.length > 1 ? (
                              <div className="flex flex-col gap-0.5">
                                <select
                                  aria-label={`بچ مرجوعی ${line.itemName}`}
                                  className={`${selectClass} h-8 w-full`}
                                  value={batchChoice[line.id] ?? ""}
                                  onChange={(event) => setBatchChoice((current) => ({ ...current, [line.id]: event.target.value }))}
                                >
                                  <option value="">انتخاب بچ...</option>
                                  {option.batches.map((batch) => (
                                    <option key={batch.batchId} value={batch.batchId}>
                                      {issuedBatchLabel(batch)}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-[11px] text-muted-foreground">این ردیف از چند بچ صادر شده؛ بچی را که کالای مرجوعی از آن است انتخاب کنید.</span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <span className="text-[11px] text-muted-foreground">
                                  حواله پیش از فعال‌شدن ردیابی بچ صادر شده؛ شماره بچ چاپ‌شده روی کالا را وارد کنید
                                  <RequiredMark />
                                </span>
                                <Input
                                  aria-label={`شماره بچ مرجوعی ${line.itemName}`}
                                  dir="ltr"
                                  className="h-8"
                                  maxLength={100}
                                  value={lotNumber[line.id] ?? ""}
                                  placeholder="شماره بچ"
                                  onChange={(event) => setLotNumber((current) => ({ ...current, [line.id]: event.target.value }))}
                                />
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                  <span>تاریخ انقضا (اختیاری):</span>
                                  <JalaliDateInput
                                    idPrefix={`return-lot-expiry-${line.id}`}
                                    value={lotExpiry[line.id] ?? ""}
                                    maxYear={EXPIRY_MAX_YEAR}
                                    onChange={(value) => setLotExpiry((current) => ({ ...current, [line.id]: value }))}
                                  />
                                </div>
                              </div>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {options === "loading" ? <p className="text-xs text-muted-foreground">در حال دریافت اطلاعات بچ ردیف‌ها...</p> : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="return-receive-form" disabled={saving || staleRecord || !optionsReady}>
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
