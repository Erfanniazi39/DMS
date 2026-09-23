"use client";

import { useParams } from "next/navigation";
import { PurchaseRequestForm } from "../../PurchaseRequestForm";

export default function EditPurchaseRequestPage() {
  const params = useParams<{ id: string }>();
  const purchaseRequestId = Number(params.id);
  return <PurchaseRequestForm mode="edit" purchaseRequestId={purchaseRequestId} />;
}
