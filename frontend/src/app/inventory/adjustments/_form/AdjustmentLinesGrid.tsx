"use client";

import { Fragment } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatJalali, toJalali } from "@/lib/jalali";
import { parseNumberInput } from "@/lib/number-input";
import { useFeature } from "@/lib/session";
import { batchHasStock, formatQuantity, type ItemBatchRow, type ItemOption, type StockAdjustmentKind } from "../../shared";
import { FormSection } from "./FormSection";

// I4: how a line names its batch. "" = no batch (an untracked item);
// "existing" = pick one of the item's batches (batchId); "new" = type a new
// lot (batchNumber + optional production/expiry dates — the backend
// finds-or-creates it at posting). BATCH_CUTOVER lines are always "new".
export type LineBatchMode = "" | "existing" | "new";

export type AdjustmentLineRow = {
  key: string;
  itemId: string;
  quantity: string;
  note: string;
  batchMode: LineBatchMode;
  batchId: string;
  batchNumber: string;
  productionDate: string;
  expiryDate: string;
};

export function emptyLineRow(itemId = ""): AdjustmentLineRow {
  return { key: crypto.randomUUID(), itemId, quantity: "", note: "", batchMode: "", batchId: "", batchNumber: "", productionDate: "", expiryDate: "" };
}

// Per-item batch list as loaded by StockAdjustmentForm (GET
// /inventory/items/:itemId/batches): undefined = not requested yet.
export type BatchesState = ItemBatchRow[] | "loading" | "error";

// Expiry dates are normally in the future — let the year list run ahead.
const EXPIRY_MAX_YEAR = Math.min(toJalali(new Date()).jy + 15, 1499);

function batchOptionLabel(batch: ItemBatchRow): string {
  const expiry = batch.expiryDate ? `انقضا ${formatJalali(batch.expiryDate)}` : "بدون تاریخ انقضا";
  const expired = batch.isExpired ? " — منقضی‌شده" : "";
  return `${batch.batchNumber} — ${expiry}${expired} — موجودی ${formatQuantity(batch.onHand)}`;
}

// The lines table (کالا / واحد / موجودی فعلی / مقدار / بچ / توضیح). Rows live
// in StockAdjustmentForm's state. "موجودی فعلی" is informational only — the
// backend re-checks stock at posting/approval time and refuses anything that
// would go negative.
//
// I4: a «بچ» column. Whether an item is batch-tracked isn't exposed to
// inventory.adjust users (the item-settings endpoint is inventory.manage), so
// the grid infers it from the item's batch list: an item with batches is
// tracked (tracking is one-way) and its lines must name one; an item without
// any batches may still be tracked-but-empty, so a new lot number can be
// typed optionally. The backend's per-line validation stays authoritative and
// its Persian message names the row.
//
// BATCH_CUTOVER: one item per document (the item picker moves above the
// table), every line is a new lot, and the lines must sum to the item's
// current unbatched on-hand — shown live here, re-checked at approval.
export function AdjustmentLinesGrid({
  kind,
  lines,
  setLines,
  itemOptions,
  onHandByItem,
  batchesByItem,
}: {
  kind: StockAdjustmentKind;
  lines: AdjustmentLineRow[];
  setLines: (update: (current: AdjustmentLineRow[]) => AdjustmentLineRow[]) => void;
  itemOptions: ItemOption[];
  // null = current stock couldn't be loaded (column shows "-").
  onHandByItem: Map<number, string> | null;
  batchesByItem: Map<number, BatchesState>;
}) {
  const itemById = new Map(itemOptions.map((item) => [item.id, item]));
  const cutover = kind === "BATCH_CUTOVER";
  const cutoverItemId = cutover ? (lines.find((line) => line.itemId !== "")?.itemId ?? "") : "";

  function updateLine(key: string, patch: Partial<AdjustmentLineRow>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function setCutoverItem(itemId: string) {
    setLines((current) => current.map((line) => ({ ...line, itemId })));
  }

  function batchesFor(itemId: string): BatchesState | undefined {
    return itemId ? batchesByItem.get(Number(itemId)) : undefined;
  }

  return (
    <FormSection
      title="اقلام سند"
      description={
        cutover
          ? "هر ردیف یک بچ جدید از همین کالا است — مقادیر مثبت"
          : kind === "CORRECTION"
            ? "مقدار مثبت = افزایش موجودی، مقدار منفی = کاهش موجودی"
            : kind === "WRITE_OFF"
              ? "مقادیر باید منفی باشند (مقدار کسر از موجودی)"
              : "مقادیر باید مثبت باشند"
      }
    >
      <div className="space-y-2">
        {cutover ? <CutoverHeader itemId={cutoverItemId} setItemId={setCutoverItem} itemOptions={itemOptions} lines={lines} onHandByItem={onHandByItem} batches={batchesFor(cutoverItemId)} /> : null}

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[52rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {cutover ? <th className="w-10 px-2 py-1.5 font-medium">#</th> : <th className="px-2 py-1.5 font-medium">کالا<RequiredMark /></th>}
                {cutover ? null : <th className="w-20 px-2 py-1.5 font-medium">واحد</th>}
                {cutover ? null : <th className="w-24 px-2 py-1.5 font-medium">موجودی فعلی</th>}
                <th className="w-28 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                <th className={`${cutover ? "w-56" : "w-72"} px-2 py-1.5 font-medium`}>{cutover ? <>شماره بچ<RequiredMark /></> : "بچ"}</th>
                <th className="w-56 px-2 py-1.5 font-medium">توضیح ردیف</th>
                <th className="w-12 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, index) => {
                const item = line.itemId ? itemById.get(Number(line.itemId)) : undefined;
                const onHand = line.itemId && onHandByItem ? (onHandByItem.get(Number(line.itemId)) ?? "0") : null;
                const showLotDetails = cutover || line.batchMode === "new";
                const columnCount = cutover ? 5 : 7;
                return (
                  <Fragment key={line.key}>
                    <tr className={showLotDetails ? "border-b-0" : undefined}>
                      {cutover ? (
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{(index + 1).toLocaleString("fa-IR")}</td>
                      ) : (
                        <td className="px-2 py-1">
                          <select
                            aria-label={`کالای ردیف ${index + 1}`}
                            className={`${selectClass} w-full`}
                            value={line.itemId}
                            // A different item invalidates any batch picked for the old one.
                            onChange={(event) => updateLine(line.key, { itemId: event.target.value, batchMode: "", batchId: "", batchNumber: "", productionDate: "", expiryDate: "" })}
                          >
                            <option value="">انتخاب کنید</option>
                            {itemOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} ({option.code})
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {cutover ? null : <td className="px-2 py-1 text-muted-foreground">{item?.unit.nameFa ?? "-"}</td>}
                      {cutover ? null : <td className="px-2 py-1 tabular-nums text-muted-foreground">{onHand === null ? "-" : formatQuantity(onHand)}</td>}
                      <td className="px-2 py-1">
                        <Input
                          aria-label={`مقدار ردیف ${index + 1}`}
                          dir="ltr"
                          inputMode="decimal"
                          value={line.quantity}
                          placeholder={kind === "CORRECTION" ? "مثلاً 5 یا -2" : kind === "WRITE_OFF" ? "مثلاً -2" : ""}
                          onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        {cutover ? (
                          <Input
                            aria-label={`شماره بچ ردیف ${index + 1}`}
                            dir="ltr"
                            maxLength={100}
                            value={line.batchNumber}
                            placeholder="مثلاً LOT-1405-01"
                            onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                          />
                        ) : (
                          <LineBatchPicker line={line} index={index} batches={batchesFor(line.itemId)} onChange={(patch) => updateLine(line.key, patch)} />
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <Input aria-label={`توضیح ردیف ${index + 1}`} value={line.note} onChange={(event) => updateLine(line.key, { note: event.target.value })} />
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
                    {showLotDetails ? (
                      <tr className="bg-muted/20">
                        <td colSpan={columnCount} className="px-2 pt-0 pb-2">
                          <div className="flex flex-wrap items-end gap-x-4 gap-y-2 ps-2 text-xs">
                            {cutover ? null : (
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`line-${line.key}-batch-number`} className="text-xs text-muted-foreground">
                                  شماره بچ جدید<RequiredMark />
                                </Label>
                                <Input
                                  id={`line-${line.key}-batch-number`}
                                  dir="ltr"
                                  className="h-8 w-48"
                                  maxLength={100}
                                  value={line.batchNumber}
                                  placeholder="مثلاً LOT-1405-01"
                                  onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                                />
                              </div>
                            )}
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`line-${line.key}-production-year`} className="text-xs text-muted-foreground">تاریخ تولید</Label>
                              <JalaliDateInput idPrefix={`line-${line.key}-production`} value={line.productionDate} onChange={(value) => updateLine(line.key, { productionDate: value })} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`line-${line.key}-expiry-year`} className="text-xs text-muted-foreground">تاریخ انقضا</Label>
                              <JalaliDateInput
                                idPrefix={`line-${line.key}-expiry`}
                                value={line.expiryDate}
                                maxYear={EXPIRY_MAX_YEAR}
                                onChange={(value) => updateLine(line.key, { expiryDate: value })}
                              />
                            </div>
                            {line.productionDate && !line.expiryDate ? (
                              <span className="self-center text-[11px] text-muted-foreground">
                                اگر برای کالا «طول عمر» تعریف شده باشد، تاریخ انقضا از تاریخ تولید محاسبه می‌شود.
                              </span>
                            ) : null}
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
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, emptyLineRow(cutover ? cutoverItemId : "")])}>
          <Plus className="size-4" aria-hidden="true" />
          {cutover ? "افزودن بچ" : "افزودن ردیف"}
        </Button>
      </div>
    </FormSection>
  );
}

// The «بچ» cell of an ordinary (non-cutover) line. A plain native <select>
// (never Base-UI Select) and nothing here opens a dialog or confirm — the
// picker landmine (build plan §9) doesn't apply.
function LineBatchPicker({
  line,
  index,
  batches,
  onChange,
}: {
  line: AdjustmentLineRow;
  index: number;
  batches: BatchesState | undefined;
  onChange: (patch: Partial<AdjustmentLineRow>) => void;
}) {
  const batchTrackingOn = useFeature("inventoryBatchTracking");
  if (!line.itemId) return <span className="text-xs text-muted-foreground">-</span>;
  if (batches === undefined || batches === "loading") return <span className="text-xs text-muted-foreground">در حال بارگذاری بچ‌ها...</span>;

  const quantity = parseNumberInput(line.quantity);
  const decrease = Number.isFinite(quantity) && quantity < 0;
  // Outbound lines can only draw on a batch that still has stock; inbound
  // lines may top up any batch of the item (including a depleted one).
  const choices = batches === "error" ? [] : decrease ? batches.filter(batchHasStock) : batches;
  const known = batches !== "error" && batches.length > 0;
  // v1: batch tracking is hidden, so an item with no batches is treated as
  // untracked — no optional "new lot" entry. Already-tracked items keep it.
  if (!known && batches !== "error" && !batchTrackingOn) return <span className="text-xs text-muted-foreground">-</span>;
  const value = line.batchMode === "existing" ? `batch:${line.batchId}` : line.batchMode === "new" ? "new" : "";

  function select(next: string) {
    if (next === "new") onChange({ batchMode: "new", batchId: "" });
    else if (next.startsWith("batch:")) onChange({ batchMode: "existing", batchId: next.slice("batch:".length), batchNumber: "", productionDate: "", expiryDate: "" });
    else onChange({ batchMode: "", batchId: "", batchNumber: "", productionDate: "", expiryDate: "" });
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select aria-label={`بچ ردیف ${index + 1}`} className={`${selectClass} w-full`} value={value} onChange={(event) => select(event.target.value)}>
        <option value="">{known ? "انتخاب بچ..." : "بدون بچ"}</option>
        {choices.map((batch) => (
          <option key={`${batch.batchId}:${batch.locationId}`} value={`batch:${batch.batchId}`}>
            {batchOptionLabel(batch)}
          </option>
        ))}
        {decrease ? null : <option value="new">+ بچ جدید (ورود شماره بچ)</option>}
      </select>
      {batches === "error" ? <span className="text-[11px] text-destructive">دریافت بچ‌های این کالا ناموفق بود.</span> : null}
      {known && line.batchMode === "" ? <span className="text-[11px] text-warning">این کالا ردیابی بچ دارد؛ بچ را مشخص کنید.</span> : null}
      {decrease && line.batchMode === "new" ? <span className="text-[11px] text-destructive">برای کاهش موجودی باید بچ موجود انتخاب شود.</span> : null}
    </div>
  );
}

// BATCH_CUTOVER's single-item picker plus the live «جمع ردیف‌ها vs موجودی
// فعلی» check (the backend's BATCH_CUTOVER_QUANTITY_MISMATCH 409 at approval
// is authoritative — stock can change between drafting and approval).
function CutoverHeader({
  itemId,
  setItemId,
  itemOptions,
  lines,
  onHandByItem,
  batches,
}: {
  itemId: string;
  setItemId: (itemId: string) => void;
  itemOptions: ItemOption[];
  lines: AdjustmentLineRow[];
  onHandByItem: Map<number, string> | null;
  batches: BatchesState | undefined;
}) {
  const item = itemId ? itemOptions.find((option) => option.id === Number(itemId)) : undefined;
  const onHand = itemId && onHandByItem ? Number(onHandByItem.get(Number(itemId)) ?? "0") : null;
  const linesSum = Math.round(lines.reduce((sum, line) => sum + (Number.isFinite(parseNumberInput(line.quantity)) ? parseNumberInput(line.quantity) : 0), 0) * 100) / 100;
  const difference = onHand === null ? null : Math.round((onHand - linesSum) * 100) / 100;
  const alreadyTracked = Array.isArray(batches) && batches.length > 0;

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="flex min-w-72 flex-col gap-1">
          <Label htmlFor="cutover-item">کالا<RequiredMark /></Label>
          <select id="cutover-item" className={`${selectClass} w-full`} value={itemId} onChange={(event) => setItemId(event.target.value)}>
            <option value="">انتخاب کنید</option>
            {itemOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.code})
              </option>
            ))}
          </select>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">واحد</dt>
            <dd className="mt-0.5">{item?.unit.nameFa ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">موجودی فعلی (بدون بچ)</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{onHand === null ? "-" : formatQuantity(onHand)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">جمع ردیف‌های بچ</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatQuantity(linesSum)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">اختلاف</dt>
            <dd className={`mt-0.5 font-medium tabular-nums ${difference !== null && difference !== 0 ? "text-destructive" : "text-success"}`}>
              {difference === null ? "-" : difference === 0 ? "برابر ✓" : formatQuantity(difference)}
            </dd>
          </div>
        </dl>
      </div>
      {alreadyTracked ? (
        <p className="text-xs text-destructive">این کالا هم‌اکنون بچ دارد (ردیابی بچ آن قبلاً فعال شده است)؛ تبدیل دوباره ممکن نیست.</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        جمع ردیف‌ها باید دقیقاً با موجودی فعلی کالا در این انبار برابر باشد. این مقایسه هنگام «تأیید» سند دوباره با موجودیِ همان لحظه انجام می‌شود؛ اگر
        موجودی در این فاصله تغییر کند، تأیید رد می‌شود و باید سند را اصلاح کرد. موجودی کنترل کیفیت یا موجودی در انبارهای دیگر نیز مانع تبدیل است.
      </p>
    </div>
  );
}
