"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import {
  PAYMENT_METHODS,
  StatusBadge,
  formatMoney,
  paymentMethodLabels,
  selectClass,
  textareaClass,
  type CustomerFinancialProfile,
  type PaymentMethod,
  type PaymentTermOption,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

type FinancialForm = {
  paymentTermId: string;
  preferredPaymentMethod: "" | PaymentMethod;
  creditLimit: string;
  creditHold: boolean;
  creditHoldReason: string;
};

// «اطلاعات مالی» — credit/payment POLICY only (payment term, preferred
// payment method, credit limit, credit hold). Read and edited only with
// customers.finance (GET/PATCH /customers/:id/financial); without it the
// section just says so. No balance: there is no Sales/finance module yet.
export function FinancialSection({
  customerId,
  canFinance,
  onChanged,
  toasts,
}: {
  customerId: number;
  canFinance: boolean;
  // Reloads the customer so the header's credit-hold banner / missing-data
  // indicators reflect the new policy.
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [profile, setProfile] = useState<CustomerFinancialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terms, setTerms] = useState<PaymentTermOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FinancialForm>({ paymentTermId: "", preferredPaymentMethod: "", creditLimit: "", creditHold: false, creditHoldReason: "" });
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canFinance) return;
    let ignore = false;
    Promise.all([apiFetch<CustomerFinancialProfile>(`/customers/${customerId}/financial`), apiFetch<PaymentTermOption[]>("/payment-terms")])
      .then(([profileData, termsData]) => {
        if (ignore) return;
        setProfile(profileData);
        // Keep a since-deactivated term that is still assigned selectable.
        const current = profileData.paymentTerm;
        setTerms(current && !termsData.some((term) => term.id === current.id) ? [...termsData, current] : termsData);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات مالی ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [customerId, canFinance, reloadKey]);

  function update<K extends keyof FinancialForm>(key: K, value: FinancialForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openEdit() {
    if (!profile) return;
    setForm({
      paymentTermId: profile.paymentTermId ? String(profile.paymentTermId) : "",
      preferredPaymentMethod: profile.preferredPaymentMethod ?? "",
      creditLimit: profile.creditLimit !== null ? String(Number(profile.creditLimit)) : "",
      creditHold: profile.creditHold,
      creditHoldReason: profile.creditHoldReason ?? "",
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const creditLimitText = form.creditLimit.trim();
    const creditLimit = creditLimitText === "" ? null : parseNumberInput(creditLimitText);
    if (creditLimit !== null && (!Number.isInteger(creditLimit) || creditLimit < 0)) {
      pushError("سقف اعتبار باید عدد صحیح و نامنفی (ریال) باشد.");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch<CustomerFinancialProfile>(`/customers/${customerId}/financial`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentTermId: form.paymentTermId ? Number(form.paymentTermId) : null,
          preferredPaymentMethod: form.preferredPaymentMethod || null,
          creditLimit,
          creditHold: form.creditHold,
          creditHoldReason: form.creditHoldReason.trim(),
          updatedAt: profile?.updatedAt ?? new Date().toISOString(),
        }),
      });
      setProfile(updated);
      pushSuccess("اطلاعات مالی مشتری ذخیره شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        // Someone else saved the policy meanwhile — reload it; the user re-applies.
        setDialogOpen(false);
        setReloadKey((current) => current + 1);
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره اطلاعات مالی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (!canFinance) {
    return (
      <DetailSection title="اطلاعات مالی">
        <p className="text-sm text-muted-foreground">مشاهده و ویرایش اطلاعات مالی مشتری نیازمند دسترسی «مدیریت اطلاعات مالی مشتریان» است.</p>
      </DetailSection>
    );
  }

  return (
    <>
      <DetailSection
        title="اطلاعات مالی"
        action={
          profile ? (
            <Button size="sm" variant="outline" onClick={openEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              ویرایش سیاست مالی
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : loadError || !profile ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-sm text-destructive" role="alert">{loadError ?? "دریافت اطلاعات مالی ناموفق بود."}</p>
            <Button size="sm" variant="outline" onClick={() => setReloadKey((current) => current + 1)}>تلاش مجدد</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">شرایط پرداخت</dt>
                <dd className="mt-1">{profile.paymentTerm ? profile.paymentTerm.nameFa : <span className="text-muted-foreground">تعیین نشده (نقدی)</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">روش پرداخت ترجیحی</dt>
                <dd className="mt-1">{profile.preferredPaymentMethod ? paymentMethodLabels[profile.preferredPaymentMethod] : "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">سقف اعتبار</dt>
                <dd className="mt-1 tabular-nums">{profile.creditLimit !== null ? `${formatMoney(profile.creditLimit)} ریال` : <span className="text-muted-foreground">بدون اعتبار</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">توقف اعتباری</dt>
                <dd className="mt-1">
                  <StatusBadge label={profile.creditHold ? "در توقف" : "ندارد"} tone={profile.creditHold ? "destructive" : "muted"} />
                  {profile.creditHold && profile.creditHoldReason ? <span className="mt-1 block text-xs text-muted-foreground">{profile.creditHoldReason}</span> : null}
                </dd>
              </div>
            </dl>
            <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              موجودی پس از راه‌اندازی ماژول فروش/مالی در دسترس خواهد بود
            </p>
          </div>
        )}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ویرایش سیاست مالی مشتری</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="financial-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="financial-term">شرایط پرداخت</Label>
                <select id="financial-term" className={selectClass} value={form.paymentTermId} onChange={(event) => update("paymentTermId", event.target.value)}>
                  <option value="">تعیین نشده (نقدی)</option>
                  {terms.map((term) => (
                    <option key={term.id} value={term.id}>{term.nameFa}{term.isActive ? "" : " (غیرفعال)"}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="financial-method">روش پرداخت ترجیحی</Label>
                <select
                  id="financial-method"
                  className={selectClass}
                  value={form.preferredPaymentMethod}
                  onChange={(event) => update("preferredPaymentMethod", event.target.value as FinancialForm["preferredPaymentMethod"])}
                >
                  <option value="">-</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>{paymentMethodLabels[method]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="financial-limit">سقف اعتبار (ریال)</Label>
                <Input id="financial-limit" inputMode="numeric" placeholder="خالی = بدون اعتبار" value={form.creditLimit} onChange={(event) => update("creditLimit", event.target.value)} />
              </div>
              <label htmlFor="financial-hold" className="flex items-center gap-2 text-sm md:col-span-2">
                <input id="financial-hold" type="checkbox" className="size-4" checked={form.creditHold} onChange={(event) => update("creditHold", event.target.checked)} />
                توقف اعتباری
              </label>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="financial-hold-reason">دلیل توقف اعتباری</Label>
                <textarea id="financial-hold-reason" className={textareaClass} value={form.creditHoldReason} onChange={(event) => update("creditHoldReason", event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="financial-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
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
