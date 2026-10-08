"use client";

import { Fragment } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { formatMoney } from "@/lib/format";
import { parseNumberInput } from "@/lib/number-input";
import { formatQuantity, type SalesItemOption } from "../shared";
import { FormSection } from "./FormSection";

export type SalesLineRow = {
  key: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  priceOverrideReason: string;
  discountPercent: string;
  discountAmount: string;
  taxRate: string;
  note: string;
};

export function emptySalesLine(): SalesLineRow {
  return { key: crypto.randomUUID(), itemId: "", quantity: "", unitPrice: "", priceOverrideReason: "", discountPercent: "", discountAmount: "", taxRate: "", note: "" };
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const number = parseNumberInput(value);
  return Number.isFinite(number) ? number : null;
}

// Live ESTIMATE of a line's money, same formula as backend sales-totals.ts
// (gross = round(qty × price); discount = round(gross × % / 100) or the
// amount; tax = round((gross − discount) × rate / 100)). Display only — the
// server recomputes every amount on save and its figures are the truth.
export function estimateLine(line: SalesLineRow) {
  const quantity = numberOrNull(line.quantity) ?? 0;
  const unitPrice = numberOrNull(line.unitPrice) ?? 0;
  const gross = Math.round(quantity * unitPrice);
  const percent = numberOrNull(line.discountPercent);
  const discount = percent !== null ? Math.round((gross * percent) / 100) : (numberOrNull(line.discountAmount) ?? 0);
  const taxRate = numberOrNull(line.taxRate) ?? 0;
  const tax = Math.round(((gross - discount) * taxRate) / 100);
  return { gross, discount, tax, total: gross - discount + tax };
}

/** The list price to compare against: the item's current sellingPrice (what the backend checks), or the draft's snapshot for an item no longer offered. */
export function listPriceOf(itemId: string, itemById: Map<number, SalesItemOption>, fallback: Map<number, string | null>): number | null {
  if (!itemId) return null;
  const option = itemById.get(Number(itemId));
  const price = option ? option.sellingPrice : (fallback.get(Number(itemId)) ?? null);
  return price === null ? null : Number(price);
}

export function isBelowList(line: SalesLineRow, listPrice: number | null): boolean {
  const unitPrice = numberOrNull(line.unitPrice);
  return listPrice !== null && unitPrice !== null && unitPrice < listPrice;
}

// The order lines (section 2). Each line is two table rows: the main row
// (کالا / واحد / موجود / مقدار / قیمت / [تخفیف] / مالیات / جمع) and a
// sub-row holding the price-override reason (only when the price is below
// the list price — B2, required then) and the line note.
// Discount inputs exist only for sales.approve holders (B3); the backend
// refuses a discount from anyone else regardless.
// «موجود» = available at the default warehouse when the form loaded
// (on hand − reserved) — informational; confirming re-checks under a lock
// and a shortfall becomes a visible backorder, never a block.
export function ItemsGrid({
  lines,
  setLines,
  itemOptions,
  listPriceFallback,
  canDiscount,
  locationName,
}: {
  lines: SalesLineRow[];
  setLines: (update: (current: SalesLineRow[]) => SalesLineRow[]) => void;
  itemOptions: SalesItemOption[];
  // itemId → listUnitPrice snapshot, for draft lines whose item is no longer offered.
  listPriceFallback: Map<number, string | null>;
  canDiscount: boolean;
  locationName: string;
}) {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));
  const columnCount = canDiscount ? 10 : 8;

  function updateLine(key: string, patch: Partial<SalesLineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function pickItem(line: SalesLineRow, itemId: string) {
    const item = itemId ? itemById.get(Number(itemId)) : undefined;
    // A newly picked item starts at its list price (editable afterwards).
    updateLine(line.key, { itemId, unitPrice: item?.sellingPrice != null ? String(Number(item.sellingPrice)) : "", priceOverrideReason: "" });
  }

  return (
    <FormSection title="اقلام سفارش" description={`موجودی قابل فروش از انبار «${locationName}» — فقط جهت اطلاع؛ کسری موجودی مانع تأیید نیست و به‌صورت پس‌افت ثبت می‌شود.`}>
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[60rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">کالا<RequiredMark /></th>
                <th className="w-20 px-2 py-1.5 font-medium">واحد</th>
                <th className="w-20 px-2 py-1.5 font-medium">موجود</th>
                <th className="w-24 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                <th className="w-32 px-2 py-1.5 font-medium">قیمت واحد (ریال)<RequiredMark /></th>
                {canDiscount ? (
                  <>
                    <th className="w-20 px-2 py-1.5 font-medium">تخفیف ٪</th>
                    <th className="w-28 px-2 py-1.5 font-medium">مبلغ تخفیف</th>
                  </>
                ) : null}
                <th className="w-20 px-2 py-1.5 font-medium">مالیات ٪</th>
                <th className="w-32 px-2 py-1.5 font-medium">جمع ردیف (برآورد)</th>
                <th className="w-10 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const row = (index + 1).toLocaleString("fa-IR");
                const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
                const listPrice = listPriceOf(line.itemId, itemById, listPriceFallback);
                const belowList = isBelowList(line, listPrice);
                const quantity = numberOrNull(line.quantity);
                const available = item ? Number(item.available) : null;
                const short = available !== null && quantity !== null && quantity > available;
                const estimate = estimateLine(line);
                return (
                  <Fragment key={line.key}>
                    <tr className="border-t border-border">
                      <td className="px-2 pt-1.5 text-xs tabular-nums text-muted-foreground">{row}</td>
                      <td className="px-2 pt-1.5">
                        <select aria-label={`کالای ردیف ${row}`} className={`${selectClass} w-full`} value={line.itemId} onChange={(event) => pickItem(line, event.target.value)}>
                          <option value="">انتخاب کنید</option>
                          {itemOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name} ({option.code})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 pt-1.5 text-muted-foreground">{item?.unit.nameFa ?? "-"}</td>
                      <td className={`px-2 pt-1.5 tabular-nums ${short ? "font-medium text-warning" : "text-muted-foreground"}`} title={short ? "مقدار سفارش بیشتر از موجودی قابل فروش است" : undefined}>
                        {available === null ? "-" : formatQuantity(available)}
                      </td>
                      <td className="px-2 pt-1.5">
                        <Input aria-label={`مقدار ردیف ${row}`} dir="ltr" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} />
                      </td>
                      <td className="px-2 pt-1.5">
                        <Input
                          aria-label={`قیمت واحد ردیف ${row}`}
                          dir="ltr"
                          inputMode="numeric"
                          value={line.unitPrice}
                          aria-invalid={belowList && !line.priceOverrideReason.trim() ? true : undefined}
                          onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                        />
                      </td>
                      {canDiscount ? (
                        <>
                          <td className="px-2 pt-1.5">
                            <Input
                              aria-label={`درصد تخفیف ردیف ${row}`}
                              dir="ltr"
                              inputMode="decimal"
                              value={line.discountPercent}
                              disabled={line.discountAmount.trim() !== ""}
                              onChange={(event) => updateLine(line.key, { discountPercent: event.target.value })}
                            />
                          </td>
                          <td className="px-2 pt-1.5">
                            <Input
                              aria-label={`مبلغ تخفیف ردیف ${row}`}
                              dir="ltr"
                              inputMode="numeric"
                              value={line.discountAmount}
                              disabled={line.discountPercent.trim() !== ""}
                              onChange={(event) => updateLine(line.key, { discountAmount: event.target.value })}
                            />
                          </td>
                        </>
                      ) : null}
                      <td className="px-2 pt-1.5">
                        <Input aria-label={`نرخ مالیات ردیف ${row}`} dir="ltr" inputMode="decimal" placeholder="0" value={line.taxRate} onChange={(event) => updateLine(line.key, { taxRate: event.target.value })} />
                      </td>
                      <td className="px-2 pt-1.5 font-medium whitespace-nowrap tabular-nums">{formatMoney(estimate.total)}</td>
                      <td className="px-2 pt-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`حذف ردیف ${row}`}
                          disabled={lines.length === 1}
                          onClick={() => setLines((current) => (current.length > 1 ? current.filter((entry) => entry.key !== line.key) : current))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                    <tr>
                      <td></td>
                      <td colSpan={columnCount} className="px-2 pt-1 pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {belowList ? (
                            <label className="flex min-w-72 flex-1 items-center gap-2 text-xs">
                              <span className="shrink-0 text-warning">
                                قیمت کمتر از قیمت فهرست ({formatMoney(listPrice)} ریال) — علت<RequiredMark />
                              </span>
                              <Input
                                aria-label={`علت کاهش قیمت ردیف ${row}`}
                                className="h-7 text-xs"
                                maxLength={500}
                                value={line.priceOverrideReason}
                                onChange={(event) => updateLine(line.key, { priceOverrideReason: event.target.value })}
                              />
                            </label>
                          ) : listPrice !== null && line.itemId ? (
                            <span className="text-xs text-muted-foreground">قیمت فهرست: {formatMoney(listPrice)} ریال</span>
                          ) : line.itemId ? (
                            <span className="text-xs text-muted-foreground">برای این کالا قیمت فهرست تعریف نشده است</span>
                          ) : null}
                          <label className="flex min-w-60 flex-1 items-center gap-2 text-xs">
                            <span className="shrink-0 text-muted-foreground">توضیح ردیف</span>
                            <Input aria-label={`توضیح ردیف ${row}`} className="h-7 text-xs" maxLength={500} value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} />
                          </label>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptySalesLine()])}>
          <Plus className="size-4" aria-hidden="true" />
          افزودن ردیف
        </Button>
      </div>
    </FormSection>
  );
}
