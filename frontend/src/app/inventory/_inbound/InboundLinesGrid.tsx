"use client";

import { Fragment } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatMoney } from "@/lib/format";
import { toJalali } from "@/lib/jalali";
import { parseNumberInput } from "@/lib/number-input";
import { FormSection } from "../adjustments/_form/FormSection";
import type { InboundItemOption } from "../shared";

// Inventory batch I5: the lines table shared by the goods-receipt and
// production-output forms. Modelled on adjustments/_form/AdjustmentLinesGrid.tsx,
// with two differences the backend dictates:
//   - the lot number is ALWAYS typed (create-or-match at posting) — there is
//     no existing-batch picker on these documents. It's shown and required
//     only for an item whose form-options entry says batchTracked; an
//     untracked item's line must carry no batch fields at all (400 otherwise).
//   - an optional per-unit cost column (whole Rial), rendered only for users
//     holding inventory.cost (`showCost`). Without it the column doesn't
//     exist and the form never sends the key (the backend 403s it).
// Every picker here is a native <select> and nothing opens a dialog or
// confirm from onChange (the Base-UI Select/Dialog landmine, plan §9).

export type InboundLineRow = {
  key: string;
  itemId: string;
  quantity: string;
  unitCost: string;
  costIsEstimated: boolean;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
  note: string;
};

export function emptyInboundLine(): InboundLineRow {
  return { key: crypto.randomUUID(), itemId: "", quantity: "", unitCost: "", costIsEstimated: false, batchNumber: "", productionDate: "", expiryDate: "", note: "" };
}

// Expiry dates are normally in the future — let the year list run ahead.
const EXPIRY_MAX_YEAR = Math.min(toJalali(new Date()).jy + 15, 1499);

/** quantity × unitCost for display, or null when either is missing/invalid. */
export function inboundLineTotal(line: { quantity: string; unitCost: string }): number | null {
  if (line.quantity.trim() === "" || line.unitCost.trim() === "") return null;
  const quantity = parseNumberInput(line.quantity);
  const cost = parseNumberInput(line.unitCost);
  if (!Number.isFinite(quantity) || !Number.isFinite(cost)) return null;
  return Math.round(quantity * cost);
}

export function InboundLinesGrid({
  lines,
  setLines,
  itemOptions,
  showCost,
  showCostEstimated = false,
  headerProductionDate,
  itemKindsHint,
}: {
  lines: InboundLineRow[];
  setLines: (update: (current: InboundLineRow[]) => InboundLineRow[]) => void;
  itemOptions: InboundItemOption[];
  // inventory.cost held — render the cost inputs at all.
  showCost: boolean;
  // Production output only: the «برآوردی» flag next to the cost.
  showCostEstimated?: boolean;
  // Production output only: a line without its own production date uses the
  // header's at posting (so a shelf-life setting can derive the expiry).
  headerProductionDate?: string;
  itemKindsHint: string;
}) {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));
  const columnCount = 6 + (showCost ? 2 : 0);
  const costTotal = showCost ? lines.reduce((sum, line) => sum + (inboundLineTotal(line) ?? 0), 0) : 0;

  function updateLine(key: string, patch: Partial<InboundLineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  return (
    <FormSection title="اقلام" description={itemKindsHint}>
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[56rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">کالا<RequiredMark /></th>
                <th className="w-20 px-2 py-1.5 font-medium">واحد</th>
                <th className="w-28 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                {showCost ? <th className="w-36 px-2 py-1.5 font-medium">بهای واحد (ریال)</th> : null}
                {showCost ? <th className="w-32 px-2 py-1.5 font-medium">جمع (ریال)</th> : null}
                <th className="w-48 px-2 py-1.5 font-medium">شماره بچ</th>
                <th className="w-52 px-2 py-1.5 font-medium">توضیح ردیف</th>
                <th className="w-12 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, index) => {
                const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
                const tracked = item?.batchTracked ?? false;
                const total = showCost ? inboundLineTotal(line) : null;
                const effectiveProduction = line.productionDate || headerProductionDate || "";
                const expiryMissing = tracked && item?.expiryRequired && !line.expiryDate && !(effectiveProduction && item.shelfLifeDays);
                return (
                  <Fragment key={line.key}>
                    <tr className={tracked ? "border-b-0" : undefined}>
                      <td className="px-2 py-1">
                        <select
                          aria-label={`کالای ردیف ${index + 1}`}
                          className={`${selectClass} w-full`}
                          value={line.itemId}
                          // A different item may differ in batch tracking — its lot fields start over.
                          onChange={(event) => updateLine(line.key, { itemId: event.target.value, batchNumber: "", productionDate: "", expiryDate: "" })}
                        >
                          <option value="">انتخاب کنید</option>
                          {itemOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} ({option.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{item?.unit.nameFa ?? "-"}</td>
                      <td className="px-2 py-1">
                        <Input aria-label={`مقدار ردیف ${index + 1}`} dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
                      </td>
                      {showCost ? (
                        <td className="px-2 py-1">
                          <div className="flex flex-col gap-0.5">
                            <MoneyInput
                              aria-label={`بهای واحد ردیف ${index + 1}`}
                              value={line.unitCost}
                              placeholder="اختیاری"
                              // Clearing the cost also clears «برآوردی» (it only means something with a cost).
                              onChange={(value) => updateLine(line.key, value === "" ? { unitCost: value, costIsEstimated: false } : { unitCost: value })}
                            />
                            {showCostEstimated ? (
                              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  className="size-3.5 rounded border-input"
                                  checked={line.costIsEstimated}
                                  disabled={line.unitCost.trim() === ""}
                                  onChange={(event) => updateLine(line.key, { costIsEstimated: event.target.checked })}
                                />
                                بها برآوردی است
                              </label>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      {showCost ? <td className="px-2 py-1 tabular-nums text-muted-foreground">{total === null ? "-" : formatMoney(total)}</td> : null}
                      <td className="px-2 py-1">
                        {tracked ? (
                          <Input
                            aria-label={`شماره بچ ردیف ${index + 1}`}
                            dir="ltr"
                            maxLength={100}
                            value={line.batchNumber}
                            placeholder="مثلاً LOT-1405-01"
                            onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">{item ? "بدون ردیابی بچ" : "-"}</span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Input aria-label={`توضیح ردیف ${index + 1}`} maxLength={500} value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`حذف ردیف ${index + 1}`}
                          disabled={lines.length === 1}
                          onClick={() => setLines((current) => (current.length > 1 ? current.filter((row) => row.key !== line.key) : current))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                    {tracked ? (
                      <tr className="bg-muted/20">
                        <td colSpan={columnCount} className="px-2 pt-0 pb-2">
                          <div className="flex flex-wrap items-end gap-x-4 gap-y-2 ps-2 text-xs">
                            <span className="self-center text-[11px] font-medium text-muted-foreground">
                              بچ ردیف {(index + 1).toLocaleString("fa-IR")}<RequiredMark />:
                            </span>
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`line-${line.key}-production-year`} className="text-xs text-muted-foreground">تاریخ تولید</Label>
                              <JalaliDateInput idPrefix={`line-${line.key}-production`} value={line.productionDate} onChange={(value) => updateLine(line.key, { productionDate: value })} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`line-${line.key}-expiry-year`} className="text-xs text-muted-foreground">
                                تاریخ انقضا{item?.expiryRequired ? <RequiredMark /> : null}
                              </Label>
                              <JalaliDateInput idPrefix={`line-${line.key}-expiry`} value={line.expiryDate} maxYear={EXPIRY_MAX_YEAR} onChange={(value) => updateLine(line.key, { expiryDate: value })} />
                            </div>
                            <div className="flex max-w-md flex-col gap-0.5 self-center text-[11px] text-muted-foreground">
                              {headerProductionDate !== undefined && !line.productionDate ? <span>بدون تاریخ تولید ردیف، تاریخ تولید سند برای این بچ ثبت می‌شود.</span> : null}
                              {item?.shelfLifeDays && !line.expiryDate ? (
                                <span>طول عمر کالا {item.shelfLifeDays.toLocaleString("fa-IR")} روز است؛ بدون تاریخ انقضا، از تاریخ تولید محاسبه می‌شود.</span>
                              ) : null}
                              {expiryMissing ? <span className="text-destructive">این کالا تاریخ انقضای الزامی دارد؛ بدون آن «ثبت نهایی» رد می‌شود.</span> : null}
                              <span>اگر این شماره بچ قبلاً برای همین کالا ثبت شده باشد، به همان بچ اضافه می‌شود (تاریخ‌ها باید یکسان باشند).</span>
                            </div>
                            {line.productionDate || line.expiryDate ? (
                              <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => updateLine(line.key, { productionDate: "", expiryDate: "" })}>
                                پاک کردن تاریخ‌ها
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            {showCost ? (
              <tfoot className="border-t border-border bg-muted/20 text-sm">
                <tr>
                  <td colSpan={4} className="px-2 py-1.5 text-muted-foreground">جمع بهای ردیف‌های دارای بها</td>
                  <td className="px-2 py-1.5 font-medium tabular-nums">{formatMoney(costTotal)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyInboundLine()])}>
          <Plus className="size-4" aria-hidden="true" />
          افزودن ردیف
        </Button>
      </div>
    </FormSection>
  );
}

/**
 * Client-side line checks shared by both forms (UX only — the backend DTO and
 * service stay authoritative and name the row in their own messages).
 */
export function validateInboundLines(lines: InboundLineRow[], itemOptions: InboundItemOption[], showCost: boolean): string[] {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));
  const problems: string[] = [];
  if (lines.length === 0) problems.push("حداقل یک ردیف کالا را وارد کنید.");
  lines.forEach((line, index) => {
    const row = `ردیف ${(index + 1).toLocaleString("fa-IR")}`;
    const quantity = parseNumberInput(line.quantity);
    if (!line.itemId) problems.push(`${row}: کالا را انتخاب کنید.`);
    if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) problems.push(`${row}: مقدار باید عددی بزرگ‌تر از صفر باشد.`);
    else if (Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-6) problems.push(`${row}: مقدار حداکثر می‌تواند دو رقم اعشار داشته باشد.`);
    if (showCost && line.unitCost.trim() !== "") {
      const cost = parseNumberInput(line.unitCost);
      if (!Number.isFinite(cost) || cost < 0 || !Number.isInteger(cost)) problems.push(`${row}: بهای واحد باید عدد صحیح (ریال) و نامنفی باشد.`);
    }
    const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
    if (item?.batchTracked && !line.batchNumber.trim()) problems.push(`${row}: این کالا ردیابی بچ دارد؛ شماره بچ را وارد کنید.`);
    if (line.productionDate && line.expiryDate && line.expiryDate < line.productionDate) problems.push(`${row}: تاریخ انقضا نمی‌تواند قبل از تاریخ تولید باشد.`);
  });
  return problems;
}

/**
 * One line of the create/update request body. Batch fields only for a
 * batch-tracked item; cost keys only when the user holds inventory.cost
 * (and only when filled in) — never sent as null/undefined otherwise.
 */
export function inboundLinePayload(line: InboundLineRow, item: InboundItemOption | undefined, options: { showCost: boolean; withEstimated: boolean }): Record<string, unknown> {
  const payload: Record<string, unknown> = { itemId: Number(line.itemId), quantity: parseNumberInput(line.quantity) };
  if (line.note.trim()) payload.note = line.note.trim();
  if (options.showCost && line.unitCost.trim() !== "") {
    payload.unitCost = parseNumberInput(line.unitCost);
    if (options.withEstimated && line.costIsEstimated) payload.costIsEstimated = true;
  }
  if (item?.batchTracked) {
    payload.batchNumber = line.batchNumber.trim();
    if (line.productionDate) payload.productionDate = line.productionDate;
    if (line.expiryDate) payload.expiryDate = line.expiryDate;
  }
  return payload;
}
