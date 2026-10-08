"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { DeliveryForm } from "../../DeliveryForm";

// PATCH /deliveries/:id is gated on sales.deliver (DRAFT only).
export default function EditDeliveryPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="sales.deliver" message="اجازه ویرایش حواله تحویل را ندارید.">
      <DeliveryForm mode="edit" deliveryId={Number(params.id)} />
    </RequirePermission>
  );
}
