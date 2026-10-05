"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { purchaseRequestStatusLabels, purchaseRequestStatusTone } from "@/app/purchase-requests/shared";
import { StatusBadge, purchaseRequestOptionLabel, selectClass, type PurchaseRequestPickerOption } from "../shared";

// The "درخواست خرید مرتبط" picker plus its overwrite-confirmation banner.
// Purely presentational: every piece of state (the selected request,
// pendingPurchaseRequestId, the loading flag) and every handler
// (handlePurchaseRequestChange / applyPurchaseRequestChange /
// confirmPurchaseRequestOverwrite, the race-guard token) stays in
// PurchaseForm.tsx and is passed in unchanged.
//
// DO NOT turn the confirmation below into a Dialog/Portal/modal or a
// window.confirm() — both were tried and both broke the page (see the
// comment on pendingPurchaseRequestId in PurchaseForm.tsx and
// docs/project-knowledge-archive.md §18.3). It must stay a plain inline
// banner, and the Select must stay disabled while it is showing.
export function RequestPicker({
  value,
  purchaseRequests,
  sortedPurchaseRequests,
  loadingItems,
  pendingPurchaseRequestId,
  onChange,
  onConfirmOverwrite,
  onCancelOverwrite,
}: {
  // form.purchaseRequestId ("" = none).
  value: string;
  // Every request loaded for the form — used to label the current value.
  purchaseRequests: PurchaseRequestPickerOption[];
  // The eligible, sorted list offered in the popup.
  sortedPurchaseRequests: PurchaseRequestPickerOption[];
  loadingItems: boolean;
  pendingPurchaseRequestId: string | null;
  onChange: (value: string) => void;
  onConfirmOverwrite: () => void;
  onCancelOverwrite: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor="purchase-request">درخواست خرید مرتبط</Label>
      {/* A custom popup instead of a native <select> — a plain
          <option> can't carry a colored status badge, and the
          status (whether it's actually worth buying against
          right now) is the main thing this picker needs to
          communicate. Sorted via sortedPurchaseRequests so
          APPROVED/PARTIALLY_PURCHASED requests float to the top. */}
      <SelectPrimitive.Root
        value={value || null}
        onValueChange={(next) => onChange(next ? String(next) : "")}
        disabled={loadingItems || pendingPurchaseRequestId !== null}
      >
        <SelectPrimitive.Trigger id="purchase-request" className={`${selectClass} flex w-full items-center justify-between gap-2`}>
          <SelectPrimitive.Value placeholder="بدون درخواست خرید" className="min-w-0 flex-1 truncate text-right">
            {(selectedValue: string | null) => {
              const selected = selectedValue ? purchaseRequests.find((request) => String(request.id) === selectedValue) : undefined;
              return selected ? purchaseRequestOptionLabel(selected) : "بدون درخواست خرید";
            }}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
            <ChevronDown className="size-4" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner className="z-50" sideOffset={4}>
            <SelectPrimitive.Popup className="max-h-72 w-(--anchor-width) overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg">
              <SelectPrimitive.Item className="flex cursor-pointer items-center rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted">
                <SelectPrimitive.ItemText>بدون درخواست خرید</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
              {sortedPurchaseRequests.map((request) => (
                <SelectPrimitive.Item
                  key={request.id}
                  value={String(request.id)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                >
                  <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
                    {purchaseRequestOptionLabel(request)}
                  </SelectPrimitive.ItemText>
                  <StatusBadge label={purchaseRequestStatusLabels[request.status]} tone={purchaseRequestStatusTone[request.status]} />
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {/* Plain inline banner, not a modal — see the comment at the top of
          this file and on pendingPurchaseRequestId in PurchaseForm.tsx. */}
      {pendingPurchaseRequestId !== null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
          <span className="flex-1 text-foreground">
            اقلام فعلی فرم با اقلام این درخواست خرید جایگزین می‌شود. ادامه می‌دهید؟
          </span>
          <Button type="button" size="sm" onClick={onConfirmOverwrite}>
            جایگزین کن
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancelOverwrite}>
            انصراف
          </Button>
        </div>
      ) : null}
    </div>
  );
}
