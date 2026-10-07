"use client";

import { RequirePermission } from "@/components/require-permission";
import { StockAdjustmentForm } from "../StockAdjustmentForm";

export default function NewStockAdjustmentPage() {
  return (
    <RequirePermission permission="inventory.adjust" message="اجازه ثبت سند موجودی را ندارید.">
      <StockAdjustmentForm mode="create" />
    </RequirePermission>
  );
}
