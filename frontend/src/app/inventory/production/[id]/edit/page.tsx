"use client";

import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { ProductionOutputForm } from "../../ProductionOutputForm";

export default function EditProductionOutputPage() {
  const params = useParams<{ id: string }>();
  return (
    <RequirePermission permission="inventory.receive" message="اجازه ویرایش رسید تولید را ندارید.">
      <ProductionOutputForm mode="edit" outputId={Number(params.id)} />
    </RequirePermission>
  );
}
