"use client";

import { RequirePermission } from "@/components/require-permission";
import { SalesReturnRequestForm } from "../SalesReturnRequestForm";

// /sales-returns/new?deliveryId=… — POST /sales-returns is gated on sales.manage.
export default function NewSalesReturnPage() {
  return (
    <RequirePermission permission="sales.manage" message="اجازه ثبت درخواست مرجوعی را ندارید.">
      <SalesReturnRequestForm />
    </RequirePermission>
  );
}
