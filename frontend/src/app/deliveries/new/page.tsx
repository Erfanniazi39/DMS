"use client";

import { RequirePermission } from "@/components/require-permission";
import { DeliveryForm } from "../DeliveryForm";

// /deliveries/new?orderId=… — POST /deliveries is gated on sales.deliver.
export default function NewDeliveryPage() {
  return (
    <RequirePermission permission="sales.deliver" message="اجازه صدور حواله تحویل را ندارید.">
      <DeliveryForm mode="create" />
    </RequirePermission>
  );
}
