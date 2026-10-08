"use client";

import { Ban } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { CustomerContext } from "../shared";

// Read-only facts about the selected customer, from GET
// /sales-orders/customer-context/:id: payment term (always taken from the
// customer's financial profile — never chosen on the order), credit hold,
// and — only when the backend includes them (sales.approve /
// customers.finance) — the credit figures. Informational; the backend
// re-checks the customer gate and credit at confirmation.
export function CustomerPanel({ context, loading, error }: { context: CustomerContext | null; loading: boolean; error: string | null }) {
  if (loading) return <p className="text-xs text-muted-foreground">در حال دریافت اطلاعات مشتری...</p>;
  if (error) return <p className="text-xs text-destructive" role="alert">{error}</p>;
  if (!context) return <p className="text-xs text-muted-foreground">پس از انتخاب مشتری، شرایط پرداخت و آدرس‌های او نمایش داده می‌شود.</p>;

  return (
    <div className="space-y-2">
      {context.creditHold ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <Ban className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>این مشتری در توقف اعتباری است؛ ثبت و تأیید سفارش برای او ممکن نیست.</span>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs md:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">شماره مشتری</dt>
          <dd className="mt-0.5 font-mono">{context.customer.customerNumber}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">کد اقتصادی</dt>
          <dd className="mt-0.5">{context.customer.economicCode || "-"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">شرایط پرداخت</dt>
          <dd className="mt-0.5">
            {context.paymentTerm ? `${context.paymentTerm.nameFa} (${context.paymentTerm.dueDays.toLocaleString("fa-IR")} روز)` : "تعریف نشده"}
          </dd>
        </div>
        {context.credit ? (
          <>
            <div>
              <dt className="text-muted-foreground">سقف اعتبار</dt>
              <dd className="mt-0.5 tabular-nums">{context.credit.creditLimit === null ? "تعریف نشده (فقط فروش نقدی)" : `${formatMoney(context.credit.creditLimit)} ریال`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">تعهدات باز فعلی</dt>
              <dd className="mt-0.5 tabular-nums">{formatMoney(context.credit.exposure)} ریال</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">مانده اعتبار</dt>
              <dd className={`mt-0.5 tabular-nums ${Number(context.credit.available) < 0 ? "text-destructive" : ""}`}>{formatMoney(context.credit.available)} ریال</dd>
            </div>
          </>
        ) : null}
      </dl>
    </div>
  );
}
