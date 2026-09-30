"use client";

import { useParams } from "next/navigation";
import { PurchaseForm } from "../../PurchaseForm";

export default function EditPurchasePage() {
  const params = useParams<{ id: string }>();
  const purchaseId = Number(params.id);
  return <PurchaseForm mode="edit" purchaseId={purchaseId} />;
}
