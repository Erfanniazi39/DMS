"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { apiFetch, type ApiError } from "@/lib/api";
import { kindLabels, nationalIdLabel, statusLabels, type SupplierDetail, type SupplierStatus } from "../../suppliers/_sections/shared";

const statusTone: Record<SupplierStatus, BadgeTone> = { active: "success", inactive: "muted", blacklisted: "destructive" };

function Item({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
const ltr = (value: string | null | undefined) => (value ? <bdi dir="ltr">{value}</bdi> : "-");

// Read-only main facts about the chosen supplier (GET /suppliers/:id,
// suppliers.view — the same permission the purchase form's supplier list
// already needs): identity (name, code, status, kind), tax ids, contact
// details, address, the purchase types and goods it supplies, and its default
// bank account. Informational only — nothing here is submitted with the
// purchase. The purchases twin of sales-orders/_form/CustomerPanel.tsx.
export function SupplierPanel({ supplierId }: { supplierId: number | null }) {
  const [loaded, setLoaded] = useState<{ supplierId: number; supplier: SupplierDetail | null; error: string | null } | null>(null);

  useEffect(() => {
    if (supplierId === null) return;
    let ignore = false;
    apiFetch<SupplierDetail>(`/suppliers/${supplierId}`)
      .then((supplier) => {
        if (!ignore) setLoaded({ supplierId, supplier, error: null });
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoaded({ supplierId, supplier: null, error: (reason as ApiError).message ?? "دریافت اطلاعات تأمین‌کننده ناموفق بود." });
      });
    return () => {
      ignore = true;
    };
  }, [supplierId]);

  if (supplierId === null) return <p className="text-xs text-muted-foreground">پس از انتخاب تأمین‌کننده، اطلاعات او نمایش داده می‌شود.</p>;
  if (loaded?.supplierId !== supplierId) return <p className="text-xs text-muted-foreground">در حال دریافت اطلاعات تأمین‌کننده...</p>;
  if (loaded.error || !loaded.supplier) return <p className="text-xs text-destructive" role="alert">{loaded.error}</p>;

  const supplier = loaded.supplier;
  const kind = supplier.supplierKind;
  const address = [supplier.country, supplier.province, supplier.city, supplier.address].filter(Boolean).join("، ");
  const types = supplier.purchaseTypes.filter((type) => type.isActive).map((type) => type.nameFa);
  const goods = supplier.goods.map((good) => good.name);
  const bank = supplier.bankAccounts.find((account) => account.isActive && account.isDefault) ?? supplier.bankAccounts.find((account) => account.isActive);

  return (
    <div className="space-y-2">
      {supplier.status !== "active" ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <Ban className="size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>این تأمین‌کننده «{statusLabels[supplier.status]}» است.</span>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4">
        <Item label="نام تأمین‌کننده">{[supplier.title, supplier.name].filter(Boolean).join(" ")}</Item>
        <Item label="کد تأمین‌کننده"><span className="font-mono">{supplier.code}</span></Item>
        <Item label="وضعیت"><StatusBadge label={statusLabels[supplier.status]} tone={statusTone[supplier.status]} /></Item>
        <Item label="نوع شخص">{kind ? kindLabels[kind] : "-"}</Item>
        <Item label={kind ? nationalIdLabel[kind] : "شناسه / کد ملی"}>{ltr(supplier.nationalId)}</Item>
        <Item label="کد اقتصادی">{ltr(supplier.economicCode)}</Item>
        <Item label="تلفن">{ltr(supplier.phone)}</Item>
        <Item label="موبایل">{ltr(supplier.mobile)}</Item>
        <Item label="ایمیل">{ltr(supplier.email)}</Item>
        {supplier.website ? <Item label="وب‌سایت">{ltr(supplier.website)}</Item> : null}
        <Item label="نشانی" wide>{address || "-"}</Item>
        <Item label="انواع خرید">{types.length > 0 ? types.join("، ") : "-"}</Item>
        <Item label="کالاهای قابل تأمین" wide>
          {goods.length > 0 ? (
            <>
              {goods.slice(0, 6).join("، ")}
              {goods.length > 6 ? <span className="text-muted-foreground"> و {(goods.length - 6).toLocaleString("fa-IR")} مورد دیگر</span> : null}
            </>
          ) : (
            "-"
          )}
        </Item>
        <Item label="حساب بانکی پیش‌فرض" wide>
          {bank ? (
            <>
              {bank.bankName || "-"}
              {bank.accountHolderName ? <span className="text-muted-foreground"> — {bank.accountHolderName}</span> : null}
              {bank.shebaNumber ? <span className="text-muted-foreground"> — شبا: {ltr(bank.shebaNumber)}</span> : bank.accountNumber ? <span className="text-muted-foreground"> — {ltr(bank.accountNumber)}</span> : null}
            </>
          ) : (
            "-"
          )}
        </Item>
      </dl>
    </div>
  );
}
