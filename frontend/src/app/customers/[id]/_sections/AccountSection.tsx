"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney, StatusBadge } from "../../shared";
import { DetailSection } from "./DetailSection";

type OpenInvoiceRow = { id: number; invoiceNumber: string | null; dueDate: string | null; totalAmount: string; openAmount: string };
type StatementEntry = {
  id: number;
  date: string;
  kind: "INVOICE" | "RECEIPT" | "REFUND";
  amount: string;
  settled: boolean;
  runningBalance: string | null;
  number: string | null;
  note: string | null;
};

const kindLabels: Record<StatementEntry["kind"], string> = { INVOICE: "فاکتور", RECEIPT: "دریافت", REFUND: "بازپرداخت" };

// «حساب مشتری» — balance, open invoices, and (on demand) the full
// chronological statement. Calls /receivables/... directly (build plan §4's
// explicit requirement: no backend Customers→Receivables dependency) and is
// gated on receivables.view, a permission the Customers module itself knows
// nothing about — hidden entirely for a user without it.
export function AccountSection({ customerId, canViewReceivables }: { customerId: number; canViewReceivables: boolean }) {
  const [balance, setBalance] = useState<string | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statement, setStatement] = useState<StatementEntry[] | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);

  useEffect(() => {
    if (!canViewReceivables) return;
    let ignore = false;
    Promise.all([
      apiFetch<{ balance: string }>(`/receivables/customers/${customerId}/balance`),
      apiFetch<OpenInvoiceRow[]>(`/receivables/customers/${customerId}/open-invoices`),
    ])
      .then(([balanceData, open]) => {
        if (ignore) return;
        setBalance(balanceData.balance);
        setOpenInvoices(open);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت حساب مشتری ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [customerId, canViewReceivables]);

  function toggleStatement() {
    if (statementOpen) {
      setStatementOpen(false);
      return;
    }
    setStatementOpen(true);
    if (statement !== null) return;
    setStatementLoading(true);
    apiFetch<StatementEntry[]>(`/receivables/customers/${customerId}/statement`)
      .then(setStatement)
      .catch(() => setStatement([]))
      .finally(() => setStatementLoading(false));
  }

  if (!canViewReceivables) {
    return (
      <DetailSection title="حساب مشتری">
        <p className="text-sm text-muted-foreground">مشاهدهٔ حساب مشتری نیازمند دسترسی «مشاهده مطالبات» است.</p>
      </DetailSection>
    );
  }

  const balanceNumber = balance !== null ? Number(balance) : 0;

  return (
    <DetailSection
      title="حساب مشتری"
      action={
        <Button size="sm" variant="outline" onClick={toggleStatement}>
          {statementOpen ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
          نمایش صورت‌حساب کامل
        </Button>
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <p className="py-4 text-center text-sm text-destructive" role="alert">{loadError}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="text-xs text-muted-foreground">مانده حساب (بدهکار مشتری به شرکت)</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${balanceNumber > 0 ? "text-destructive" : balanceNumber < 0 ? "text-warning" : "text-success"}`}>
              {formatMoney(Math.abs(balanceNumber))} ریال {balanceNumber < 0 ? "(در اعتبار مشتری)" : null}
            </p>
          </div>

          {openInvoices.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">فاکتور بازی ندارد.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">شماره فاکتور</th>
                    <th className="px-3 py-2 font-medium">سررسید</th>
                    <th className="px-3 py-2 font-medium">مانده</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {openInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/sales-invoices/${invoice.id}`} className="text-primary hover:underline">{invoice.invoiceNumber ?? `#${invoice.id}`}</Link>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{invoice.dueDate ? formatJalali(invoice.dueDate) : "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{formatMoney(invoice.openAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {statementOpen ? (
            <div className="overflow-x-auto rounded-md border border-border">
              {statementLoading ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">در حال بارگذاری صورت‌حساب...</p>
              ) : !statement || statement.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">رویدادی ثبت نشده است.</p>
              ) : (
                <table className="w-full text-right text-xs">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">تاریخ</th>
                      <th className="px-3 py-2 font-medium">نوع</th>
                      <th className="px-3 py-2 font-medium">شماره</th>
                      <th className="px-3 py-2 font-medium">مبلغ</th>
                      <th className="px-3 py-2 font-medium">مانده پس از رویداد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {statement.map((entry) => (
                      <tr key={`${entry.kind}-${entry.id}`}>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(entry.date)}</td>
                        <td className="px-3 py-2">{kindLabels[entry.kind]}</td>
                        <td className="px-3 py-2 font-mono">{entry.number ?? "-"}</td>
                        <td className="px-3 py-2 tabular-nums">{formatMoney(Math.abs(Number(entry.amount)))}</td>
                        <td className="px-3 py-2">
                          {entry.settled ? (
                            <span className="tabular-nums">{formatMoney(entry.runningBalance)}</span>
                          ) : (
                            <StatusBadge label={entry.note ?? "در مانده حساب نیست"} tone="warning" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : null}
        </div>
      )}
    </DetailSection>
  );
}
