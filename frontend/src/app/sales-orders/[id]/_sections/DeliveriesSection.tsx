"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { deliveryStatusLabels, deliveryStatusTone, deliveryTitle, type DeliveryListItem } from "../../../deliveries/shared";
import { FormSection } from "../../_form/FormSection";
import type { SalesOrderDetail } from "../../shared";

// «تحویل‌ها» — this order's delivery notes: GET /deliveries?salesOrderId=
// (sales.view, unpaginated — one order has few). «ایجاد تحویل»
// (sales.deliver) appears while the order is CONFIRMED and some line still
// has undelivered quantity; it opens /deliveries/new?orderId=… prefilled.
export function DeliveriesSection({ order, canDeliver, reloadKey }: { order: SalesOrderDetail; canDeliver: boolean; reloadKey: number }) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    apiFetch<DeliveryListItem[]>(`/deliveries?salesOrderId=${order.id}`)
      .then((data) => {
        if (!ignore) {
          setDeliveries(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت حواله‌های این سفارش ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [order.id, reloadKey, retryKey]);

  const hasOpenQuantity = order.items.some((line) => Number(line.quantity) > Number(line.deliveredQty));
  const canCreate = canDeliver && order.status === "CONFIRMED" && hasOpenQuantity;

  return (
    <FormSection
      title="تحویل‌ها"
      description={deliveries.length > 0 ? `${deliveries.length.toLocaleString("fa-IR")} حواله` : undefined}
      action={
        canCreate ? (
          <Button size="sm" variant="outline" onClick={() => router.push(`/deliveries/new?orderId=${order.id}`)}>
            <PackagePlus className="size-3.5" aria-hidden="true" />
            ایجاد تحویل
          </Button>
        ) : null
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-sm text-destructive" role="alert">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => setRetryKey((current) => current + 1)}>تلاش مجدد</Button>
        </div>
      ) : deliveries.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          هنوز حواله‌ای برای این سفارش صادر نشده است.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[36rem] text-right text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">شماره حواله</th>
                <th className="px-3 py-2 font-medium">تاریخ تحویل</th>
                <th className="px-3 py-2 font-medium">ردیف</th>
                <th className="px-3 py-2 font-medium">تحویل‌گیرنده</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/deliveries/${delivery.id}`} className={`text-primary hover:underline ${delivery.deliveryNumber ? "font-mono text-xs" : "text-xs"}`}>
                      {deliveryTitle(delivery)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(delivery.deliveryDate)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{delivery._count.items.toLocaleString("fa-IR")}</td>
                  <td className="px-3 py-2 text-muted-foreground">{delivery.receivedByName || "-"}</td>
                  <td className="px-3 py-2">
                    <StatusBadge label={deliveryStatusLabels[delivery.status]} tone={deliveryStatusTone[delivery.status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}
