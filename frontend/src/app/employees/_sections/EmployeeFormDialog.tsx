"use client";

import type { ChangeEvent, FormEvent } from "react";
import { ImagePlus, Paperclip, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark } from "@/components/ui/form-field";
import {
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

// The add/edit employee popup. The form values, chosen files and saving
// flag live in page.tsx (which also owns validate()/save() and the photo
// object-URL lifecycle via `onChoosePhoto`); this component owns the
// field JSX and the file-picker checks.
export function EmployeeFormDialog({
  open,
  onClose,
  editingId,
  form,
  update,
  departments,
  photoPreviewSrc,
  photoFile,
  onChoosePhoto,
  contractDocumentFile,
  setContractDocumentFile,
  existingContractDocumentPath,
  saving,
  onSubmit,
  pushError,
}: {
  open: boolean;
  onClose: () => void;
  editingId: number | null;
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  departments: Department[];
  photoPreviewSrc: string | null;
  photoFile: File | null;
  onChoosePhoto: (file: File | null) => void;
  contractDocumentFile: File | null;
  setContractDocumentFile: (file: File | null) => void;
  existingContractDocumentPath: string | null;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pushError: (message: string) => void;
}) {
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
    onChoosePhoto(file);
  }

  function handleContractDocumentChange(event: ChangeEvent<HTMLInputElement>) {
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
    setContractDocumentFile(file);
  }

  // Add/edit is a popup: fixed to the screen and centered, with its own
  // backdrop. It never becomes part of the page's layout, so the page
  // itself never needs to scroll to reach it or its buttons — only the
  // field area inside the popup scrolls, and only if it doesn't fit.
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingId ? "ویرایش کارمند" : "افزودن کارمند جدید"}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="employee-form" onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" autoComplete="off" noValidate>
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
                      onClick={() => onChoosePhoto(null)}
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
                <Input id="employee-code" value={form.code} disabled readOnly />
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
                  if (value !== "under_diploma") update("belowDiplomaGrade", "");
                  // رشته applies at every level (e.g. a bachelor's in
                  // accounting) — only clear it when education is unset
                  // entirely, not when switching between levels.
                  if (value === "") update("fieldOfStudy", "");
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
            {form.educationLevel !== "" ? (
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
              <Label htmlFor="employee-contract-type">نوع قرارداد</Label>
              <select
                id="employee-contract-type"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.contractType}
                onChange={(event) => update("contractType", event.target.value as ContractType | "")}
              >
                <option value="">مشخص نشده</option>
                {Object.entries(contractTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-contract-start-date-year">تاریخ شروع قرارداد</Label>
              <JalaliDateInput
                idPrefix="employee-contract-start-date"
                value={form.contractStartDate}
                onChange={(value) => update("contractStartDate", value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-contract-end-date-year">تاریخ پایان قرارداد</Label>
              <JalaliDateInput
                idPrefix="employee-contract-end-date"
                value={form.contractEndDate}
                onChange={(value) => update("contractEndDate", value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee-salary-amount">مبلغ حقوق (تومان)</Label>
              <Input
                id="employee-salary-amount"
                autoComplete="off"
                inputMode="numeric"
                value={form.salaryAmount}
                onChange={(event) => update("salaryAmount", digitsOnly(event.target.value, 12))}
              />
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
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="employee-contract-document">فایل قرارداد (PDF یا تصویر، اختیاری)</Label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted">
                  <Paperclip className="size-3.5" aria-hidden="true" />
                  انتخاب فایل
                  <input
                    id="employee-contract-document"
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="hidden"
                    onChange={handleContractDocumentChange}
                  />
                </label>
                {contractDocumentFile ? (
                  <button
                    type="button"
                    onClick={() => setContractDocumentFile(null)}
                    className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" aria-hidden="true" />
                    {contractDocumentFile.name}
                  </button>
                ) : existingContractDocumentPath ? (
                  <a
                    href={`/api${existingContractDocumentPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline"
                  >
                    مشاهده فایل فعلی قرارداد
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground">فایلی انتخاب نشده — حداکثر ۱۰ مگابایت</p>
                )}
              </div>
            </div>

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
                <select
                  id="employee-status"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.status}
                  onChange={(event) => update("status", event.target.value as EmployeeStatus)}
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
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
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="employee-form" disabled={saving}>{saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد کارمند"}</Button>
          <Button type="button" variant="outline" onClick={onClose}>انصراف</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
