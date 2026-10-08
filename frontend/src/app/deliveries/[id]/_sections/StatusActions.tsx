"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, type ApiError } from "@/lib/api";
import { CUSTOMER_CREDIT_HOLD, NEGATIVE_STOCK, STOCK_RESERVED_FOR_OTHERS, deliveryTitle, type DeliveryDetail } from "../../shared";

export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};

// The delivery's action buttons (page header). Same dedicated-action
// pattern as sales-orders/[id]/_sections/StatusActions.tsx:
//   DRAFT  → «ثبت حواله» (POST :id/post, sales.deliver) — one-way; assigns
//            the DN number, issues the stock and updates the order's
//            delivered quantities. A stock block (409 NEGATIVE_STOCK /
//            STOCK_RESERVED_FOR_OTHERS) or a customer credit hold (409
//            CUSTOMER_CREDIT_HOLD) is shown inside the dialog — there is no
//            override. Plus «ویرایش» / «حذف» (sales.deliver).
//   POSTED → nothing but «چاپ» — a posted delivery is immutable.
// The dialog is opened from a button (never from a Select callback). The call
// sends the page's updatedAt; RECORD_MODIFIED disables further actions until
// the page is reloaded.
export function StatusActions({
  delivery,
  onUpdated,
  canDeliver,
  staleRecord,
  setStaleRecord,
  toasts,
}: {
  delivery: DeliveryDetail;
  onUpdated: (delivery: DeliveryDetail) => void;
  canDeliver: boolean;
  staleRecord: boolean;
  setStaleRecord: (stale: boolean) => void;
  toasts: SectionToasts;
}) {
  const router = useRouter();
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [open, setOpen] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isDraft = delivery.status === "DRAFT";
  const showDraftActions = canDeliver && isDraft;
  const disabled = staleRecord || saving || deleting;

  function closeDialog() {
    if (saving) return;
    setOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await apiFetch<DeliveryDetail>(`/deliveries/${delivery.id}/post`, {
        method: "POST",
        body: JSON.stringify({ updatedAt: delivery.updatedAt }),
      });
      onUpdated(updated);
      pushSuccess(`حواله ${updated.deliveryNumber ?? ""} ثبت شد و کالا از انبار خارج شد.`);
      setOpen(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.code === NEGATIVE_STOCK || error.code === STOCK_RESERVED_FOR_OTHERS) {
        setStockError(error.message);
      } else if (error.code === CUSTOMER_CREDIT_HOLD) {
        setHoldError(error.message);
      } else {
        if (error.code === "RECORD_MODIFIED") {
          setStaleRecord(true);
          setOpen(false);
        }
        if (error.messages?.length) pushErrors(error.messages);
        else pushError(error.message ?? "ثبت حواله ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`آیا از حذف «${deliveryTitle(delivery)}» مطمئن هستید؟`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/deliveries/${delivery.id}`, { method: "DELETE" });
      router.push(`/sales-orders/${delivery.salesOrderId}`);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف حواله ناموفق بود.");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {showDraftActions ? (
          <>
            <Button
              variant="success"
              disabled={disabled}
              onClick={() => {
                setStockError(null);
                setHoldError(null);
                setOpen(true);
              }}
            >
              ثبت حواله
            </Button>
            <Button variant="outline" disabled={disabled} onClick={() => router.push(`/deliveries/${delivery.id}/edit`)}>ویرایش</Button>
            <Button variant="destructive" disabled={disabled} onClick={() => void remove()}>{deleting ? "در حال حذف..." : "حذف"}</Button>
          </>
        ) : null}
        <Link href={`/deliveries/${delivery.id}/print`} className={buttonVariants({ variant: "outline" })}>
          <Printer className="size-4" aria-hidden="true" />
          چاپ
        </Link>
      </div>

      <Dialog open={open} onOpenChange={(isOpen) => (isOpen ? undefined : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ثبت حواله تحویل</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="delivery-post-form" className="grid gap-3 text-sm" onSubmit={submit} noValidate>
              {holdError ? (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="space-y-1">
                    <p>{holdError}</p>
                    <p className="text-xs text-muted-foreground">تا رفع توقف اعتباری مشتری (در پروندهٔ مالی مشتری) امکان ثبت این حواله وجود ندارد.</p>
                  </div>
                </div>
              ) : stockError ? (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <div className="space-y-1">
                    <p>{stockError}</p>
                    <p className="text-xs text-muted-foreground">موجودی منفی مجاز نیست. مقدار حواله را اصلاح کنید یا پس از ثبت رسید موجودی دوباره تلاش کنید.</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  با ثبت، شماره حواله تخصیص می‌یابد، کالا از موجودی انبار خارج می‌شود (ابتدا از رزرو این سفارش) و مقدار تحویل‌شدهٔ سفارش به‌روز می‌شود. اگر
                  موجودی کافی نباشد، ثبت انجام نمی‌شود. حوالهٔ ثبت‌شده قابل ویرایش یا حذف نیست.
                </p>
              )}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="delivery-post-form" variant="success" disabled={saving}>
              {saving ? "در حال ثبت..." : stockError || holdError ? "تلاش دوباره" : "ثبت حواله"}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
