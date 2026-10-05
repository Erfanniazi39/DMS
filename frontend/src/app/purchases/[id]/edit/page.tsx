"use client";

import { RequirePermission } from "@/components/require-permission";
import { useParams } from "next/navigation";
import { PurchaseForm } from "../../PurchaseForm";

export default function EditPurchasePage() {
  const params = useParams<{ id: string }>();
  const purchaseId = Number(params.id);
  return (
    <RequirePermission permission="purchases.edit" message="اجازه ویرایش خرید را ندارید.">
      <PurchaseForm mode="edit" purchaseId={purchaseId} />
    </RequirePermission>
  );
}
