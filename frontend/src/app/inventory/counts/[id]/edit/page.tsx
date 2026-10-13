"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { StockCountForm } from "../../StockCountForm";

export default function EditStockCountPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory.count" message="اجازه ویرایش سند شمارش موجودی را ندارید.">
      <StockCountForm mode="edit" countId={Number(params.id)} />
    </RequirePermission>
  );
}
