"use client";

import { useParams } from "next/navigation";
import { useAdminUser } from "@/app/admin/layout";
import { RequirePermission } from "@/components/require-permission";
import { SupplierDetailView } from "../_sections/SupplierDetailView";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const user = useAdminUser();
  const id = Number(params.id);
  return (
    <RequirePermission permission="suppliers.view" message="اجازه دسترسی به تأمین‌کنندگان را ندارید.">
      {Number.isInteger(id) ? (
        <SupplierDetailView supplierId={id} canManage={user?.permissions.includes("suppliers.manage") ?? false} />
      ) : (
        <p className="p-10 text-center text-sm text-muted-foreground">شناسه تأمین‌کننده نامعتبر است.</p>
      )}
    </RequirePermission>
  );
}
