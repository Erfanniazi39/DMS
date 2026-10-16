"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMoney } from "@/lib/format";
import { formatJalaliNumeric } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintSheet, PrintToolbar } from "@/components/print/print-document";
import { useCompanyProfile } from "@/lib/company";
import { NoAccess, formatQuantity } from "../../../sales-orders/shared";
import { salesInvoiceTitle, type SalesInvoiceDetail } from "../../shared";

// فاکتور فروش — browser-print page built from components/print/print-document.tsx
// (build plan §7: paper-mirror layout, no PDF library). Reads
// GET /sales-invoices/:id (sales.view). A DRAFT prints with a
// "پیش‌نویس — فاقد اعتبار" marker. Layout follows the company's paper form
// (docs/invoice_example.png): title box, فروشنده / خریدار boxes, items, totals,
// amount in words, signatures, issuer + print date. The seller block comes from
// the company profile (live). The buyer's economic code is printed; the
// national ID never is (B14).
export default function SalesInvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const user = useAdminUser();
  const company = useCompanyProfile();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const [invoice, setInvoice] = useState<SalesInvoiceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<SalesInvoiceDetail>(`/sales-invoices/${invoiceId}`)
      .then((data) => {
        if (!ignore) setInvoice(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات فاکتور ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [invoiceId, canView]);

  if (!canView) return <NoAccess message="اجازه مشاهده فاکتورهای فروش را ندارید." />;

  if (!invoice) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/sales-invoices" className="text-primary hover:underline">بازگشت به فاکتورها ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  const order = invoice.salesOrder;
  const isDraft = invoice.status === "DRAFT";
  // billingAddressText already starts with province، city and ends with «کد پستی …»
  // (the postal code has its own field) — drop the suffix, never prepend them again.
  const buyerAddress =
    invoice.billingAddressText?.replace(/\s*[،,]?\s*کد پستی\s*[0-9۰-۹-]+\s*$/, "").trim() ||
    [invoice.customerProvince, invoice.customerCity].filter(Boolean).join("، ");
  const sellerAddress = [company?.province, company?.city, company?.address].filter(Boolean).join("، ");
  const issuerUser = invoice.postedByUser ?? invoice.createdByUser;
  const issuer = issuerUser?.fullName?.trim() || issuerUser?.username || "";
  const grossOf = (line: (typeof invoice.items)[number]) => Math.round(Number(line.quantity) * Number(line.unitPrice) * 100) / 100;

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/sales-invoices/${invoice.id}`} backLabel="بازگشت به فاکتور" />
      <PrintSheet companyBlock={false} fullPage pageName="invoice">
        {company && !company.legalName.trim() ? (
          <p className="mb-3 border border-dashed border-destructive px-3 py-2 text-xs text-destructive print:hidden">
            مشخصات شرکت هنوز ثبت نشده است؛ بخش «فروشنده» خالی چاپ می‌شود. (تنظیمات › مشخصات شرکت)
          </p>
        ) : null}

        {/* Title box: company name, document title, number and date. */}
        <header className="relative mb-2 border border-foreground px-3 py-3 text-center">
          {company?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api${company.logoUrl}`} alt="" className="absolute right-3 top-2 max-h-14 max-w-24 object-contain" />
          ) : null}
          <p className="text-base font-bold">{company?.legalName}</p>
          <h1 className="mt-1 text-sm font-bold">{invoice.sourceType === "OPENING_BALANCE" ? "فاکتور مانده افتتاحیه" : "فاکتور فروش"}</h1>
          {isDraft ? <p className="mx-auto mt-1 w-fit border border-destructive px-2 py-0.5 text-xs font-semibold text-destructive">پیش‌نویس — فاقد اعتبار</p> : null}
          <dl className="mt-2 space-y-0.5 text-start text-xs">
            <div>
              <dt className="inline font-medium">تاریخ فاکتور: </dt>
              <dd className="inline tabular-nums">{formatJalaliNumeric(invoice.invoiceDate)}</dd>
            </div>
            <div>
              <dt className="inline font-medium">شماره فاکتور: </dt>
              <dd className="inline font-mono">{salesInvoiceTitle(invoice)}</dd>
            </div>
          </dl>
        </header>

        <PartyBox
          title="فروشنده"
          name={company?.legalName}
          codeLabel="کد اقتصادی"
          code={company?.economicCode}
          phone={[company?.phone1, company?.phone2].filter(Boolean).join(" ، ")}
          postalCode={company?.postalCode}
          address={sellerAddress}
        />
        <PartyBox
          title="خریدار"
          name={invoice.customerLegalName || invoice.customerName}
          codeLabel="کد اقتصادی"
          code={invoice.customerEconomicCode}
          phone={invoice.customerPhone}
          postalCode={invoice.customerPostalCode}
          address={buyerAddress}
        />

        <table className="mb-0 w-full border-collapse border border-foreground text-right">
          <thead>
            <tr>
              <th className="w-10 border border-foreground px-1 py-1.5 text-center font-bold">ردیف</th>
              <th className="w-28 border border-foreground px-2 py-1.5 text-center font-bold">کد کالا</th>
              <th className="border border-foreground px-2 py-1.5 text-center font-bold">نام کالا</th>
              <th className="w-20 border border-foreground px-2 py-1.5 text-center font-bold">تعداد</th>
              <th className="w-20 border border-foreground px-2 py-1.5 text-center font-bold">واحد</th>
              <th className="w-28 border border-foreground px-2 py-1.5 text-center font-bold">فی</th>
              <th className="w-32 border border-foreground px-2 py-1.5 text-center font-bold">مبلغ (ریال)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((line, index) => (
              <tr key={line.id} className="break-inside-avoid">
                <td className="border border-foreground px-1 py-1.5 text-center tabular-nums">{(index + 1).toLocaleString("fa-IR")}</td>
                <td className="border border-foreground px-2 py-1.5 text-center font-mono text-xs">{line.itemCode ?? ""}</td>
                <td className="border border-foreground px-2 py-1.5">{line.itemName}</td>
                <td className="border border-foreground px-2 py-1.5 text-center tabular-nums">{formatQuantity(line.quantity)}</td>
                <td className="border border-foreground px-2 py-1.5 text-center">{line.unitName ?? ""}</td>
                <td className="border border-foreground px-2 py-1.5 text-center tabular-nums">{formatMoney(line.unitPrice)}</td>
                <td className="border border-foreground px-2 py-1.5 text-center tabular-nums">{formatMoney(grossOf(line))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <TotalRow label="جمع" value={formatMoney(invoice.subtotal)} />
        <TotalRow label="تخفیف" value={formatMoney(invoice.discountTotal)} />
        <TotalRow label="هزینه" value={formatMoney(invoice.taxTotal)} />
        <TotalRow label="مبلغ قابل پرداخت" value={formatMoney(invoice.totalAmount)} bold />
        <div className="mt-2 border border-foreground px-3 py-2">
          <span className="font-bold">جمع به حروف: </span>
          {invoice.totalAmountInWords}
        </div>

        {order?.customerNote || invoice.note ? (
          <div className="mt-2 space-y-1 border border-foreground px-3 py-2 text-xs">
            {order?.customerNote ? (
              <p>
                <span className="font-medium">توضیحات سفارش: </span>
                <span className="whitespace-pre-wrap">{order.customerNote}</span>
              </p>
            ) : null}
            {invoice.note ? (
              <p>
                <span className="font-medium">توضیحات فاکتور: </span>
                <span className="whitespace-pre-wrap">{invoice.note}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 px-6 text-xs font-medium">
          <span>مهر و امضای خریدار :</span>
          <span>مهر و امضای فروشنده :</span>
        </div>

        {company?.documentFooter ? <p className="mt-6 whitespace-pre-wrap text-center text-xs text-muted-foreground">{company.documentFooter}</p> : null}

        <footer className="mt-auto flex justify-between border-t border-foreground pt-1 text-[11px]">
          <span>صادر کننده : {issuer}</span>
          <span>تاریخ چاپ : {formatJalaliNumeric(new Date())}</span>
        </footer>
      </PrintSheet>
    </div>
  );
}

// «فروشنده» / «خریدار» box: vertical label on the right edge, name / code /
// phone / postal code / address inside (same arrangement as the paper form).
function PartyBox({ title, name, codeLabel, code, phone, postalCode, address }: { title: string; name?: string | null; codeLabel: string; code?: string | null; phone?: string | null; postalCode?: string | null; address?: string | null }) {
  const cell = (label: string, value?: string | null) => (
    <div className="flex gap-1">
      <span className="shrink-0 font-bold">{label} :</span>
      <span className="min-w-0 break-words">{value ?? ""}</span>
    </div>
  );
  return (
    <div className="mb-2 flex border border-foreground">
      <div className="flex w-9 shrink-0 items-center justify-center border-e border-foreground">
        <span className="whitespace-nowrap text-sm font-bold [writing-mode:vertical-rl]">{title}</span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 px-3 py-2 text-xs">
        {cell("نام شخص", name)}
        {cell(codeLabel, code)}
        {cell("کد پستی", postalCode)}
        {cell("تلفن", phone)}
        <div className="col-span-2">{cell("آدرس", address)}</div>
      </div>
    </div>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex border border-t-0 border-foreground ${bold ? "font-bold" : ""}`}>
      <span className="flex-1 px-3 py-1.5">{label} :</span>
      <span className="w-32 border-s border-foreground px-2 py-1.5 text-center tabular-nums">{value}</span>
    </div>
  );
}
