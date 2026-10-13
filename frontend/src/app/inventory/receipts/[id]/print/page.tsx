"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintFields, PrintHeader, PrintSheet, PrintSignatures, PrintToolbar } from "@/components/print/print-document";
import { NoAccess, goodsReceiptTitle, type GoodsReceiptDetail } from "../../../shared";
import { InboundPrintTable } from "../../../_inbound/InboundPrintTable";
import { useBatchExpiry } from "../../../_inbound/useBatchExpiry";

// رسید انبار (GRN) — browser-print page, same pattern as
// deliveries/[id]/print/page.tsx (paper-mirror layout, no PDF library). Reads
// GET /inventory/goods-receipts/:id (inventory.view). A DRAFT prints with a
// "پیش‌نویس — فاقد اعتبار" marker. Costs print only for inventory.cost holders.
export default function GoodsReceiptPrintPage() {
  const params = useParams<{ id: string }>();
  const receiptId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("inventory.view") ?? false;
  const canCost = user?.permissions.includes("inventory.cost") ?? false;
  const [receipt, setReceipt] = useState<GoodsReceiptDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<GoodsReceiptDetail>(`/inventory/goods-receipts/${receiptId}`)
      .then((data) => {
        if (!ignore) setReceipt(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات رسید ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [receiptId, canView]);

  const batchExpiry = useBatchExpiry(receipt?.items, canView && receipt?.status === "POSTED");

  if (!canView) return <NoAccess message="اجازه مشاهده رسیدهای انبار را ندارید." />;

  if (!receipt) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/inventory/receipts" className="text-primary hover:underline">بازگشت به رسیدهای انبار ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/inventory/receipts/${receipt.id}`} backLabel="بازگشت به رسید" />
      <PrintSheet>
        <PrintHeader
          title="رسید انبار"
          draft={receipt.status === "DRAFT"}
          meta={[
            ["شماره", <span key="n" className="font-mono">{goodsReceiptTitle(receipt)}</span>],
            ["تاریخ", formatJalali(receipt.receiptDate)],
            ["انبار", receipt.location.name],
          ]}
        />

        <PrintFields
          rows={[
            ["تأمین‌کننده", `${receipt.supplierName} (${receipt.supplier.code})`],
            ["شماره سند تأمین‌کننده", receipt.supplierDocumentNumber],
            ["خرید مرتبط", receipt.purchaseNumber ? <span key="p" className="font-mono">{receipt.purchaseNumber}</span> : null],
            ["کنترل کیفیت", receipt.inspectionRequired ? "دارد" : "ندارد"],
          ]}
        />

        <InboundPrintTable lines={receipt.items} showCost={canCost} batchExpiry={batchExpiry} />

        {receipt.note ? (
          <div className="mt-4 border border-border p-3">
            <span className="text-muted-foreground">توضیحات: </span>
            <span className="whitespace-pre-wrap">{receipt.note}</span>
          </div>
        ) : null}

        <PrintSignatures
          boxes={[
            { label: "تحویل‌دهنده (تأمین‌کننده)" },
            ...(receipt.inspectionRequired ? [{ label: "کنترل کیفیت" }] : []),
            { label: "تحویل‌گیرنده (انبار)", name: receipt.postedByUser?.username ?? null },
          ]}
        />
      </PrintSheet>
    </div>
  );
}
