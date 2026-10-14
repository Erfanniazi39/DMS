"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeSheba, shebaProblem } from "@/lib/iran-identifiers";
import { normalizeDigits } from "@/lib/number-input";
import { StatusBadge, type CustomerBankAccountRow, type CustomerDetail } from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import { ListPagination } from "@/components/ui/list-pagination";
import type { SortValue } from "@/lib/table-sort";

type BankForm = {
  bankName: string;
  accountNumber: string;
  shebaNumber: string;
  accountHolderName: string;
  note: string;
  isDefault: boolean;
  isActive: boolean;
};

const emptyForm: BankForm = { bankName: "", accountNumber: "", shebaNumber: "", accountHolderName: "", note: "", isDefault: false, isActive: true };

// Accessors for in-memory column sorting — each sorts by what its column shows.
const CUSTOMERS_ID__SECTIONS_BANKACCOUNTSSECTION_TSX_SORT_GETTERS: Record<string, (row: CustomerBankAccountRow) => SortValue> = {
  bankName: (row) => row.bankName,
  accountNumber: (row) => row.accountNumber,
  shebaNumber: (row) => row.shebaNumber,
  accountHolderName: (row) => row.accountHolderName,
  isActive: (row) => row.isActive ? "فعال" : "غیرفعال",
};

// «حساب‌های بانکی» — POST/PATCH/DELETE /customers/:id/bank-accounts[/:accountId]
// (customers.manage). One default per customer (server-side). Numbers arrive
// masked (last 4 digits) for callers without customers.manage/finance — an
// edit dialog is only offered to managers, who always get the full values.
export function BankAccountsSection({
  customer,
  canManage,
  onChanged,
  toasts,
}: {
  customer: CustomerDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  // Sort + page the (small, already loaded) rows in memory; click a header to sort.
  const table = useClientTable(customer.bankAccounts, CUSTOMERS_ID__SECTIONS_BANKACCOUNTSSECTION_TSX_SORT_GETTERS, { pageSize: 20 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BankForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof BankForm>(key: K, value: BankForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, isDefault: customer.bankAccounts.length === 0 });
    setDialogOpen(true);
  }

  function openEdit(account: CustomerBankAccountRow) {
    setEditingId(account.id);
    setForm({
      bankName: account.bankName ?? "",
      accountNumber: account.accountNumber ?? "",
      shebaNumber: account.shebaNumber ?? "",
      accountHolderName: account.accountHolderName ?? "",
      note: account.note ?? "",
      isDefault: account.isDefault,
      isActive: account.isActive,
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accountNumber = normalizeDigits(form.accountNumber).trim();
    const sheba = normalizeSheba(normalizeDigits(form.shebaNumber));
    if (!accountNumber && !sheba) {
      pushError("شماره حساب یا شماره شبا باید وارد شود.");
      return;
    }
    const shebaIssue = sheba ? shebaProblem(sheba) : null;
    if (shebaIssue) {
      pushError(shebaIssue);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editingId === null ? `/customers/${customer.id}/bank-accounts` : `/customers/${customer.id}/bank-accounts/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          bankName: form.bankName.trim(),
          accountNumber,
          shebaNumber: sheba,
          accountHolderName: form.accountHolderName.trim(),
          note: form.note.trim(),
          isDefault: form.isDefault,
          isActive: form.isActive,
        }),
      });
      pushSuccess(editingId === null ? "حساب بانکی اضافه شد." : "حساب بانکی ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره حساب بانکی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(account: CustomerBankAccountRow) {
    if (!window.confirm("آیا از حذف این حساب بانکی مطمئن هستید؟")) return;
    try {
      await apiFetch(`/customers/${customer.id}/bank-accounts/${account.id}`, { method: "DELETE" });
      pushSuccess("حساب بانکی حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف حساب بانکی ناموفق بود.");
    }
  }

  return (
    <>
      <DetailSection
        title="حساب‌های بانکی"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن حساب
            </Button>
          ) : undefined
        }
      >
        {customer.bankAccounts.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز حساب بانکی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[44rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <SortHeader label="بانک" sortKey="bankName" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="شماره حساب" sortKey="accountNumber" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="شماره شبا" sortKey="shebaNumber" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="صاحب حساب" sortKey="accountHolderName" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="وضعیت" sortKey="isActive" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.pageRows.map((account) => (
                  <tr key={account.id} className={account.isActive ? "" : "text-muted-foreground"}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {account.bankName || "-"}
                      {account.isDefault ? <span className="ms-1.5"><StatusBadge label="پیش‌فرض" tone="primary" /></span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{account.accountNumber || "-"}</span></td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{account.shebaNumber || "-"}</span></td>
                    <td className="px-3 py-2">{account.accountHolderName || "-"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={account.isActive ? "فعال" : "غیرفعال"} tone={account.isActive ? "success" : "muted"} />
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(account)}>
                            <Pencil className="size-4" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(account)}>
                            <Trash2 className="size-4" aria-hidden="true" />
                            حذف
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
            {table.total > table.pageSize ? <ListPagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} className="mt-3" /> : null}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId === null ? "افزودن حساب بانکی" : "ویرایش حساب بانکی"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="bank-account-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bank-name">بانک</Label>
                <Input id="bank-name" value={form.bankName} onChange={(event) => update("bankName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bank-holder">نام صاحب حساب</Label>
                <Input id="bank-holder" value={form.accountHolderName} onChange={(event) => update("accountHolderName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bank-account-number">شماره حساب</Label>
                <Input id="bank-account-number" dir="ltr" inputMode="numeric" value={form.accountNumber} onChange={(event) => update("accountNumber", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bank-sheba">شماره شبا</Label>
                <Input id="bank-sheba" dir="ltr" placeholder="IR…" value={form.shebaNumber} onChange={(event) => update("shebaNumber", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="bank-note">توضیحات</Label>
                <Input id="bank-note" value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
              <label htmlFor="bank-default" className="flex items-center gap-2 text-sm">
                <input id="bank-default" type="checkbox" className="size-4" checked={form.isDefault} onChange={(event) => update("isDefault", event.target.checked)} />
                حساب پیش‌فرض
              </label>
              <label htmlFor="bank-active" className="flex items-center gap-2 text-sm">
                <input id="bank-active" type="checkbox" className="size-4" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
                فعال
              </label>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="bank-account-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId === null ? "افزودن حساب" : "ذخیره تغییرات"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
