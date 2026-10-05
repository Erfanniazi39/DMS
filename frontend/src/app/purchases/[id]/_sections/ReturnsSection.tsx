"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import {
  RequiredMark,
  formatMoney,
  selectClass,
  textareaClass,
  type PurchaseDetail,
  type PurchaseReturnRow,
  type PurchaseStatus,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

// Return to Vendor dialog — one header (date/reason/note) plus one or more
// lines, each pointing at one of this purchase's own items. creditAmount is
// a plain editable field: suggested from quantity × the item's unit price
// (same convenience as PurchaseForm's line total), never enforced.
type ReturnLineFormState = {
  key: string;
  purchaseItemId: string;
  quantity: string;
  creditAmount: string;
  note: string;
};

export type ReturnFormState = {
  returnDate: string;
  reason: string;
  note: string;
  lines: ReturnLineFormState[];
};

function emptyReturnLine(): ReturnLineFormState {
  return { key: crypto.randomUUID(), purchaseItemId: "", quantity: "", creditAmount: "", note: "" };
}

export function emptyReturnForm(): ReturnFormState {
  return { returnDate: "", reason: "", note: "", lines: [emptyReturnLine()] };
}

// Which purchase statuses allow recording a return — mirrors the backend
// (purchase-rules.ts RETURNABLE_PURCHASE_STATUSES); the backend stays
// authoritative, this just hides actions that would be refused.
const RETURNABLE_STATUSES: PurchaseStatus[] = ["RECEIVED", "CLOSED"];

// «بازگشت به تأمین‌کننده» section plus its create dialog. The returns list,
// its loading/error state and all dialog/form state live in page.tsx and
// are passed in; `loadReturns` re-fetches the list.
export function ReturnsSection({
  purchaseId,
  purchase,
  canManageReturns,
  returns,
  returnsLoading,
  returnsError,
  loadReturns,
  dialogOpen,
  setDialogOpen,
  form,
  setForm,
  saving,
  setSaving,
  toasts,
}: {
  purchaseId: number;
  purchase: PurchaseDetail;
  canManageReturns: boolean;
  returns: PurchaseReturnRow[];
  returnsLoading: boolean;
  returnsError: string | null;
  loadReturns: () => Promise<void>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  form: ReturnFormState;
  setForm: Dispatch<SetStateAction<ReturnFormState>>;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;

  // Quantity already returned per purchase item, summed across every
  // return on this purchase — drives the "قابل برگشت" hint in the dialog.
  // The backend re-checks this authoritatively on submit.
  function returnedQuantityByItem(): Map<number, number> {
    const totals = new Map<number, number>();
    for (const purchaseReturn of returns) {
      for (const line of purchaseReturn.items) {
        totals.set(line.purchaseItemId, (totals.get(line.purchaseItemId) ?? 0) + Number(line.quantity));
      }
    }
    return totals;
  }

  function openReturnDialog() {
    setForm(emptyReturnForm());
    setDialogOpen(true);
  }

  function updateReturnLine(key: string, patch: Partial<ReturnLineFormState>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if (("quantity" in patch || "purchaseItemId" in patch) && !("creditAmount" in patch)) {
          const item = purchase.items.find((candidate) => String(candidate.id) === next.purchaseItemId);
          const quantity = parseNumberInput(next.quantity);
          const unitPrice = Number(item?.unitPrice);
          if (item?.unitPrice && next.quantity !== "" && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
            next.creditAmount = String(Math.round(quantity * unitPrice));
          }
        }
        return next;
      }),
    }));
  }

  function addReturnLine() {
    setForm((current) => ({ ...current, lines: [...current.lines, emptyReturnLine()] }));
  }

  function removeReturnLine(key: string) {
    setForm((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.key !== key) : current.lines,
    }));
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.returnDate || !form.reason.trim()) {
      pushError("تاریخ و علت برگشت الزامی است.");
      return;
    }
    if (form.lines.some((line) => !line.purchaseItemId || line.quantity === "" || line.creditAmount === "")) {
      pushError("برای هر ردیف، قلم خرید، مقدار و مبلغ اعتبار را وارد کنید.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/purchases/${purchaseId}/returns`, {
        method: "POST",
        body: JSON.stringify({
          returnDate: form.returnDate,
          reason: form.reason.trim(),
          note: form.note.trim(),
          items: form.lines.map((line) => ({
            purchaseItemId: Number(line.purchaseItemId),
            quantity: parseNumberInput(line.quantity),
            creditAmount: parseNumberInput(line.creditAmount),
            note: line.note.trim(),
          })),
        }),
      });
      pushSuccess("برگشت به تأمین‌کننده با موفقیت ثبت شد.");
      setDialogOpen(false);
      await loadReturns();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ثبت برگشت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function removeReturn(returnId: number) {
    if (!window.confirm("آیا از حذف این برگشت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/purchases/${purchaseId}/returns/${returnId}`, { method: "DELETE" });
      pushSuccess("برگشت حذف شد.");
      await loadReturns();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف برگشت ناموفق بود.");
    }
  }

  const canAddReturn = canManageReturns && RETURNABLE_STATUSES.includes(purchase.status);
  const returnedByItem = returnedQuantityByItem();
  const totalReturnCredit = returns.reduce(
    (sum, purchaseReturn) => sum + purchaseReturn.items.reduce((lineSum, line) => lineSum + Number(line.creditAmount), 0),
    0,
  );

  return (
    <>
      {/* 5. بازگشت به تأمین‌کننده */}
      <DetailSection
        title="بازگشت به تأمین‌کننده"
        action={
          canAddReturn ? (
            <Button size="sm" onClick={openReturnDialog}>
              <Plus className="size-4" aria-hidden="true" />
              ثبت برگشت
            </Button>
          ) : undefined
        }
      >
        {returnsLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : returnsError ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/40 p-6 text-center">
            <p className="text-sm text-destructive" role="alert">{returnsError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadReturns()}>
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              برگشت‌ها فقط سابقه کالای برگشتی و مبلغ اعتبار آن را ثبت می‌کنند و مبلغ کل، مبلغ پرداخت‌شده و وضعیت پرداخت خرید را تغییر نمی‌دهند.
              {canManageReturns && !RETURNABLE_STATUSES.includes(purchase.status) ? " ثبت برگشت فقط برای خرید «دریافت‌شده» یا «بسته‌شده» امکان‌پذیر است." : null}
              {returns.length > 0 ? " خریدی که برگشت دارد تا زمان حذف برگشت‌ها قابل ویرایش نیست." : null}
            </p>
            {returns.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                هنوز برگشتی ثبت نشده است.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[44rem] text-right text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">شماره برگشت</th>
                      <th className="px-3 py-2 font-medium">تاریخ</th>
                      <th className="px-3 py-2 font-medium">اقلام برگشتی</th>
                      <th className="px-3 py-2 font-medium">مبلغ اعتبار</th>
                      <th className="px-3 py-2 font-medium">علت</th>
                      <th className="px-3 py-2 font-medium">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {returns.map((purchaseReturn) => (
                      <tr key={purchaseReturn.id} className="align-top">
                        <td className="px-3 py-2 font-mono">{purchaseReturn.returnNumber}</td>
                        <td className="px-3 py-2 text-muted-foreground">{formatJalali(purchaseReturn.returnDate)}</td>
                        <td className="px-3 py-2">
                          <ul className="space-y-0.5">
                            {purchaseReturn.items.map((line) => (
                              <li key={line.id}>
                                {line.purchaseItem.name}
                                <span className="text-muted-foreground tabular-nums">
                                  {" "}— {formatMoney(line.quantity)} {line.purchaseItem.unit.nameFa}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatMoney(purchaseReturn.items.reduce((sum, line) => sum + Number(line.creditAmount), 0))} ریال
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {purchaseReturn.reason}
                          {purchaseReturn.note ? <span className="block text-xs">{purchaseReturn.note}</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          {canManageReturns ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => removeReturn(purchaseReturn.id)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              حذف
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-medium">
                      <td className="px-3 py-2" colSpan={3}>جمع اعتبار برگشت‌ها</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(totalReturnCredit)} ریال</td>
                      <td className="px-3 py-2" colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </DetailSection>

      {/* Portal-based: renders outside the page flow regardless of where it sits in the tree. */}
      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت برگشت به تأمین‌کننده</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="return-form" className="grid gap-4" onSubmit={submitReturn} noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="return-date-year">تاریخ برگشت<RequiredMark /></Label>
                  <JalaliDateInput
                    idPrefix="return-date"
                    value={form.returnDate}
                    onChange={(value) => setForm((current) => ({ ...current, returnDate: value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="return-reason">علت برگشت<RequiredMark /></Label>
                  <Input
                    id="return-reason"
                    value={form.reason}
                    onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>اقلام برگشتی</Label>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[40rem] text-right text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">قلم خرید<RequiredMark /></th>
                        <th className="w-28 px-3 py-2 font-medium">مقدار برگشتی<RequiredMark /></th>
                        <th className="w-32 px-3 py-2 font-medium">مبلغ اعتبار (ریال)<RequiredMark /></th>
                        <th className="px-3 py-2 font-medium">یادداشت</th>
                        <th className="w-12 px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {form.lines.map((line) => {
                        const item = purchase.items.find((candidate) => String(candidate.id) === line.purchaseItemId);
                        const returnable = item ? Number(item.quantity) - (returnedByItem.get(item.id) ?? 0) : null;
                        return (
                          <tr key={line.key} className="align-top">
                            <td className="px-3 py-2">
                              <select
                                aria-label="قلم خرید"
                                className={`${selectClass} w-full`}
                                value={line.purchaseItemId}
                                onChange={(event) => updateReturnLine(line.key, { purchaseItemId: event.target.value })}
                              >
                                <option value="">-</option>
                                {purchase.items.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name} ({formatMoney(candidate.quantity)} {candidate.unit.nameFa})
                                  </option>
                                ))}
                              </select>
                              {item && returnable !== null ? (
                                <p className={`mt-1 text-xs tabular-nums ${returnable > 0 ? "text-muted-foreground" : "text-destructive"}`}>
                                  قابل برگشت: {formatMoney(returnable)} {item.unit.nameFa}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="مقدار برگشتی"
                                inputMode="decimal"
                                value={line.quantity}
                                onChange={(event) => updateReturnLine(line.key, { quantity: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="مبلغ اعتبار"
                                inputMode="decimal"
                                value={line.creditAmount}
                                onChange={(event) => updateReturnLine(line.key, { creditAmount: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                aria-label="یادداشت ردیف"
                                value={line.note}
                                onChange={(event) => updateReturnLine(line.key, { note: event.target.value })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="حذف ردیف"
                                onClick={() => removeReturnLine(line.key)}
                                disabled={form.lines.length === 1}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addReturnLine}>
                  <Plus className="size-4" aria-hidden="true" />
                  افزودن ردیف
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="return-note">یادداشت</Label>
                <textarea
                  id="return-note"
                  className={textareaClass}
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="return-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : "ثبت برگشت"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
