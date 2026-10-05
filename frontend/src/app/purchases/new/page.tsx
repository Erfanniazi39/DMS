"use client";

import { RequirePermission } from "@/components/require-permission";
import { PurchaseForm } from "../PurchaseForm";

export default function NewPurchasePage() {
  return (
    <RequirePermission permission="purchases.manage" message="اجازه ثبت خرید جدید را ندارید.">
      <PurchaseForm mode="create" />
    </RequirePermission>
  );
}
