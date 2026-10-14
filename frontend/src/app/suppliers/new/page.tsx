"use client";

import { RequirePermission } from "@/components/require-permission";
import { SupplierForm } from "../_sections/SupplierForm";

export default function NewSupplierPage() {
  return (
    <RequirePermission permission="suppliers.manage" message="شما اجازه ثبت تأمین‌کننده را ندارید.">
      <SupplierForm editing={null} />
    </RequirePermission>
  );
}
