"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseNumberInput } from "@/lib/number-input";
import { RequiredMark, formatMoney, selectClass, type UnitOption } from "../shared";
import { FormSection } from "./FormSection";

export type ItemFormRow = {
  key: string;
  name: string;
  quantity: string;
  unitId: string;
  unitPrice: string;
  totalPrice: string;
  // Set when this line was pre-filled from (or, in edit mode, was already
  // linked to) a Purchase Request item — see the "ایجاد خرید"/"خرید
  // باقی‌مانده" actions on the Purchase Request detail page. Empty for a
  // normal, manually-added line.
  purchaseRequestItemId: string;
};

export function emptyItemRow(): ItemFormRow {
  return { key: crypto.randomUUID(), name: "", quantity: "", unitId: "", unitPrice: "", totalPrice: "", purchaseRequestItemId: "" };
}

// Section 2 — اقلام خرید. The rows live in PurchaseForm's form state;
// `setItems` applies an updater to just `form.items` (same functional
// update the form used inline). `itemsTotal` is computed by the parent,
// which also shows it in the sticky footer.
export function ItemsGrid({
  items,
  setItems,
  units,
  itemsTotal,
}: {
  items: ItemFormRow[];
  setItems: (update: (current: ItemFormRow[]) => ItemFormRow[]) => void;
  units: UnitOption[];
  itemsTotal: number;
}) {
  function updateItem(key: string, patch: Partial<ItemFormRow>) {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        // Auto-suggest the line total from quantity × unit price whenever
        // either changes — still a plain, directly-editable field
        // afterwards. The backend never enforces this (Total Price is a
        // stored field, not a derived one), so a user free to override it
        // for a case where the arithmetic doesn't apply.
        if (("quantity" in patch || "unitPrice" in patch) && !("totalPrice" in patch)) {
          const quantity = parseNumberInput(next.quantity);
          const unitPrice = parseNumberInput(next.unitPrice);
          if (next.quantity !== "" && next.unitPrice !== "" && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
            next.totalPrice = String(Math.round(quantity * unitPrice));
          }
        }
        return next;
      }),
    );
  }

  function addItemRow() {
    setItems((current) => [...current, emptyItemRow()]);
  }

  function removeItemRow(key: string) {
    setItems((current) => (current.length > 1 ? current.filter((item) => item.key !== key) : current));
  }

  return (
    <FormSection title="اقلام خرید" description="نام قلم متن آزاد است و به کاتالوگ اقلام شرکت مرتبط نمی‌شود.">
      <div className="space-y-2">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[48rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">نام / شرح<RequiredMark /></th>
                <th className="w-28 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                <th className="w-36 px-2 py-1.5 font-medium">واحد<RequiredMark /></th>
                <th className="w-40 px-2 py-1.5 font-medium">قیمت واحد</th>
                <th className="w-40 px-2 py-1.5 font-medium">قیمت کل<RequiredMark /></th>
                <th className="w-12 px-2 py-1.5 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.key}>
                  <td className="px-2 py-1">
                    <Input
                      aria-label="نام یا شرح قلم"
                      value={item.name}
                      onChange={(event) => updateItem(item.key, { name: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label="مقدار"
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      aria-label="واحد"
                      className={`${selectClass} w-full`}
                      value={item.unitId}
                      onChange={(event) => updateItem(item.key, { unitId: event.target.value })}
                    >
                      <option value="">-</option>
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.nameFa}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label="قیمت واحد"
                      inputMode="decimal"
                      placeholder="-"
                      value={item.unitPrice}
                      onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label="قیمت کل"
                      inputMode="decimal"
                      value={item.totalPrice}
                      onChange={(event) => updateItem(item.key, { totalPrice: event.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="حذف قلم"
                      onClick={() => removeItemRow(item.key)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30 font-medium">
                <td className="px-2 py-1.5" colSpan={4}>جمع کل اقلام</td>
                <td className="px-2 py-1.5 tabular-nums">{formatMoney(itemsTotal)} ریال</td>
                <td className="px-2 py-1.5"></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItemRow}>
          <Plus className="size-4" aria-hidden="true" />
          افزودن قلم
        </Button>
      </div>
    </FormSection>
  );
}
