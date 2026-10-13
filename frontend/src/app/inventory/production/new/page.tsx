"use client";

import { RequirePermission } from "@/components/require-permission";
import { ProductionOutputForm } from "../ProductionOutputForm";

export default function NewProductionOutputPage() {
  return (
    <RequirePermission permission="inventory.receive" message="اجازه ثبت رسید تولید را ندارید.">
      <ProductionOutputForm mode="create" />
    </RequirePermission>
  );
}
