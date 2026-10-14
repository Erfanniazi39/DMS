"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "@/components/ui/form-field";
import { normalizeDigits } from "@/lib/number-input";

// Transfer-receipt info (2026-10-13) shared by the customer receipt/refund
// dialogs and the purchase payment dialog. Informational only — it never
// changes any total or status. Mirrors backend common/payment-receipt-fields.ts.

// Fixed list for now (owner decision); keep in sync with the backend.
export const PAYMENT_TRANSACTION_TYPES = ["پایا", "ساتنا", "کارت به کارت", "انتقال داخلی", "واریز نقدی", "کارتخوان"] as const;

export type TransactionInfo = {
  transactionTime: string;
  transactionType: string;
  depositId: string;
  withdrawalId: string;
  sourceAccount: string;
  destinationAccount: string;
  destinationAccountHolder: string;
};

export const emptyTransactionInfo: TransactionInfo = {
  transactionTime: "",
  transactionType: "",
  depositId: "",
  withdrawalId: "",
  sourceAccount: "",
  destinationAccount: "",
  destinationAccountHolder: "",
};

type InfoRow = { [K in keyof TransactionInfo]?: string | null };

export function transactionInfoFromRow(row: InfoRow): TransactionInfo {
  return {
    transactionTime: row.transactionTime ?? "",
    transactionType: row.transactionType ?? "",
    depositId: row.depositId ?? "",
    withdrawalId: row.withdrawalId ?? "",
    sourceAccount: row.sourceAccount ?? "",
    destinationAccount: row.destinationAccount ?? "",
    destinationAccountHolder: row.destinationAccountHolder ?? "",
  };
}

// Request-body fields (blank = cleared/omitted, the backend's convention).
export function transactionInfoPayload(info: TransactionInfo) {
  return {
    transactionTime: normalizeDigits(info.transactionTime).trim(),
    transactionType: info.transactionType,
    depositId: info.depositId.trim(),
    withdrawalId: info.withdrawalId.trim(),
    sourceAccount: info.sourceAccount.trim(),
    destinationAccount: info.destinationAccount.trim(),
    destinationAccountHolder: info.destinationAccountHolder.trim(),
  };
}

export function transactionInfoErrors(info: TransactionInfo): string[] {
  const time = normalizeDigits(info.transactionTime).trim();
  return time && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time) ? ["ساعت تراکنش معتبر نیست (قالب ۱۴:۳۰)."] : [];
}

export type DestinationOption = { key: string; label: string; account: string; holder: string };

// The «اطلاعات تراکنش» block. Collapsed by default unless something is
// filled (`defaultOpen`); `destinations` (optional) lets the user fill the
// destination account from the counterparty's registered bank accounts —
// the value is still stored as free text, never linked.
export function TransactionInfoFields({
  idPrefix,
  value,
  onChange,
  defaultOpen,
  destinations,
  leading,
}: {
  idPrefix: string;
  value: TransactionInfo;
  onChange: (next: TransactionInfo) => void;
  defaultOpen?: boolean;
  destinations?: DestinationOption[];
  // Extra field(s) shown first inside the block (e.g. the historical-sales payment date).
  leading?: ReactNode;
}) {
  function set<K extends keyof TransactionInfo>(key: K, next: string) {
    onChange({ ...value, [key]: next });
  }
  const filled = Object.values(value).some((entry) => entry.trim() !== "");
  return (
    <details className="rounded-md border border-border" open={defaultOpen || filled}>
      <summary className="cursor-pointer select-none bg-muted/30 px-3 py-2 text-sm font-medium">اطلاعات تراکنش (اختیاری)</summary>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        {leading}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-tx-type`}>نوع تراکنش</Label>
          <select id={`${idPrefix}-tx-type`} className={selectClass} value={value.transactionType} onChange={(event) => set("transactionType", event.target.value)}>
            <option value="">—</option>
            {PAYMENT_TRANSACTION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-tx-time`}>ساعت تراکنش</Label>
          <Input id={`${idPrefix}-tx-time`} dir="ltr" inputMode="numeric" placeholder="14:30" value={value.transactionTime} onChange={(event) => set("transactionTime", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-deposit-id`}>شناسه واریز</Label>
          <Input id={`${idPrefix}-deposit-id`} dir="ltr" value={value.depositId} onChange={(event) => set("depositId", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-withdrawal-id`}>شناسه برداشت</Label>
          <Input id={`${idPrefix}-withdrawal-id`} dir="ltr" value={value.withdrawalId} onChange={(event) => set("withdrawalId", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-source`}>حساب مبدأ</Label>
          <Input id={`${idPrefix}-source`} dir="ltr" value={value.sourceAccount} onChange={(event) => set("sourceAccount", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-destination`}>حساب مقصد</Label>
          <Input id={`${idPrefix}-destination`} dir="ltr" value={value.destinationAccount} onChange={(event) => set("destinationAccount", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-holder`}>صاحب حساب مقصد</Label>
          <Input id={`${idPrefix}-holder`} value={value.destinationAccountHolder} onChange={(event) => set("destinationAccountHolder", event.target.value)} />
        </div>
        {destinations && destinations.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-dest-pick`}>پر کردن از حساب‌های ثبت‌شده</Label>
            <select
              id={`${idPrefix}-dest-pick`}
              className={selectClass}
              value=""
              onChange={(event) => {
                const option = destinations.find((entry) => entry.key === event.target.value);
                if (option) onChange({ ...value, destinationAccount: option.account, destinationAccountHolder: option.holder || value.destinationAccountHolder });
              }}
            >
              <option value="">— انتخاب —</option>
              {destinations.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </details>
  );
}
