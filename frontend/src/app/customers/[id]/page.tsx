"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import type { CustomerDetail } from "../shared";
import { StatusActions } from "./_sections/StatusActions";
import { OverviewSection } from "./_sections/OverviewSection";
import { ContactsSection } from "./_sections/ContactsSection";
import { AddressesSection } from "./_sections/AddressesSection";
import { FinancialSection } from "./_sections/FinancialSection";
import { NotesSection } from "./_sections/NotesSection";
import { DocumentsSection } from "./_sections/DocumentsSection";
import { ComplaintsSection } from "./_sections/ComplaintsSection";
import { HistorySection } from "./_sections/HistorySection";

// Customer detail page. The loaded customer and the stale-record flag live
// here; each section in ./_sections owns its own dialog state and calls
// `onChanged` (reload) after a write. No Transactions/Sales tab — Sales
// doesn't exist yet.
export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = Number(params.id);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const user = useAdminUser();
  const canView = user?.permissions.includes("customers.view") ?? false;
  const canManage = user?.permissions.includes("customers.manage") ?? false;
  const canFinance = user?.permissions.includes("customers.finance") ?? false;
  const canArchive = user?.permissions.includes("customers.archive") ?? false;

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);
  // Bumped after every write so the history section re-reads too.
  const [historyKey, setHistoryKey] = useState(0);

  const [loadingCustomerId, setLoadingCustomerId] = useState(customerId);
  if (loadingCustomerId !== customerId) {
    setLoadingCustomerId(customerId);
    setLoading(true);
  }

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<CustomerDetail>(`/customers/${customerId}`)
      .then((data) => {
        if (!ignore) {
          setCustomer(data);
          setLoadError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات مشتری ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [customerId, canView]);

  // Reload after a write in any section (no full-page loading state).
  async function reloadCustomer() {
    try {
      setCustomer(await apiFetch<CustomerDetail>(`/customers/${customerId}`));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات مشتری ناموفق بود.");
    }
    setHistoryKey((current) => current + 1);
  }

  function applyUpdate(updated: CustomerDetail) {
    setCustomer(updated);
    setHistoryKey((current) => current + 1);
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">اجازه دسترسی به مشتریان را ندارید.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          {loadError ?? "مشتری یافت نشد."}
        </p>
      </div>
    );
  }

  const toastActions = { pushError, pushErrors, pushSuccess };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-5xl space-y-4">
        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>این مشتری پس از بارگذاری این صفحه توسط کاربر دیگری تغییر کرده است. برای ادامه، صفحه را بازخوانی کنید.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <StatusActions
          customer={customer}
          setCustomer={applyUpdate}
          canManage={canManage}
          canArchive={canArchive}
          staleRecord={staleRecord}
          setStaleRecord={setStaleRecord}
          toasts={toastActions}
        />

        <OverviewSection customer={customer} />
        <ContactsSection customer={customer} canManage={canManage} onChanged={reloadCustomer} toasts={toastActions} />
        <AddressesSection customer={customer} canManage={canManage} onChanged={reloadCustomer} toasts={toastActions} />
        <FinancialSection customerId={customer.id} canFinance={canFinance} onChanged={reloadCustomer} toasts={toastActions} />
        <NotesSection customer={customer} canManage={canManage} onChanged={reloadCustomer} toasts={toastActions} />
        <DocumentsSection customer={customer} canManage={canManage} onChanged={reloadCustomer} toasts={toastActions} />
        <ComplaintsSection customer={customer} canManage={canManage} onChanged={reloadCustomer} toasts={toastActions} />
        <HistorySection customerId={customer.id} reloadKey={historyKey} />
      </div>
    </div>
  );
}
