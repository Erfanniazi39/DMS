"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { todayIso } from "@/lib/format";
import { apiFetch, type ApiError } from "@/lib/api";
import { exitTypeLabels, type Employee, type ExitType } from "./shared";

// «پایان همکاری»: disables the employee (status «خاتمه همکاری») and records
// when, how (استعفا، اخراج، پایان قرارداد، بازنشستگی، سایر) and WHY. Tenure
// stops at the date entered. POST /employees/:id/terminate (employees.manage).
export function TerminationDialog({
  open,
  onOpenChange,
  employee,
  onDone,
  pushError,
  pushErrors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee;
  onDone: (employee: Employee) => void;
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
}) {
  const [date, setDate] = useState("");
  const [type, setType] = useState<ExitType | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDate(todayIso());
      setType("");
      setReason("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    if (!date) problems.push("تاریخ پایان همکاری را وارد کنید.");
    if (!type) problems.push("نوع پایان همکاری را انتخاب کنید.");
    if (reason.trim().length < 3) problems.push("علت پایان همکاری را بنویسید.");
    if (date && employee.hireDate && date < employee.hireDate.slice(0, 10)) problems.push("تاریخ پایان همکاری نمی‌تواند قبل از تاریخ استخدام باشد.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      onDone(await apiFetch<Employee>(`/employees/${employee.id}/terminate`, { method: "POST", body: JSON.stringify({ terminationDate: date, terminationType: type, terminationReason: reason.trim() }) }));
      onOpenChange(false);
    } catch (reasonError) {
      const error = reasonError as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت پایان همکاری ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && !saving ? onOpenChange(false) : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>پایان همکاری با {employee.firstName} {employee.lastName}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <form id="terminate-form" className="grid gap-4" onSubmit={submit} noValidate>
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              کارمند به وضعیت «خاتمه همکاری» می‌رود و سابقهٔ کار او تا تاریخ زیر محاسبه می‌شود. بعداً می‌توانید او را «بازگشت به کار» دهید.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="termination-date-year">تاریخ پایان همکاری<RequiredMark /></Label>
                <JalaliDateInput idPrefix="termination-date" value={date} minDate={employee.hireDate ? employee.hireDate.slice(0, 10) : undefined} onChange={setDate} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="termination-type">نوع پایان همکاری<RequiredMark /></Label>
                <select id="termination-type" className={selectClass} value={type} onChange={(event) => setType(event.target.value as ExitType | "")}>
                  <option value="">انتخاب کنید</option>
                  {Object.entries(exitTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="termination-reason">علت<RequiredMark /></Label>
              <textarea id="termination-reason" className={textareaClass} maxLength={1000} placeholder="مثلاً: استعفا به دلیل مهاجرت، اخراج به علت غیبت مکرر، عدم تمدید قرارداد…" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" form="terminate-form" variant="destructive" disabled={saving}>{saving ? "در حال ثبت..." : "ثبت پایان همکاری"}</Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>انصراف</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
