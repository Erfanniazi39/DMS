"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatJalali } from "@/lib/jalali";
import {
  customerKindLabels,
  hasDefaultDeliveryAddress,
  maskNationalId,
  nationalIdLabel,
  type CustomerDetail,
} from "../../shared";
import { DetailSection } from "./DetailSection";

// Identity / classification / communication, plus "missing data"
// indicators (no national id, no default delivery address, no payment term).
// The national id is masked until explicitly revealed (sensitive field).
export function OverviewSection({ customer }: { customer: CustomerDetail }) {
  const [revealNationalId, setRevealNationalId] = useState(false);

  const missing = [
    !customer.nationalId ? `${nationalIdLabel[customer.customerKind]} ثبت نشده است` : null,
    !hasDefaultDeliveryAddress(customer) ? "آدرس پیش‌فرض تحویل کالا ثبت نشده است" : null,
    !customer.financialSummary.hasPaymentTerm ? "شرایط پرداخت تعیین نشده است (فقط نقدی)" : null,
  ].filter((item): item is string => item !== null);

  return (
    <DetailSection title="اطلاعات مشتری">
      <div className="space-y-4">
        {missing.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {missing.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs">
                <AlertCircle className="size-3.5 text-warning" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">شماره مشتری</dt>
            <dd className="mt-1 font-mono">{customer.customerNumber}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">نوع شخص</dt>
            <dd className="mt-1">{customerKindLabels[customer.customerKind]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{customer.customerKind === "ORGANIZATION" ? "نام ثبتی (حقوقی)" : "نام کامل (مطابق مدارک)"}</dt>
            <dd className="mt-1">{customer.legalName || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{nationalIdLabel[customer.customerKind]}</dt>
            <dd className="mt-1 flex items-center gap-1">
              <span className="font-mono tabular-nums" dir="ltr">
                {revealNationalId ? customer.nationalId ?? "-" : maskNationalId(customer.nationalId)}
              </span>
              {customer.nationalId ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={revealNationalId ? "پنهان کردن" : "نمایش"}
                  onClick={() => setRevealNationalId((current) => !current)}
                >
                  {revealNationalId ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">کد اقتصادی</dt>
            <dd className="mt-1 font-mono" dir="ltr"><span className="block text-right">{customer.economicCode || "-"}</span></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">کد قدیمی</dt>
            <dd className="mt-1 font-mono text-muted-foreground">{customer.legacyCode || "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">گروه مشتری</dt>
            <dd className="mt-1">{customer.customerGroup.nameFa}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">منطقه فروش</dt>
            <dd className="mt-1">{customer.territory?.nameFa ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">تلفن</dt>
            <dd className="mt-1 tabular-nums" dir="ltr"><span className="block text-right">{customer.phone}</span></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ایمیل</dt>
            <dd className="mt-1" dir="ltr"><span className="block text-right">{customer.email || "-"}</span></dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">تاریخ ثبت</dt>
            <dd className="mt-1">{formatJalali(customer.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ثبت‌کننده</dt>
            <dd className="mt-1">{customer.createdByUser?.username ?? "-"}</dd>
          </div>
        </dl>
      </div>
    </DetailSection>
  );
}
