"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Paperclip, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark } from "@/components/ui/form-field";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { todayIso } from "@/lib/format";
import { JALALI_MAX_YEAR } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  FIELD_OF_STUDY_LEVELS,
  PERSIAN_NAME_REGEX,
  contractTypeLabels,
  digitsOnly,
  educationLevelLabels,
  genderLabels,
  maritalStatusLabels,
  persianTextOnly,
  salaryPeriodLabels,
  statusLabels,
  type ContractType,
  type Department,
  type EducationLevel,
  type Employee,
  type EmployeeStatus,
  type FormState,
  type Gender,
  type MaritalStatus,
  type SalaryPeriod,
} from "./shared";

const ALLOWED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTRACT_DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_CONTRACT_DOCUMENT_BYTES = 10 * 1024 * 1024;

function emptyForm(): FormState {
  return {
    code: "", firstName: "", lastName: "", departmentId: "", position: "", nationalId: "", mobilePhone: "", landlinePhone: "", birthDate: "",
    hireDate: todayIso(), email: "", note: "", status: "active", fatherName: "", birthCertificateNumber: "", maritalStatus: "", childrenCount: "",
    gender: "", educationLevel: "", belowDiplomaGrade: "", fieldOfStudy: "", workLocation: "", workingHours: "", contractType: "", contractStartDate: "",
    contractEndDate: "", salaryAmount: "", salaryPeriod: "", bankAccountNumber: "", address: "",
  };
}

function formFromEmployee(employee: Employee): FormState {
  return {
    code: employee.code, firstName: employee.firstName, lastName: employee.lastName, departmentId: String(employee.department.id), position: employee.position ?? "",
    nationalId: employee.nationalId ?? "", mobilePhone: employee.mobilePhone ?? "", landlinePhone: employee.landlinePhone ?? "",
    birthDate: employee.birthDate ? employee.birthDate.slice(0, 10) : "", hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
    email: employee.email ?? "", note: employee.note ?? "", status: employee.status, fatherName: employee.fatherName ?? "",
    birthCertificateNumber: employee.birthCertificateNumber ?? "", maritalStatus: employee.maritalStatus ?? "",
    childrenCount: employee.childrenCount != null ? String(employee.childrenCount) : "", gender: employee.gender ?? "",
    educationLevel: employee.educationLevel ?? "", belowDiplomaGrade: employee.belowDiplomaGrade ?? "", fieldOfStudy: employee.fieldOfStudy ?? "",
    workLocation: employee.workLocation ?? "", workingHours: employee.workingHours ?? "", contractType: "", contractStartDate: "", contractEndDate: "",
    salaryAmount: employee.salaryAmount ?? "", salaryPeriod: employee.salaryPeriod ?? "", bankAccountNumber: employee.bankAccountNumber ?? "", address: employee.address ?? "",
  };
}

// «کارمند جدید» / «ویرایش کارمند» as its own page (it used to be a popup on
// the list). Edit has no contract fields — the contract history is managed on
// the employee's page — and cannot move an employee into/out of «خاتمه همکاری»
// (that needs a reason: the «پایان همکاری» button there).
export function EmployeeForm({ employeeId }: { employeeId: number | null }) {
  const editingId = employeeId;
  const router = useRouter();
  const user = useAdminUser();
  const canManage = user?.permissions.includes("employees.manage") ?? false;
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const photoObjectUrlRef = useRef<string | null>(null);
  const [existingPhotoPath, setExistingPhotoPath] = useState<string | null>(null);
  // Scan of the FIRST contract (create form only) — uploaded to that contract once the employee is saved.
  const [contractFile, setContractFile] = useState<File | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let ignore = false;
    Promise.all([apiFetch<Department[]>("/departments"), editingId ? apiFetch<Employee>(`/employees/${editingId}`) : Promise.resolve(null)])
      .then(([departmentRows, employee]) => {
        if (ignore) return;
        setDepartments(departmentRows.filter((department) => department.status === "active" || (employee && department.id === employee.department.id)));
        if (employee) {
          setForm(formFromEmployee(employee));
          setExistingPhotoPath(employee.photoPath);
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات کارمند ناموفق بود.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [canManage, editingId]);

  // Live preview for a newly-chosen (not yet uploaded) photo; the object URL
  // is created/revoked right where the file changes.
  function choosePhoto(file: File | null) {
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    photoObjectUrlRef.current = url;
    setPhotoFile(file);
    setPhotoObjectUrl(url);
  }
  useEffect(() => {
    const ref = photoObjectUrlRef;
    return () => {
      if (ref.current) URL.revokeObjectURL(ref.current);
      ref.current = null;
    };
  }, []);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      pushError("فرمت تصویر باید jpg، png یا webp باشد.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      pushError("حجم تصویر نباید بیشتر از ۵ مگابایت باشد.");
      return;
    }
    choosePhoto(file);
  }

  function handleContractFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!ALLOWED_CONTRACT_DOCUMENT_TYPES.includes(file.type)) {
      pushError("فرمت فایل قرارداد باید PDF یا تصویر jpg/png باشد.");
      return;
    }
    if (file.size > MAX_CONTRACT_DOCUMENT_BYTES) {
      pushError("حجم فایل قرارداد نباید بیشتر از ۱۰ مگابایت باشد.");
      return;
    }
    setContractFile(file);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // One specific message per problem, so several issues at once each get
  // their own clear notification instead of a single vague sentence.
  function validate(): string[] {
    const errors: string[] = [];
    if (!form.departmentId) errors.push("واحد سازمانی را انتخاب کنید.");
    if (editingId && form.code.trim().length < 2) errors.push("کد پرسنلی را وارد کنید (حداقل ۲ نویسه).");
    if (!form.firstName.trim()) errors.push("نام را وارد کنید.");
    else if (!PERSIAN_NAME_REGEX.test(form.firstName.trim())) errors.push("نام باید فقط شامل حروف فارسی باشد.");
    if (!form.lastName.trim()) errors.push("نام خانوادگی را وارد کنید.");
    else if (!PERSIAN_NAME_REGEX.test(form.lastName.trim())) errors.push("نام خانوادگی باید فقط شامل حروف فارسی باشد.");
    if (!form.mobilePhone.trim()) errors.push("تلفن همراه را وارد کنید.");
    else if (!/^[0-9]{11}$/.test(form.mobilePhone.trim())) errors.push("تلفن همراه باید دقیقاً ۱۱ رقم باشد.");
    if (!form.nationalId.trim()) errors.push("کد ملی را وارد کنید.");
    else if (!/^[0-9]{10}$/.test(form.nationalId.trim())) errors.push("کد ملی باید دقیقاً ۱۰ رقم باشد.");
    if (!form.birthDate) errors.push("تاریخ تولد را مشخص کنید.");
    if (!form.hireDate) errors.push("تاریخ استخدام را مشخص کنید.");
    if (form.landlinePhone.trim() && !/^[0-9]{6,11}$/.test(form.landlinePhone.trim())) errors.push("تلفن ثابت واردشده معتبر نیست.");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.push("ایمیل واردشده معتبر نیست.");
    if (form.fatherName.trim() && !PERSIAN_NAME_REGEX.test(form.fatherName.trim())) errors.push("نام پدر باید فقط شامل حروف فارسی باشد.");
    if (form.educationLevel === "under_diploma" && !form.belowDiplomaGrade.trim()) errors.push("در صورت انتخاب «زیر دیپلم»، مقطع تحصیلی (تا چه کلاسی) را مشخص کنید.");
    if (form.childrenCount.trim() && (!/^[0-9]+$/.test(form.childrenCount.trim()) || Number(form.childrenCount) < 0)) errors.push("تعداد فرزندان باید عددی صحیح و غیرمنفی باشد.");
    if (form.salaryAmount.trim() && (Number.isNaN(Number(form.salaryAmount)) || Number(form.salaryAmount) < 0)) errors.push("مبلغ حقوق باید عددی غیرمنفی باشد.");
    if (form.salaryAmount.trim() && !form.salaryPeriod) errors.push("دوره پرداخت حقوق (ماهانه، هفتگی یا روزانه) را مشخص کنید.");
    if (!editingId && contractFile && !form.contractType) errors.push("برای بارگذاری فایل قرارداد، ابتدا نوع قرارداد را انتخاب کنید.");
    if (!editingId && form.contractType) {
      if (!form.contractStartDate) errors.push("تاریخ شروع قرارداد را وارد کنید.");
      if (form.contractType !== "permanent" && !form.contractEndDate) errors.push("برای قرارداد موقت یا کار معین، تاریخ پایان را وارد کنید.");
      if (form.contractStartDate && form.contractEndDate && form.contractEndDate < form.contractStartDate) errors.push("تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد.");
    }
    return errors;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationErrors = validate();
    if (validationErrors.length > 0) {
      pushErrors(validationErrors);
      return;
    }
    setSaving(true);
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      departmentId: Number(form.departmentId),
      position: form.position.trim() || undefined,
      nationalId: form.nationalId.trim(),
      mobilePhone: form.mobilePhone.trim(),
      landlinePhone: form.landlinePhone.trim() || undefined,
      birthDate: form.birthDate,
      hireDate: form.hireDate,
      email: form.email.trim() || undefined,
      note: form.note.trim() || undefined,
      fatherName: form.fatherName.trim() || undefined,
      birthCertificateNumber: form.birthCertificateNumber.trim() || undefined,
      maritalStatus: form.maritalStatus || undefined,
      childrenCount: form.childrenCount.trim() ? Number(form.childrenCount) : undefined,
      gender: form.gender || undefined,
      educationLevel: form.educationLevel || undefined,
      belowDiplomaGrade: form.belowDiplomaGrade.trim() || undefined,
      fieldOfStudy: form.fieldOfStudy.trim() || undefined,
      workLocation: form.workLocation.trim() || undefined,
      workingHours: form.workingHours.trim() || undefined,
      salaryAmount: form.salaryAmount.trim() ? Number(form.salaryAmount) : undefined,
      salaryPeriod: form.salaryPeriod || undefined,
      bankAccountNumber: form.bankAccountNumber.trim() || undefined,
      address: form.address.trim() || undefined,
      ...(editingId ? { status: form.status, code: form.code.trim() } : { contractType: form.contractType || undefined, contractStartDate: form.contractType ? form.contractStartDate : undefined, contractEndDate: form.contractType && form.contractType !== "permanent" ? form.contractEndDate : undefined }),
    };
    try {
      const saved = await apiFetch<Employee>(editingId ? `/employees/${editingId}` : "/employees", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (photoFile) {
        try {
          await apiUpload(`/employees/${saved.id}/photo`, photoFile);
        } catch (reason) {
          pushError((reason as ApiError).message ?? "بارگذاری تصویر کارمند ناموفق بود.");
        }
      }
      if (contractFile && saved.contracts[0]) {
        try {
          await apiUpload(`/employees/${saved.id}/contracts/${saved.contracts[0].id}/document`, contractFile);
        } catch (reason) {
          pushError((reason as ApiError).message ?? "بارگذاری فایل قرارداد ناموفق بود؛ از صفحهٔ کارمند دوباره بارگذاری کنید.");
        }
      }
      router.push(`/employees/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیرهٔ اطلاعات کارمند ناموفق بود.");
      setSaving(false);
    }
  }
  void pushSuccess;

  const photoPreviewSrc = photoObjectUrl ?? (existingPhotoPath ? `/api${existingPhotoPath}` : null);
  const backHref = editingId ? `/employees/${editingId}` : "/employees";

  if (!canManage) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">اجازهٔ ثبت یا ویرایش کارمند را ندارید.</p>
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
  if (loadError) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-destructive/40 p-10 text-center text-sm text-destructive" role="alert">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{editingId ? "ویرایش کارمند" : "افزودن کارمند جدید"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{editingId ? `${form.firstName} ${form.lastName} — ${form.code}` : "کد پرسنلی پس از ثبت به‌صورت خودکار ساخته می‌شود."}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <form id="employee-form" onSubmit={save} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" autoComplete="off" noValidate>
            <div className="flex flex-col gap-2">
              <Label>تصویر کارمند (اختیاری)</Label>
              <div className="flex items-center gap-3">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                  {photoPreviewSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreviewSrc} alt="تصویر کارمند" className="size-full object-cover" />
                  ) : (
                    <User className="size-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted">
                    <ImagePlus className="size-3.5" aria-hidden="true" />
                    انتخاب تصویر
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePhotoChange} />
                  </label>
                  {photoFile ? (
                    <button
                      type="button"
                      onClick={() => choosePhoto(null)}
                      className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" aria-hidden="true" />
                      {photoFile.name}
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground">حداکثر ۵ مگابایت</p>
                  )}
                </div>
              </div>
            </div>
            {editingId ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee-code">کد پرسنلی</Label>
                <Input id="employee-code" dir="ltr" autoComplete="off" maxLength={30} value={form.code} onChange={(event) => update("code", event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} />
                <p className="text-xs text-muted-foreground">حروف انگلیسی، عدد، خط تیره و زیرخط؛ باید یکتا باشد.</p>
              </div>
            ) : null}

            {/* اطلاعات هویتی و خانوادگی */}
            <div className="mt-1 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
              <h3 className="text-sm font-medium text-foreground">اطلاعات هویتی و خانوادگی</h3>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-first-name">نام<RequiredMark /></Label>
              <Input
                id="employee-first-name"
                autoComplete="off"
                value={form.firstName}
                onChange={(event) => update("firstName", persianTextOnly(event.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-last-name">نام خانوادگی<RequiredMark /></Label>
              <Input
                id="employee-last-name"
                autoComplete="off"
                value={form.lastName}
                onChange={(event) => update("lastName", persianTextOnly(event.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-gender">جنسیت</Label>
              <select
                id="employee-gender"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.gender}
                onChange={(event) => update("gender", event.target.value as Gender | "")}
              >
                <option value="">مشخص نشده</option>
                {Object.entries(genderLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-father-name">نام پدر</Label>
              <Input
                id="employee-father-name"
                autoComplete="off"
                value={form.fatherName}
                onChange={(event) => update("fatherName", persianTextOnly(event.target.value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-national-id">کد ملی<RequiredMark /></Label>
              <Input
                id="employee-national-id"
                autoComplete="off"
                inputMode="numeric"
                placeholder="10 رقم"
                maxLength={10}
                value={form.nationalId}
                onChange={(event) => update("nationalId", digitsOnly(event.target.value, 10))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-birth-certificate-number">شماره شناسنامه</Label>
              <Input
                id="employee-birth-certificate-number"
                autoComplete="off"
                value={form.birthCertificateNumber}
                onChange={(event) => update("birthCertificateNumber", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-birth-date-year">تاریخ تولد<RequiredMark /></Label>
              <JalaliDateInput idPrefix="employee-birth-date" value={form.birthDate} onChange={(value) => update("birthDate", value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-marital-status">وضعیت تأهل</Label>
              <select
                id="employee-marital-status"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.maritalStatus}
                onChange={(event) => update("maritalStatus", event.target.value as MaritalStatus | "")}
              >
                <option value="">مشخص نشده</option>
                {Object.entries(maritalStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-children-count">تعداد فرزند (اگر دارد)</Label>
              <Input
                id="employee-children-count"
                autoComplete="off"
                inputMode="numeric"
                maxLength={2}
                value={form.childrenCount}
                onChange={(event) => update("childrenCount", digitsOnly(event.target.value, 2))}
              />
            </div>

            {/* تحصیلات */}
            <div className="mt-1 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
              <h3 className="text-sm font-medium text-foreground">تحصیلات</h3>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-education-level">تحصیلات</Label>
              <select
                id="employee-education-level"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.educationLevel}
                onChange={(event) => {
                  const value = event.target.value as EducationLevel | "";
                  update("educationLevel", value);
                  // «تا چه کلاسی» belongs to زیر دیپلم only; «رشته» only from کاردانی up.
                  if (value !== "under_diploma") update("belowDiplomaGrade", "");
                  if (!FIELD_OF_STUDY_LEVELS.includes(value as EducationLevel)) update("fieldOfStudy", "");
                }}
              >
                <option value="">مشخص نشده</option>
                {Object.entries(educationLevelLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            {form.educationLevel === "under_diploma" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee-below-diploma-grade">تا چه کلاسی<RequiredMark /></Label>
                <Input
                  id="employee-below-diploma-grade"
                  autoComplete="off"
                  placeholder="مثلاً: کلاس نهم"
                  value={form.belowDiplomaGrade}
                  onChange={(event) => update("belowDiplomaGrade", event.target.value)}
                />
              </div>
            ) : null}
            {FIELD_OF_STUDY_LEVELS.includes(form.educationLevel as EducationLevel) ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee-field-of-study">رشته</Label>
                <Input
                  id="employee-field-of-study"
                  autoComplete="off"
                  placeholder="مثلاً: حسابداری، برق، فنی حرفه‌ای"
                  value={form.fieldOfStudy}
                  onChange={(event) => update("fieldOfStudy", event.target.value)}
                />
              </div>
            ) : null}

            {/* اطلاعات استخدام و قرارداد */}
            <div className="mt-1 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
              <h3 className="text-sm font-medium text-foreground">اطلاعات استخدام و قرارداد</h3>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-department">واحد سازمانی<RequiredMark /></Label>
              <select
                id="employee-department"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.departmentId}
                onChange={(event) => update("departmentId", event.target.value)}
                required
              >
                <option value="" disabled>انتخاب کنید</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
              {!editingId ? (
                <p className="text-xs text-muted-foreground">کد پرسنلی پس از ثبت، به‌صورت خودکار بر اساس این واحد ساخته می‌شود.</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-position">سمت</Label>
              <Input id="employee-position" autoComplete="off" value={form.position} onChange={(event) => update("position", event.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-work-location">محل انجام کار</Label>
              <Input
                id="employee-work-location"
                autoComplete="off"
                value={form.workLocation}
                onChange={(event) => update("workLocation", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-working-hours">ساعات کار</Label>
              <Input
                id="employee-working-hours"
                autoComplete="off"
                placeholder="مثلاً: ۸ صبح تا ۴ بعدازظهر"
                value={form.workingHours}
                onChange={(event) => update("workingHours", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-salary-amount">مبلغ حقوق (تومان)</Label>
              <MoneyInput id="employee-salary-amount" value={form.salaryAmount} onChange={(value) => update("salaryAmount", value.slice(0, 12))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-salary-period">دوره پرداخت حقوق</Label>
              <select
                id="employee-salary-period"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.salaryPeriod}
                onChange={(event) => update("salaryPeriod", event.target.value as SalaryPeriod | "")}
              >
                <option value="">مشخص نشده</option>
                {Object.entries(salaryPeriodLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-bank-account-number">شماره حساب بانکی</Label>
              <Input
                id="employee-bank-account-number"
                autoComplete="off"
                placeholder="شماره حساب، شماره کارت یا شبا"
                value={form.bankAccountNumber}
                onChange={(event) => update("bankAccountNumber", event.target.value)}
              />
            </div>
            {/* قرارداد اول — only when creating; later contracts and extensions are managed on the employee's page */}
            {!editingId ? (
              <>
                <div className="mt-1 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
                  <h3 className="text-sm font-medium text-foreground">قرارداد اول (اختیاری)</h3>
                  <p className="mt-1 text-xs text-muted-foreground">تمدیدها و قراردادهای بعدی را بعد از ثبت، در صفحهٔ کارمند اضافه کنید؛ سابقه کار از روی قراردادها محاسبه می‌شود.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="employee-contract-type">نوع قرارداد</Label>
                  <select
                    id="employee-contract-type"
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.contractType}
                    onChange={(event) => update("contractType", event.target.value as ContractType | "")}
                  >
                    <option value="">بدون قرارداد (فعلاً)</option>
                    {Object.entries(contractTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                {form.contractType ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="employee-contract-start-date-year">تاریخ شروع قرارداد<RequiredMark /></Label>
                      <JalaliDateInput idPrefix="employee-contract-start-date" value={form.contractStartDate} onChange={(value) => update("contractStartDate", value)} maxYear={JALALI_MAX_YEAR} />
                    </div>
                    {form.contractType !== "permanent" ? (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="employee-contract-end-date-year">تاریخ پایان قرارداد<RequiredMark /></Label>
                        <JalaliDateInput idPrefix="employee-contract-end-date" value={form.contractEndDate} minDate={form.contractStartDate || undefined} onChange={(value) => update("contractEndDate", value)} maxYear={JALALI_MAX_YEAR} />
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
                  <Label htmlFor="employee-contract-document">فایل قرارداد (PDF یا تصویر، اختیاری)</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted">
                      <Paperclip className="size-3.5" aria-hidden="true" />
                      انتخاب فایل
                      <input id="employee-contract-document" type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={handleContractFileChange} />
                    </label>
                    {contractFile ? (
                      <button type="button" onClick={() => setContractFile(null)} className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-destructive">
                        <X className="size-3" aria-hidden="true" />
                        {contractFile.name}
                      </button>
                    ) : (
                      <p className="text-xs text-muted-foreground">فایلی انتخاب نشده — حداکثر ۱۰ مگابایت</p>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {/* اطلاعات تماس و سایر */}
            <div className="mt-1 border-t border-border pt-3 sm:col-span-2 lg:col-span-3">
              <h3 className="text-sm font-medium text-foreground">اطلاعات تماس و سایر</h3>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-landline-phone">تلفن ثابت</Label>
              <Input
                id="employee-landline-phone"
                autoComplete="off"
                inputMode="numeric"
                maxLength={11}
                value={form.landlinePhone}
                onChange={(event) => update("landlinePhone", digitsOnly(event.target.value, 11))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-mobile-phone">تلفن همراه<RequiredMark /></Label>
              <Input
                id="employee-mobile-phone"
                autoComplete="off"
                inputMode="numeric"
                placeholder="09xxxxxxxxx"
                maxLength={11}
                value={form.mobilePhone}
                onChange={(event) => update("mobilePhone", digitsOnly(event.target.value, 11))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-email">ایمیل</Label>
              <Input id="employee-email" type="email" autoComplete="off" value={form.email} onChange={(event) => update("email", event.target.value)} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="employee-address">آدرس</Label>
              <textarea
                id="employee-address"
                className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-hire-date-year">تاریخ استخدام<RequiredMark /></Label>
              <JalaliDateInput idPrefix="employee-hire-date" value={form.hireDate} onChange={(value) => update("hireDate", value)} required />
            </div>
            {editingId ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="employee-status">وضعیت</Label>
                {form.status === "terminated" ? (
                  <p className="flex h-9 items-center text-sm text-muted-foreground">{statusLabels.terminated} — از صفحهٔ کارمند با «بازگشت به کار» تغییر می‌کند</p>
                ) : (
                  <select
                    id="employee-status"
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.status}
                    onChange={(event) => update("status", event.target.value as EmployeeStatus)}
                  >
                    <option value="active">{statusLabels.active}</option>
                    <option value="on_leave">{statusLabels.on_leave}</option>
                  </select>
                )}
                <p className="text-xs text-muted-foreground">برای پایان همکاری (استعفا، اخراج، …) از دکمهٔ «پایان همکاری» در صفحهٔ کارمند استفاده کنید تا علت ثبت شود.</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="employee-note">یادداشت</Label>
              <textarea
                id="employee-note"
                className="min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                value={form.note}
                onChange={(event) => update("note", event.target.value)}
              />
            </div>
          </form>
        </div>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="employee-form" disabled={saving}>{saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد کارمند"}</Button>
          <Link href={backHref} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-muted">انصراف</Link>
        </div>
      </div>
    </div>
  );
}
