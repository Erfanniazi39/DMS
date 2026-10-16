"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark, textareaClass } from "@/components/ui/form-field";
import { RequirePermission } from "@/components/require-permission";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { loadCompanyProfile, type CompanyProfile } from "@/lib/company";

// تنظیمات › مشخصات شرکت — the company's own details printed on invoices and
// other documents. GET /company (any user) / PUT /company (company.manage).
// Documents read it live; changing it changes how documents print from now on.
type FormState = Record<
  | "legalName" | "brandName" | "companyType" | "nationalId" | "economicCode" | "registrationNumber"
  | "province" | "city" | "postalCode" | "address" | "phone1" | "phone2" | "fax" | "email" | "website" | "documentFooter",
  string
>;

const emptyForm: FormState = {
  legalName: "", brandName: "", companyType: "", nationalId: "", economicCode: "", registrationNumber: "",
  province: "", city: "", postalCode: "", address: "", phone1: "", phone2: "", fax: "", email: "", website: "", documentFooter: "",
};

function toForm(profile: CompanyProfile): FormState {
  const form = { ...emptyForm };
  for (const key of Object.keys(form) as (keyof FormState)[]) form[key] = profile[key] ?? "";
  return form;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CompanyContent() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  useEffect(() => {
    let ignore = false;
    loadCompanyProfile(true)
      .then((profile) => {
        if (ignore) return;
        setForm(toForm(profile));
        setLogoUrl(profile.logoUrl);
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت مشخصات شرکت ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const set = (key: keyof FormState) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function reportError(reason: unknown, fallback: string) {
    const apiError = reason as ApiError;
    if (apiError.messages && apiError.messages.length > 0) pushErrors(apiError.messages);
    else pushError(apiError.message ?? fallback);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.legalName.trim()) {
      pushError("نام رسمی شرکت الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const profile = await apiFetch<CompanyProfile>("/company", { method: "PUT", body: JSON.stringify(form) });
      await loadCompanyProfile(true);
      setForm(toForm(profile));
      pushSuccess("مشخصات شرکت ذخیره شد.");
    } catch (reason) {
      reportError(reason, "ذخیره مشخصات شرکت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    try {
      const profile = await apiUpload<CompanyProfile>("/company/logo", file);
      await loadCompanyProfile(true);
      setLogoUrl(profile.logoUrl);
      pushSuccess("لوگو ذخیره شد.");
    } catch (reason) {
      reportError(reason, "بارگذاری لوگو ناموفق بود.");
    }
  }

  async function removeLogo() {
    try {
      await apiFetch("/company/logo", { method: "DELETE" });
      await loadCompanyProfile(true);
      setLogoUrl(null);
      pushSuccess("لوگو حذف شد.");
    } catch (reason) {
      reportError(reason, "حذف لوگو ناموفق بود.");
    }
  }

  if (loading) return <p className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p role="alert" className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <form onSubmit={save} className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">مشخصات شرکت</h1>
            <p className="mt-2 text-sm text-muted-foreground">این اطلاعات در بالای فاکتور، حواله و سایر اسناد چاپی درج می‌شود. تغییر آن از این پس روی چاپ همهٔ اسناد اثر می‌گذارد.</p>
          </div>
          <Button type="submit" disabled={saving}>
            <Save className="size-4" aria-hidden="true" />
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">هویت شرکت</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="نام رسمی شرکت" required>
              <Input value={form.legalName} onChange={set("legalName")} maxLength={200} />
            </Field>
            <Field label="نام تجاری / برند" hint="اگر با نام رسمی فرق دارد">
              <Input value={form.brandName} onChange={set("brandName")} maxLength={200} />
            </Field>
            <Field label="نوع شرکت" hint="مثلاً سهامی خاص، با مسئولیت محدود">
              <Input value={form.companyType} onChange={set("companyType")} maxLength={100} />
            </Field>
            <Field label="شماره ثبت">
              <Input value={form.registrationNumber} onChange={set("registrationNumber")} maxLength={50} dir="ltr" />
            </Field>
            <Field label="شناسه ملی" hint="۱۱ رقم">
              <Input value={form.nationalId} onChange={set("nationalId")} maxLength={11} inputMode="numeric" dir="ltr" />
            </Field>
            <Field label="کد اقتصادی" hint="۱۲ تا ۱۴ رقم">
              <Input value={form.economicCode} onChange={set("economicCode")} maxLength={20} inputMode="numeric" dir="ltr" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">نشانی و تماس</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="استان">
              <Input value={form.province} onChange={set("province")} maxLength={100} />
            </Field>
            <Field label="شهر">
              <Input value={form.city} onChange={set("city")} maxLength={100} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="نشانی کامل">
                <textarea className={`${textareaClass} w-full`} value={form.address} onChange={set("address")} maxLength={500} rows={2} />
              </Field>
            </div>
            <Field label="کد پستی" hint="۱۰ رقم">
              <Input value={form.postalCode} onChange={set("postalCode")} maxLength={10} inputMode="numeric" dir="ltr" />
            </Field>
            <Field label="تلفن">
              <Input value={form.phone1} onChange={set("phone1")} maxLength={30} dir="ltr" />
            </Field>
            <Field label="تلفن ۲">
              <Input value={form.phone2} onChange={set("phone2")} maxLength={30} dir="ltr" />
            </Field>
            <Field label="فکس">
              <Input value={form.fax} onChange={set("fax")} maxLength={30} dir="ltr" />
            </Field>
            <Field label="ایمیل">
              <Input value={form.email} onChange={set("email")} maxLength={200} dir="ltr" />
            </Field>
            <Field label="وب‌سایت">
              <Input value={form.website} onChange={set("website")} maxLength={200} dir="ltr" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">چاپ اسناد</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="متن پایین اسناد" hint="در انتهای فاکتور و سایر اسناد چاپ می‌شود (اختیاری)">
              <textarea className={`${textareaClass} w-full`} value={form.documentFooter} onChange={set("documentFooter")} maxLength={500} rows={2} />
            </Field>
            <div className="space-y-1.5">
              <Label>لوگوی شرکت</Label>
              <div className="flex items-center gap-4">
                <div className="flex h-24 w-40 items-center justify-center border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api${logoUrl}`} alt="لوگوی شرکت" className="max-h-full max-w-full object-contain" />
                  ) : (
                    "بدون لوگو"
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadLogo(file);
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                    <ImagePlus className="size-3.5" aria-hidden="true" />
                    {logoUrl ? "تعویض لوگو" : "انتخاب لوگو"}
                  </Button>
                  {logoUrl ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => void removeLogo()}>
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      حذف لوگو
                    </Button>
                  ) : null}
                  <p className="text-xs text-muted-foreground">png یا jpg، حداکثر ۲ مگابایت. لوگو بلافاصله ذخیره می‌شود.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

export default function CompanySettingsPage() {
  return (
    <RequirePermission permission="company.manage" message="شما اجازهٔ ویرایش مشخصات شرکت را ندارید.">
      <CompanyContent />
    </RequirePermission>
  );
}
