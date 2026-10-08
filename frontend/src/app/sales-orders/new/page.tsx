"use client";

import { RequirePermission } from "@/components/require-permission";
import { SalesOrderForm } from "../SalesOrderForm";

export default function NewSalesOrderPage() {
  return (
    <RequirePermission permission="sales.manage" message="اجازه ثبت سفارش فروش را ندارید.">
      <SalesOrderForm mode="create" />
    </RequirePermission>
  );
}
