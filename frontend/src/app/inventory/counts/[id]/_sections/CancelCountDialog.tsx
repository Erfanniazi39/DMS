"use client";

import { type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { stockCountTitle, type StockCountDetail } from "../../../shared";

// Cancel reason dialog (DRAFT/COUNTING/REVIEW → CANCELLED), same shape as
// adjustments/[id]/page.tsx's reject dialog.
export function CancelCountDialog({
  count,
  open,
  reason,
  saving,
  onReasonChange,
  onClose,
  onSubmit,
}: {
  count: StockCountDetail;
  open: boolean;
  reason: string;
  saving: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : !saving && onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>لغو سند شمارش</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="stock-count-cancel-form" className="grid gap-3 text-sm" onSubmit={onSubmit} noValidate>
            <p className="text-muted-foreground">سند «{stockCountTitle(count)}» لغو می‌شود. این عمل برگشت‌پذیر نیست.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="count-cancel-reason-input">
                علت لغو
                <RequiredMark />
              </Label>
              <textarea id="count-cancel-reason-input" className={textareaClass} value={reason} maxLength={500} onChange={(event) => onReasonChange(event.target.value)} />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="stock-count-cancel-form" variant="destructive" disabled={saving}>
            {saving ? "در حال لغو..." : "لغو سند"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
