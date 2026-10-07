"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { StockAdjustmentForm } from "../../StockAdjustmentForm";

export default function EditStockAdjustmentPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory.adjust" message="اجازه ویرایش سند موجودی را ندارید.">
      <StockAdjustmentForm mode="edit" adjustmentId={Number(params.id)} />
    </RequirePermission>
  );
}
