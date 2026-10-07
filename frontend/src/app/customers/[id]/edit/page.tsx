"use client";

import { RequirePermission } from "@/components/require-permission";
import { useParams } from "next/navigation";
import { CustomerForm } from "../../CustomerForm";

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const customerId = Number(params.id);
  return (
    <RequirePermission permission="customers.manage" message="اجازه ویرایش مشتری را ندارید.">
      <CustomerForm mode="edit" customerId={customerId} />
    </RequirePermission>
  );
}
