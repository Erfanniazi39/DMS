"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFeature } from "@/lib/session";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useAdminUser } from "@/app/admin/layout";
import { customerKindLabels, customerStatusLabels, customerStatusTone, type CustomerStatus } from "../../customers/shared";
import type { CustomerContext } from "../shared";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
const ltr = (value: string | null | undefined) => (value ? <bdi dir="ltr">{value}</bdi> : "-");

// Read-only facts about the selected customer, from GET
// /sales-orders/customer-context/:id: identity (name, number, status, kind,
// group), contact details (phones, e-mail, primary contact), the tax ids,
// the payment term (taken from the customer's financial profile — never
// chosen on the order), the receivable balance (only with receivables.view —
// the same endpoint the customer page uses) and — only when the backend
// includes them (sales.approve / customers.finance) — the credit figures.
// Informational; the backend re-checks the customer gate and credit at
// confirmation.
export function CustomerPanel({ context, loading, error }: { context: CustomerContext | null; loading: boolean; error: string | null }) {
  const paymentTermsOn = useFeature("paymentTerms");
  const canSeeBalance = useAdminUser()?.permissions.includes("receivables.view") ?? false;
  const customerId = context?.customer.id ?? null;
  const [balance, setBalance] = useState<{ customerId: number; value: number } | null>(null);

  useEffect(() => {
    if (!canSeeBalance || customerId === null) return;
    let ignore = false;
    apiFetch<{ balance: string }>(`/receivables/customers/${customerId}/balance`)
      .then((data) => {
        if (!ignore) setBalance({ customerId, value: Number(data.balance) });
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [canSeeBalance, customerId]);

  if (loading) return <p className="text-xs text-muted-foreground">در حال دریافت اطلاعات مشتری...</p>;
  if (error) return <p className="text-xs text-destructive" role="alert">{error}</p>;
  if (!context) return <p className="text-xs text-muted-foreground">پس از انتخاب مشتری، اطلاعات و آدرس‌های او نمایش داده می‌شود.</p>;

  const { customer } = context;
  const balanceValue = balance?.customerId === customer.id ? balance.value : null;
  const contact = customer.primaryContact;

  return (
    <div className="space-y-2">
      {context.creditHold ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <Ban className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>این مشتری در توقف اعتباری است؛ ثبت و تأیید سفارش برای او ممکن نیست.</span>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4">
        <Item label="نام مشتری">{[customer.title, customer.name].filter(Boolean).join(" ")}</Item>
        <Item label="شماره مشتری"><span className="font-mono">{customer.customerNumber}</span></Item>
        <Item label="وضعیت">
          <StatusBadge label={customerStatusLabels[customer.status as CustomerStatus] ?? customer.status} tone={customerStatusTone[customer.status as CustomerStatus] ?? "muted"} />
        </Item>
        <Item label="نوع شخص">{customerKindLabels[customer.customerKind]}</Item>
        <Item label="گروه مشتری">{customer.groupName || "-"}</Item>
        {customer.legalName ? <Item label="نام ثبتی">{customer.legalName}</Item> : null}
        <Item label="کد اقتصادی">{ltr(customer.economicCode)}</Item>
        {customer.registrationNumber ? <Item label="شماره ثبت">{ltr(customer.registrationNumber)}</Item> : null}
        <Item label="تلفن">{ltr(customer.phone)}</Item>
        {customer.phone2 ? <Item label="تلفن ۲">{ltr(customer.phone2)}</Item> : null}
        <Item label="موبایل">{ltr(customer.mobile)}</Item>
        <Item label="ایمیل">{ltr(customer.email)}</Item>
        {contact ? (
          <Item label="مسئول اصلی">
            {contact.name}
            {contact.roleTitle ? <span className="text-muted-foreground"> ({contact.roleTitle})</span> : null}
            {contact.mobile || contact.phone ? <span className="text-muted-foreground"> — {ltr(contact.mobile || contact.phone)}</span> : null}
          </Item>
        ) : null}
        {paymentTermsOn ? (
          <Item label="شرایط پرداخت">
            {context.paymentTerm ? `${context.paymentTerm.nameFa} (${context.paymentTerm.dueDays.toLocaleString("fa-IR")} روز)` : "تعریف نشده"}
          </Item>
        ) : null}
        {balanceValue !== null ? (
          <Item label="مانده حساب مشتری">
            <span className={`tabular-nums ${balanceValue > 0 ? "text-destructive" : balanceValue < 0 ? "text-warning" : "text-success"}`}>
              {formatMoney(Math.abs(balanceValue))} ریال{balanceValue > 0 ? " (بدهکار)" : balanceValue < 0 ? " (در اعتبار مشتری)" : ""}
            </span>
          </Item>
        ) : null}
        {context.credit ? (
          <>
            <Item label="سقف اعتبار">
              <span className="tabular-nums">{context.credit.creditLimit === null ? "تعریف نشده (فقط فروش نقدی)" : `${formatMoney(context.credit.creditLimit)} ریال`}</span>
            </Item>
            <Item label="تعهدات باز فعلی"><span className="tabular-nums">{formatMoney(context.credit.exposure)} ریال</span></Item>
            <Item label="مانده اعتبار">
              <span className={`tabular-nums ${Number(context.credit.available) < 0 ? "text-destructive" : ""}`}>{formatMoney(context.credit.available)} ریال</span>
            </Item>
          </>
        ) : null}
      </dl>
    </div>
  );
}
