"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RequirePermission } from "@/components/require-permission";
import { apiFetch, type ApiError } from "@/lib/api";
import { SupplierForm } from "../../_sections/SupplierForm";
import type { SupplierDetail } from "../../_sections/shared";

function EditSupplier() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(id)) return;
    apiFetch<SupplierDetail>(`/suppliers/${id}`).then(setSupplier).catch((reason: ApiError) => setError(reason.message ?? "دریافت اطلاعات تأمین‌کننده ناموفق بود."));
  }, [id]);

  if (!Number.isInteger(id)) return <p className="p-10 text-center text-sm text-muted-foreground">شناسه تأمین‌کننده نامعتبر است.</p>;
  if (error) return <p className="p-10 text-center text-sm text-destructive" role="alert">{error}</p>;
  if (!supplier) return <p className="p-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
  // key: the form initializes its state from the loaded supplier once.
  return <SupplierForm key={supplier.id} editing={supplier} />;
}

export default function EditSupplierPage() {
  return (
    <RequirePermission permission="suppliers.manage" message="شما اجازه ویرایش تأمین‌کننده را ندارید.">
      <EditSupplier />
    </RequirePermission>
  );
}
