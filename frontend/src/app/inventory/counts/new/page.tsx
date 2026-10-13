"use client";

import { RequirePermission } from "@/components/require-permission";
import { StockCountForm } from "../StockCountForm";

export default function NewStockCountPage() {
  return (
    <RequirePermission permission="inventory.count" message="اجازه ثبت سند شمارش موجودی را ندارید.">
      <StockCountForm mode="create" />
    </RequirePermission>
  );
}
