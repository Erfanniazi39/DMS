"use client";

import { RequirePermission } from "@/components/require-permission";
import { useParams } from "next/navigation";
import { PurchaseRequestForm } from "../../PurchaseRequestForm";

export default function EditPurchaseRequestPage() {
  const params = useParams<{ id: string }>();
  const purchaseRequestId = Number(params.id);
  return (
    <RequirePermission permission="purchases.edit" message="اجازه ویرایش درخواست خرید را ندارید.">
      <PurchaseRequestForm mode="edit" purchaseRequestId={purchaseRequestId} />
    </RequirePermission>
  );
}
