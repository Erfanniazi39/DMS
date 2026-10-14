"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeSheba, shebaProblem } from "@/lib/iran-identifiers";
import { normalizeDigits } from "@/lib/number-input";
import { kindLabels, nationalIdLabel, statusLabels, type SupplierBankAccount, type SupplierDetail } from "./shared";

type BankForm = { bankName: string; accountNumber: string; shebaNumber: string; accountHolderName: string; note: string; isDefault: boolean; isActive: boolean };
const emptyBank: BankForm = { bankName: "", accountNumber: "", shebaNumber: "", accountHolderName: "", note: "", isDefault: false, isActive: true };

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children || "-"}</dd>
    </div>
  );
}
const ltr = (value: string | null) => (value ? <span className="font-mono tabular-nums" dir="ltr">{value}</span> : null);

// Read-only supplier detail page (GET /suppliers/:id) plus its bank accounts
// (POST/PATCH/DELETE /suppliers/:id/bank-accounts[/:accountId], suppliers.manage).
// The add/edit form is an inline panel. The accounts list is also what payment
// screens read to prefill a supplier's destination account.
export function SupplierDetailView({ supplierId, canManage }: { supplierId: number; canManage: boolean }) {
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [bankForm, setBankForm] = useState<BankForm | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setSupplier(await apiFetch<SupplierDetail>(`/suppliers/${supplierId}`));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات تأمین‌کننده ناموفق بود.");
    }
  }, [supplierId, pushError]);

  useEffect(() => {
    let ignore = false;
    apiFetch<SupplierDetail>(`/suppliers/${supplierId}`)
      .then((data) => {
        if (!ignore) setSupplier(data);
      })
      .catch((reason: unknown) => {
        if (!ignore) pushError((reason as ApiError).message ?? "دریافت اطلاعات تأمین‌کننده ناموفق بود.");
      });
    return () => {
      ignore = true;
    };
  }, [supplierId, pushError]);

  function openBank(account?: SupplierBankAccount) {
    setEditingId(account?.id ?? null);
    setBankForm(
      account
        ? { bankName: account.bankName ?? "", accountNumber: account.accountNumber ?? "", shebaNumber: account.shebaNumber ?? "", accountHolderName: account.accountHolderName ?? "", note: account.note ?? "", isDefault: account.isDefault, isActive: account.isActive }
        : { ...emptyBank, isDefault: (supplier?.bankAccounts.length ?? 0) === 0 },
    );
  }

  async function saveBank(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bankForm) return;
    const accountNumber = normalizeDigits(bankForm.accountNumber).trim();
    const sheba = normalizeSheba(normalizeDigits(bankForm.shebaNumber));
    if (!accountNumber && !sheba) return pushError("شماره حساب یا شماره شبا باید وارد شود.");
    const shebaIssue = sheba ? shebaProblem(sheba) : null;
    if (shebaIssue) return pushError(shebaIssue);
    setSaving(true);
    try {
      await apiFetch(editingId === null ? `/suppliers/${supplierId}/bank-accounts` : `/suppliers/${supplierId}/bank-accounts/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          bankName: bankForm.bankName.trim(),
          accountNumber,
          shebaNumber: sheba,
          accountHolderName: bankForm.accountHolderName.trim(),
          note: bankForm.note.trim(),
          isDefault: bankForm.isDefault,
          isActive: bankForm.isActive,
        }),
      });
      pushSuccess(editingId === null ? "حساب بانکی اضافه شد." : "حساب بانکی ویرایش شد.");
      setBankForm(null);
      await load();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره حساب بانکی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function removeBank(account: SupplierBankAccount) {
    if (!window.confirm("آیا از حذف این حساب بانکی مطمئن هستید؟")) return;
    try {
      await apiFetch(`/suppliers/${supplierId}/bank-accounts/${account.id}`, { method: "DELETE" });
      pushSuccess("حساب بانکی حذف شد.");
      await load();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف حساب بانکی ناموفق بود.");
    }
  }

  function setBank<K extends keyof BankForm>(key: K, value: BankForm[K]) {
    setBankForm((current) => (current ? { ...current, [key]: value } : current));
  }

  const kind = supplier?.supplierKind ?? null;
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{supplier?.name ?? "جزئیات تأمین‌کننده"}</h1>
            {supplier ? <p className="mt-1 font-mono text-xs text-muted-foreground">{supplier.code}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {canManage && supplier ? <Link href={`/suppliers/${supplier.id}/edit`}><Button type="button" size="sm"><Pencil className="size-4" aria-hidden="true" /> ویرایش</Button></Link> : null}
            <Link href="/suppliers"><Button type="button" size="sm" variant="outline">بازگشت به فهرست</Button></Link>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          {!supplier ? (
            <p className="py-6 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : (
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">هویت</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="کد">{ltr(supplier.code)}</Field>
                  <Field label="وضعیت">{statusLabels[supplier.status]}</Field>
                  <Field label="نوع شخص">{kind ? kindLabels[kind] : <span className="text-warning">تعیین نشده</span>}</Field>
                  <Field label="عنوان">{supplier.title}</Field>
                  <Field label={kind ? nationalIdLabel[kind] : "شناسه / کد ملی"}>{ltr(supplier.nationalId)}</Field>
                  <Field label="کد اقتصادی">{ltr(supplier.economicCode)}</Field>
                  {kind === "ORGANIZATION" ? <Field label="شماره ثبت">{ltr(supplier.registrationNumber)}</Field> : null}
                </dl>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">اطلاعات تماس</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="تلفن ۱">{ltr(supplier.phone)}</Field>
                  <Field label="تلفن ۲">{ltr(supplier.phone2)}</Field>
                  <Field label="موبایل">{ltr(supplier.mobile)}</Field>
                  <Field label="فکس">{ltr(supplier.fax)}</Field>
                  <Field label="تلکس">{ltr(supplier.telex)}</Field>
                  <Field label="وب‌سایت">{ltr(supplier.website)}</Field>
                  <Field label="ایمیل">{ltr(supplier.email)}</Field>
                </dl>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">نشانی</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="کشور / استان / شهر">{[supplier.country, supplier.province, supplier.city].filter(Boolean).join(" / ")}</Field>
                  <Field label="کد پستی / کد شهر">{[supplier.postalCode, supplier.cityCode].filter(Boolean).join(" / ")}</Field>
                  <Field label="محل">{[supplier.locationNumber, supplier.locationName].filter(Boolean).join(" - ")}</Field>
                  <Field label="دارایی — استان / شهر">{[supplier.taxOfficeProvince, supplier.taxOfficeCity].filter(Boolean).join(" / ")}</Field>
                  <Field label="نشانی ۱" wide><span className="whitespace-pre-wrap">{supplier.address}</span></Field>
                  <Field label="نشانی ۲" wide><span className="whitespace-pre-wrap">{supplier.address2}</span></Field>
                </dl>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">نوع خرید و کالاهای تأمین‌شده</h3>
                <dl className="grid gap-4 text-sm md:grid-cols-2">
                  <Field label="انواع خرید">
                    {supplier.purchaseTypes.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {supplier.purchaseTypes.map((type) => <span key={type.id} className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{type.nameFa}{type.isActive ? "" : " (غیرفعال)"}</span>)}
                      </span>
                    ) : null}
                  </Field>
                  <Field label="کالاهای تأمین‌شده">
                    {supplier.goods.length > 0 ? (
                      <ul className="space-y-0.5">
                        {supplier.goods.map((good) => <li key={good.id}>{good.name}{good.note ? <span className="text-xs text-muted-foreground"> — {good.note}</span> : null}</li>)}
                      </ul>
                    ) : null}
                  </Field>
                </dl>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">حساب‌های بانکی</h3>
                  {canManage && !bankForm ? (
                    <Button type="button" size="sm" onClick={() => openBank()}>
                      <Plus className="size-4" aria-hidden="true" />
                      افزودن حساب
                    </Button>
                  ) : null}
                </div>
                {supplier.bankAccounts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">هنوز حساب بانکی ثبت نشده است.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[34rem] text-right text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">بانک</th>
                          <th className="px-3 py-2 font-medium">شماره حساب</th>
                          <th className="px-3 py-2 font-medium">شماره شبا</th>
                          <th className="px-3 py-2 font-medium">صاحب حساب</th>
                          {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {supplier.bankAccounts.map((account) => (
                          <tr key={account.id} className={account.isActive ? "" : "text-muted-foreground"}>
                            <td className="px-3 py-2">
                              {account.bankName || "-"}
                              {account.isDefault ? <span className="ms-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">پیش‌فرض</span> : null}
                              {!account.isActive ? <span className="ms-1.5 text-xs">(غیرفعال)</span> : null}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{account.accountNumber || "-"}</span></td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{account.shebaNumber || "-"}</span></td>
                            <td className="px-3 py-2">{account.accountHolderName || "-"}</td>
                            {canManage ? (
                              <td className="px-3 py-2">
                                <div className="flex gap-1">
                                  <Button type="button" size="sm" variant="ghost" onClick={() => openBank(account)}>
                                    <Pencil className="size-4" aria-hidden="true" />
                                    ویرایش
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void removeBank(account)}>
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

                {bankForm ? (
                  <form className="mt-3 grid gap-3 rounded-md border border-border bg-muted/20 p-3 md:grid-cols-2" onSubmit={saveBank} noValidate>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="sb-name">بانک</Label>
                      <Input id="sb-name" value={bankForm.bankName} onChange={(event) => setBank("bankName", event.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="sb-holder">نام صاحب حساب</Label>
                      <Input id="sb-holder" value={bankForm.accountHolderName} onChange={(event) => setBank("accountHolderName", event.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="sb-number">شماره حساب</Label>
                      <Input id="sb-number" dir="ltr" inputMode="numeric" value={bankForm.accountNumber} onChange={(event) => setBank("accountNumber", event.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="sb-sheba">شماره شبا</Label>
                      <Input id="sb-sheba" dir="ltr" placeholder="IR…" value={bankForm.shebaNumber} onChange={(event) => setBank("shebaNumber", event.target.value)} />
                    </div>
                    <label htmlFor="sb-default" className="flex items-center gap-2 text-sm">
                      <input id="sb-default" type="checkbox" className="size-4" checked={bankForm.isDefault} onChange={(event) => setBank("isDefault", event.target.checked)} />
                      حساب پیش‌فرض
                    </label>
                    <label htmlFor="sb-active" className="flex items-center gap-2 text-sm">
                      <input id="sb-active" type="checkbox" className="size-4" checked={bankForm.isActive} onChange={(event) => setBank("isActive", event.target.checked)} />
                      فعال
                    </label>
                    <div className="flex gap-2 md:col-span-2">
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? "در حال ذخیره..." : editingId === null ? "افزودن حساب" : "ذخیره تغییرات"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setBankForm(null)}>
                        انصراف
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-medium text-foreground">یادداشت</h3>
                <p className="whitespace-pre-wrap text-sm">{supplier.note || "-"}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
