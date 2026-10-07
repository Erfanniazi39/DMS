"use client";

import { RequirePermission } from "@/components/require-permission";
import { CustomerForm } from "../CustomerForm";

export default function NewCustomerPage() {
  return (
    <RequirePermission permission="customers.manage" message="اجازه ثبت مشتری جدید را ندارید.">
      <CustomerForm mode="create" />
    </RequirePermission>
  );
}
