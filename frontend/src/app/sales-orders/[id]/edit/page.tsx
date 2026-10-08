"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { SalesOrderForm } from "../../SalesOrderForm";

// PATCH /sales-orders/:id is gated on sales.manage (DRAFT only).
export default function EditSalesOrderPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="sales.manage" message="اجازه ویرایش سفارش فروش را ندارید.">
      <SalesOrderForm mode="edit" orderId={Number(params.id)} />
    </RequirePermission>
  );
}
