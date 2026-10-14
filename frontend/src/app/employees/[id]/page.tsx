"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pencil, UserCheck, UserX, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type BadgeTone } from "@/components/ui/status-badge";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatJalali } from "@/lib/jalali";
import { useAdminUser } from "@/app/admin/layout";
import { ContractsSection } from "../_sections/ContractsSection";
import { TerminationDialog } from "../_sections/TerminationDialog";
import {
  educationLevelLabels,
  exitTypeLabels,
  genderLabels,
  maritalStatusLabels,
  salaryPeriodLabels,
  statusLabels,
  type Employee,
  type EmployeeStatus,
} from "../_sections/shared";
import { formatExpiry, formatTenure } from "../_sections/tenure";

const statusTone: Record<EmployeeStatus, BadgeTone> = { active: "success", on_leave: "warning", terminated: "destructive" };

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
const missing = <span className="text-muted-foreground">وارد نشده</span>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <dl className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </section>
  );
}

// /employees/:id — everything about one employee on its own page: personal
// info, education, employment (with the tenure computed from the contracts),
// the contract history and, for a terminated employee, why and when the
// cooperation ended. «پایان همکاری» needs a written reason.
export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id);
  const user = useAdminUser();
  const canView = user?.permissions.includes("employees.view") ?? false;
  const canManage = user?.permissions.includes("employees.manage") ?? false;
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let ignore = false;
    apiFetch<Employee>(`/employees/${employeeId}`)
      .then((data) => {
        if (!ignore) setEmployee(data);
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
  }, [employeeId, canView]);

  async function reactivate() {
    setBusy(true);
    try {
      setEmployee(await apiFetch<Employee>(`/employees/${employeeId}/reactivate`, { method: "POST" }));
      pushSuccess("کارمند به وضعیت «فعال» بازگشت.");
      setReactivateOpen(false);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "بازگشت به کار ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">اجازهٔ دسترسی به کارکنان را ندارید.</p>
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
  if (!employee) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          <p>{loadError ?? "کارمند یافت نشد."}</p>
          <Link href="/employees" className="text-primary hover:underline">بازگشت به کارکنان ←</Link>
        </div>
      </div>
    );
  }

  const terminated = employee.status === "terminated";
  const hasSalary = Boolean(employee.salaryAmount);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
              {employee.photoPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api${employee.photoPath}`} alt="" className="size-full object-cover" />
              ) : (
                <User className="size-8 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{employee.firstName} {employee.lastName}</h1>
                <StatusBadge label={statusLabels[employee.status]} tone={statusTone[employee.status]} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{employee.code}</span> — {employee.department.name}{employee.position ? ` — ${employee.position}` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/employees" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm hover:bg-muted">بازگشت به فهرست</Link>
            {canManage ? (
              <>
                <Link href={`/employees/${employee.id}/edit`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-sm hover:bg-muted">
                  <Pencil className="size-3.5" aria-hidden="true" />
                  ویرایش
                </Link>
                {terminated ? (
                  <Button type="button" variant="outline" onClick={() => setReactivateOpen(true)}>
                    <UserCheck className="size-4" aria-hidden="true" />
                    بازگشت به کار
                  </Button>
                ) : (
                  <Button type="button" variant="destructive" onClick={() => setTerminateOpen(true)}>
                    <UserX className="size-4" aria-hidden="true" />
                    پایان همکاری
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>

        {terminated ? (
          <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-medium">همکاری با این کارمند خاتمه یافته است{employee.terminationDate ? ` — ${formatJalali(employee.terminationDate)}` : ""}</p>
            <p className="mt-1 text-xs">
              نوع: {employee.terminationType ? exitTypeLabels[employee.terminationType] : "ثبت نشده"}
              {" — "}علت: {employee.terminationReason || "ثبت نشده (پیش از افزودن این بخش خاتمه یافته)"}
            </p>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">سابقه کار در شرکت</h2>
          </div>
          <div className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">مدت همکاری</p>
              <p className="mt-0.5 text-lg font-semibold">{formatTenure(employee.tenure)}</p>
              <p className="text-xs text-muted-foreground">
                {employee.tenure.basis === "contracts"
                  ? `بر اساس مجموع بازه‌های قرارداد${terminated ? " تا تاریخ پایان همکاری" : " تا امروز"}؛ فاصلهٔ بین قراردادها حساب نمی‌شود`
                  : employee.tenure.basis === "hire_date"
                    ? "قراردادی ثبت نشده؛ از تاریخ استخدام محاسبه شده است"
                    : "اطلاعاتی برای محاسبه ثبت نشده است"}
                {employee.tenure.days > 0 ? ` (${employee.tenure.days.toLocaleString("fa-IR")} روز)` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">تاریخ استخدام</p>
              <p className="mt-0.5 text-sm">{formatJalali(employee.hireDate) || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">قرارداد فعلی</p>
              <p className="mt-0.5 text-sm">
                {employee.currentContract ? (
                  <>
                    {employee.currentContract.endDate ? `تا ${formatJalali(employee.currentContract.endDate)}` : "بدون تاریخ پایان"}
                    {!terminated && employee.daysToExpiry !== null ? <span className={employee.contractExpired ? " text-destructive" : " text-muted-foreground"}> ({formatExpiry(employee.daysToExpiry)})</span> : null}
                  </>
                ) : (
                  "ثبت نشده"
                )}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">تعداد قراردادها</p>
              <p className="mt-0.5 text-sm">{employee.contracts.length.toLocaleString("fa-IR")}</p>
            </div>
          </div>
        </section>

        <ContractsSection employee={employee} canManage={canManage} onChanged={setEmployee} toasts={{ pushError, pushErrors, pushSuccess }} />

        <Section title="اطلاعات هویتی و خانوادگی">
          <Field label="جنسیت">{employee.gender ? genderLabels[employee.gender] : missing}</Field>
          <Field label="نام پدر">{employee.fatherName || missing}</Field>
          <Field label="کد ملی">{employee.nationalId || missing}</Field>
          <Field label="شماره شناسنامه">{employee.birthCertificateNumber || missing}</Field>
          <Field label="تاریخ تولد">{formatJalali(employee.birthDate) || missing}</Field>
          <Field label="وضعیت تأهل">{employee.maritalStatus ? maritalStatusLabels[employee.maritalStatus] : missing}</Field>
          <Field label="تعداد فرزند">{employee.childrenCount ?? missing}</Field>
        </Section>

        <Section title="تحصیلات">
          <Field label="مقطع تحصیلی">
            {employee.educationLevel ? educationLevelLabels[employee.educationLevel] : missing}
          </Field>
          {employee.educationLevel === "under_diploma" ? <Field label="تا چه کلاسی">{employee.belowDiplomaGrade || missing}</Field> : null}
          {employee.fieldOfStudy ? <Field label="رشته">{employee.fieldOfStudy}</Field> : null}
        </Section>

        <Section title="اطلاعات استخدام">
          <Field label="واحد سازمانی">{employee.department.name}</Field>
          <Field label="سمت">{employee.position || missing}</Field>
          <Field label="محل انجام کار">{employee.workLocation || missing}</Field>
          <Field label="ساعات کار">{employee.workingHours || missing}</Field>
          <Field label="حقوق">
            {hasSalary ? `${Number(employee.salaryAmount).toLocaleString("fa-IR")} تومان${employee.salaryPeriod ? ` (${salaryPeriodLabels[employee.salaryPeriod]})` : ""}` : missing}
          </Field>
          <Field label="شماره حساب بانکی">{employee.bankAccountNumber || missing}</Field>
        </Section>

        <Section title="اطلاعات تماس و سایر">
          <Field label="تلفن همراه">{employee.mobilePhone || missing}</Field>
          <Field label="تلفن ثابت">{employee.landlinePhone || missing}</Field>
          <Field label="ایمیل">{employee.email || missing}</Field>
          <Field label="آدرس" wide>{employee.address || missing}</Field>
          <Field label="یادداشت" wide>{employee.note || <span className="text-muted-foreground">بدون یادداشت</span>}</Field>
        </Section>
      </div>

      <TerminationDialog open={terminateOpen} onOpenChange={setTerminateOpen} employee={employee} onDone={(updated) => { setEmployee(updated); pushSuccess("پایان همکاری ثبت شد."); }} pushError={pushError} pushErrors={pushErrors} />

      <Dialog open={reactivateOpen} onOpenChange={(open) => (!open && !busy ? setReactivateOpen(false) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>بازگشت به کار</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-sm">
              {employee.firstName} {employee.lastName} دوباره «فعال» شود؟ اطلاعات پایان همکاری (تاریخ، نوع و علت) پاک می‌شود و قراردادها دست‌نخورده می‌مانند؛ برای ادامهٔ همکاری یک قرارداد جدید ثبت کنید.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" disabled={busy} onClick={() => void reactivate()}>{busy ? "در حال ثبت..." : "بازگشت به کار"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setReactivateOpen(false)}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
