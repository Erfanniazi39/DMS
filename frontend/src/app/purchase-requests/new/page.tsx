"use client";

import { RequirePermission } from "@/components/require-permission";
import { PurchaseRequestForm } from "../PurchaseRequestForm";

export default function NewPurchaseRequestPage() {
  return (
    <RequirePermission permission="purchases.manage" message="اجازه ثبت درخواست خرید جدید را ندارید.">
      <PurchaseRequestForm mode="create" />
    </RequirePermission>
  );
}
