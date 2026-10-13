"use client";

import { RequirePermission } from "@/components/require-permission";
import { GoodsReceiptForm } from "../GoodsReceiptForm";

export default function NewGoodsReceiptPage() {
  return (
    <RequirePermission permission="inventory.receive" message="اجازه ثبت رسید انبار را ندارید.">
      <GoodsReceiptForm mode="create" />
    </RequirePermission>
  );
}
