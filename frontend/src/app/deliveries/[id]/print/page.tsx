"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import { PrintFields, PrintHeader, PrintSheet, PrintSignatures, PrintToolbar } from "@/components/print/print-document";
import { NoAccess, formatQuantity, salesOrderTitle } from "../../../sales-orders/shared";
import { deliveryTitle, type DeliveryDetail } from "../../shared";

// حواله تحویل کالا — browser-print page (build plan §7: paper-mirror layout,
// no PDF library). Reads GET /deliveries/:id (sales.view). A DRAFT prints
// with a "پیش‌نویس — فاقد اعتبار" marker.
export default function DeliveryPrintPage() {
  const params = useParams<{ id: string }>();
  const deliveryId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("sales.view") ?? false;
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<DeliveryDetail>(`/deliveries/${deliveryId}`)
      .then((data) => {
        if (!ignore) setDelivery(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات حواله ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [deliveryId, canView]);

  if (!canView) return <NoAccess message="اجازه مشاهده حواله‌های تحویل را ندارید." />;

  if (!delivery) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            <p role="alert">{loadError}</p>
            <Link href="/deliveries" className="text-primary hover:underline">بازگشت به تحویل‌ها ←</Link>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        )}
      </div>
    );
  }

  const order = delivery.salesOrder;
  const totalQuantity = delivery.items.reduce((sum, item) => sum + Number(item.quantity), 0);

  return (
    <div className="p-4 sm:p-6 print:p-0">
      <PrintToolbar backHref={`/deliveries/${delivery.id}`} backLabel="بازگشت به حواله" />
      <PrintSheet>
        <PrintHeader
          title="حواله تحویل کالا"
          draft={delivery.status === "DRAFT"}
          meta={[
            ["شماره", <span key="n" className="font-mono">{deliveryTitle(delivery)}</span>],
            ["تاریخ", formatJalali(delivery.deliveryDate)],
            ["سفارش", <span key="o" className="font-mono">{salesOrderTitle(order)}</span>],
          ]}
        />

        <PrintFields
          rows={[
            ["مشتری", `${order.customerName} (${delivery.customer.customerNumber})`],
            ["کد اقتصادی", order.customerEconomicCode],
            ["شماره مرجع مشتری", order.customerReference],
            ["انبار", delivery.location.name],
            ["آدرس تحویل", delivery.deliveryAddressText],
            ["راننده / وسیلهٔ نقلیه", delivery.carrierNote],
          ]}
        />

        <table className="w-full border-collapse text-right">
          <thead>
            <tr className="bg-muted/40 print:bg-transparent">
              <th className="w-10 border border-border px-2 py-1.5 font-medium">ردیف</th>
              <th className="w-28 border border-border px-2 py-1.5 font-medium">کد کالا</th>
              <th className="border border-border px-2 py-1.5 font-medium">شرح کالا</th>
              <th className="w-20 border border-border px-2 py-1.5 font-medium">واحد</th>
              <th className="w-24 border border-border px-2 py-1.5 font-medium">مقدار</th>
            </tr>
          </thead>
          <tbody>
            {delivery.items.map((item, index) => (
              <tr key={item.id} className="break-inside-avoid">
                <td className="border border-border px-2 py-1.5 tabular-nums">{(index + 1).toLocaleString("fa-IR")}</td>
                <td className="border border-border px-2 py-1.5 font-mono text-xs">{item.salesOrderItem.itemCode}</td>
                <td className="border border-border px-2 py-1.5">{item.salesOrderItem.itemName}</td>
                <td className="border border-border px-2 py-1.5">{item.salesOrderItem.unitName}</td>
                <td className="border border-border px-2 py-1.5 tabular-nums">{formatQuantity(item.quantity)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="border border-border px-2 py-1.5 font-medium" colSpan={4}>جمع مقدار ({delivery.items.length.toLocaleString("fa-IR")} ردیف)</td>
              <td className="border border-border px-2 py-1.5 font-semibold tabular-nums">{formatQuantity(totalQuantity)}</td>
            </tr>
          </tfoot>
        </table>

        {order.customerNote || delivery.note ? (
          <div className="mt-4 space-y-1 border border-border p-3">
            {order.customerNote ? (
              <p>
                <span className="text-muted-foreground">توضیحات سفارش: </span>
                <span className="whitespace-pre-wrap">{order.customerNote}</span>
              </p>
            ) : null}
            {delivery.note ? (
              <p>
                <span className="text-muted-foreground">توضیحات حواله: </span>
                <span className="whitespace-pre-wrap">{delivery.note}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <PrintSignatures
          boxes={[
            { label: "تحویل‌دهنده (انبار)" },
            { label: "راننده", name: null },
            { label: "تحویل‌گیرنده (مشتری)", name: delivery.receivedByName },
          ]}
        />
      </PrintSheet>
    </div>
  );
}
