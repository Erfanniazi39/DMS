"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  customerKindLabels,
  customerStatusLabels,
  formatMoney,
  paymentMethodLabels,
  type AuditChange,
  type CustomerHistoryEntry,
  type CustomerKind,
  type CustomerStatus,
  type PaymentMethod,
  type PaymentTermOption,
  type ReferenceOption,
} from "../../shared";
import { DetailSection } from "./DetailSection";

// «تاریخچه تغییرات» — GET /customers/:id/history (customers.view): the
// customer's audit entries, newest first, including contact/address/note/
// document/complaint/financial events. Field-level changes come from
// AuditLog.changes; the national id is only ever "***" there, and
// financial diffs are withheld (changes: null) without customers.finance.

const actionLabels: Record<string, string> = {
  CUSTOMER_CREATED: "ثبت مشتری",
  CUSTOMER_UPDATED: "ویرایش اطلاعات",
  CUSTOMER_STATUS_CHANGED: "تغییر وضعیت",
  CUSTOMER_ARCHIVED: "بایگانی",
  CUSTOMER_UNARCHIVED: "خروج از بایگانی",
  CUSTOMER_FINANCIAL_UPDATED: "تغییر اطلاعات مالی",
  CUSTOMER_CONTACT_ADDED: "افزودن مخاطب",
  CUSTOMER_CONTACT_UPDATED: "ویرایش مخاطب",
  CUSTOMER_CONTACT_REMOVED: "حذف مخاطب",
  CUSTOMER_ADDRESS_ADDED: "افزودن آدرس",
  CUSTOMER_ADDRESS_UPDATED: "ویرایش آدرس",
  CUSTOMER_ADDRESS_REMOVED: "حذف آدرس",
  CUSTOMER_NOTE_ADDED: "افزودن یادداشت",
  CUSTOMER_NOTE_UPDATED: "ویرایش یادداشت",
  CUSTOMER_NOTE_REMOVED: "حذف یادداشت",
  CUSTOMER_DOCUMENT_ADDED: "افزودن مدرک",
  CUSTOMER_DOCUMENT_REMOVED: "حذف مدرک",
  CUSTOMER_DOCUMENT_FILE_ATTACHED: "بارگذاری فایل مدرک",
  CUSTOMER_DOCUMENT_FILE_REPLACED: "جایگزینی فایل مدرک",
  CUSTOMER_COMPLAINT_ADDED: "ثبت شکایت",
  CUSTOMER_COMPLAINT_UPDATED: "ویرایش شکایت",
  CUSTOMER_COMPLAINT_REMOVED: "حذف شکایت",
  // Pre-2026-10-06 entries written by the old flat customer module.
  CUSTOMER_DELETED: "حذف مشتری",
};

const fieldLabels: Record<string, string> = {
  customerKind: "نوع شخص",
  legalName: "نام ثبتی",
  nationalId: "شناسه/کد ملی",
  economicCode: "کد اقتصادی",
  customerGroupId: "گروه مشتری",
  status: "وضعیت",
  statusReason: "دلیل وضعیت",
  paymentTermId: "شرایط پرداخت",
  preferredPaymentMethod: "روش پرداخت ترجیحی",
  creditLimit: "سقف اعتبار",
  creditHold: "توقف اعتباری",
  creditHoldReason: "دلیل توقف اعتباری",
};

export function HistorySection({ customerId, reloadKey }: { customerId: number; reloadKey: number }) {
  const [entries, setEntries] = useState<CustomerHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [groups, setGroups] = useState<ReferenceOption[]>([]);
  const [terms, setTerms] = useState<PaymentTermOption[]>([]);

  useEffect(() => {
    let ignore = false;
    apiFetch<CustomerHistoryEntry[]>(`/customers/${customerId}/history`)
      .then((data) => {
        if (!ignore) {
          setEntries(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت تاریخچه ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [customerId, reloadKey, retryKey]);

  // For turning group / payment-term ids in `changes` into names.
  useEffect(() => {
    let ignore = false;
    Promise.all([apiFetch<ReferenceOption[]>("/customer-groups/all"), apiFetch<PaymentTermOption[]>("/payment-terms/all")])
      .then(([groupsData, termsData]) => {
        if (ignore) return;
        setGroups(groupsData);
        setTerms(termsData);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  function formatValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    switch (field) {
      case "customerKind":
        return customerKindLabels[value as CustomerKind] ?? String(value);
      case "status":
        return customerStatusLabels[value as CustomerStatus] ?? String(value);
      case "customerGroupId":
        return groups.find((group) => group.id === Number(value))?.nameFa ?? `#${String(value)}`;
      case "paymentTermId":
        return terms.find((term) => term.id === Number(value))?.nameFa ?? `#${String(value)}`;
      case "preferredPaymentMethod":
        return paymentMethodLabels[value as PaymentMethod] ?? String(value);
      case "creditLimit":
        return `${formatMoney(String(value))} ریال`;
      case "creditHold":
        return value === true ? "بله" : "خیر";
      default:
        return String(value);
    }
  }

  function renderChanges(changes: AuditChange[] | null, action: string) {
    if (changes === null && action === "CUSTOMER_FINANCIAL_UPDATED") {
      return <span className="text-xs text-muted-foreground">جزئیات فقط برای کاربران دارای دسترسی مالی نمایش داده می‌شود.</span>;
    }
    if (!changes || changes.length === 0) return null;
    return (
      <ul className="space-y-0.5 text-xs">
        {changes.map((change) => (
          <li key={change.field}>
            <span className="text-muted-foreground">{fieldLabels[change.field] ?? change.field}:</span>{" "}
            <span>{formatValue(change.field, change.from)}</span>
            <span className="mx-1 text-muted-foreground">←</span>
            <span className="font-medium">{formatValue(change.field, change.to)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DetailSection title="تاریخچه تغییرات">
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">تغییری ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[40rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">زمان</th>
                <th className="px-3 py-2 font-medium">کاربر</th>
                <th className="px-3 py-2 font-medium">رویداد</th>
                <th className="px-3 py-2 font-medium">جزئیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {formatJalali(entry.createdAt)}{" "}
                    <span className="tabular-nums">
                      {new Date(entry.createdAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{entry.user?.username ?? "-"}</td>
                  <td className="px-3 py-2">{actionLabels[entry.action] ?? entry.action}</td>
                  <td className="px-3 py-2">
                    {entry.details ? <span className="block text-xs text-muted-foreground">{entry.details}</span> : null}
                    {renderChanges(entry.changes, entry.action)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DetailSection>
  );
}
