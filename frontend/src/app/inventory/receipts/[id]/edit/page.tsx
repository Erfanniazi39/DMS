"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { GoodsReceiptForm } from "../../GoodsReceiptForm";

export default function EditGoodsReceiptPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory.receive" message="اجازه ویرایش رسید انبار را ندارید.">
      <GoodsReceiptForm mode="edit" receiptId={Number(params.id)} />
    </RequirePermission>
  );
}
