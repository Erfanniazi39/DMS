"use client";

import { useRef, useState, type FormEvent } from "react";
import { FilePlus, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { RequiredMark, selectClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { formatJalali, JALALI_MAX_YEAR, toPersianDigits } from "@/lib/jalali";
import { contractTypeLabels, type ContractType, type Employee, type EmployeeContract } from "./shared";
import { formatExpiry, formatTenure } from "./tenure";
import { useAdminUser } from "@/app/admin/layout";

type Toasts = { pushError: (message: string) => void; pushErrors: (messages: string[]) => void; pushSuccess: (message: string) => void };
type ContractForm = { contractType: ContractType; startDate: string; endDate: string; note: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const dayAfter = (iso: string) => new Date(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

function contractDuration(contract: EmployeeContract): string {
  if (!contract.endDate) return "تا امروز (بدون پایان)";
  const start = contract.startDate.slice(0, 10);
  const end = contract.endDate.slice(0, 10);
  const days = Math.round((new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) / DAY_MS) + 1;
  return formatTenure({ days, basis: "contracts", periods: [{ start, end, days }] });
}

// «قراردادها» — the employee's contract history (latest first). A contract is
// usually monthly first, then yearly: «تمدید / قرارداد جدید» adds the next
// period, prefilled to start the day after the last one ends. Periods never
// overlap (the backend refuses it). The tenure shown on the page is computed
// from these periods. Needs employees.manage to change anything.
export function ContractsSection({ employee, canManage, onChanged, toasts }: { employee: Employee; canManage: boolean; onChanged: (employee: Employee) => void; toasts: Toasts }) {
  // Delete is its own permission (employees.delete); the backend route checks the same.
  const canDelete = useAdminUser()?.permissions.includes("employees.delete") ?? false;
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeContract | null>(null);
  const [form, setForm] = useState<ContractForm>({ contractType: "temporary", startDate: "", endDate: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const uploadTarget = useRef<number | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const current = employee.currentContract;

  function openNew() {
    setEditing(null);
    setFile(null);
    // An extension starts the day after the latest contract ends.
    setForm({ contractType: "temporary", startDate: current?.endDate ? dayAfter(current.endDate) : "", endDate: "", note: "" });
    setDialogOpen(true);
  }
  function openEdit(contract: EmployeeContract) {
    setEditing(contract);
    setFile(null);
    setForm({ contractType: contract.contractType, startDate: contract.startDate.slice(0, 10), endDate: contract.endDate ? contract.endDate.slice(0, 10) : "", note: contract.note ?? "" });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems: string[] = [];
    if (!form.startDate) problems.push("تاریخ شروع قرارداد را وارد کنید.");
    if (form.contractType !== "permanent" && !form.endDate) problems.push("برای قرارداد موقت یا کار معین، تاریخ پایان را وارد کنید.");
    if (form.startDate && form.endDate && form.endDate < form.startDate) problems.push("تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد.");
    if (problems.length > 0) {
      pushErrors(problems);
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({ contractType: form.contractType, startDate: form.startDate, endDate: form.contractType === "permanent" ? undefined : form.endDate, note: form.note.trim() || undefined });
      let updated = await apiFetch<Employee>(editing ? `/employees/${employee.id}/contracts/${editing.id}` : `/employees/${employee.id}/contracts`, { method: editing ? "PATCH" : "POST", body });
      if (file) {
        // The new contract is the one starting on the chosen date.
        const target = editing ?? updated.contracts.find((contract) => contract.startDate.slice(0, 10) === form.startDate);
        if (target) {
          try {
            updated = await apiUpload<Employee>(`/employees/${employee.id}/contracts/${target.id}/document`, file);
          } catch (reason) {
            pushError((reason as ApiError).message ?? "بارگذاری فایل قرارداد ناموفق بود.");
          }
        }
      }
      onChanged(updated);
      pushSuccess(editing ? "قرارداد ویرایش شد." : "قرارداد ثبت شد.");
      setDialogOpen(false);
    } catch (reason) {
      const error = reason as ApiError;
      if (error.messages?.length) pushErrors(error.messages);
      else pushError(error.message ?? "ثبت قرارداد ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(contract: EmployeeContract) {
    setBusyId(contract.id);
    try {
      onChanged(await apiFetch<Employee>(`/employees/${employee.id}/contracts/${contract.id}`, { method: "DELETE" }));
      pushSuccess("قرارداد حذف شد.");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف قرارداد ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  }

  async function uploadDocument(contractId: number, picked: File | null) {
    if (!picked) return;
    setBusyId(contractId);
    try {
      onChanged(await apiUpload<Employee>(`/employees/${employee.id}/contracts/${contractId}/document`, picked));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "بارگذاری فایل قرارداد ناموفق بود.");
    } finally {
      setBusyId(null);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold">قراردادها</h2>
          <p className="text-xs text-muted-foreground">تاریخچهٔ قراردادها و تمدیدها — سابقهٔ کار از روی این بازه‌ها محاسبه می‌شود.</p>
        </div>
        {canManage ? (
          <Button type="button" size="sm" onClick={openNew}>
            <FilePlus className="size-3.5" aria-hidden="true" />
            تمدید / قرارداد جدید
          </Button>
        ) : null}
      </div>
      <div className="px-4 py-3">
        {current ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            قرارداد فعلی: <span className="font-medium">{contractTypeLabels[current.contractType]}</span>
            {employee.status !== "terminated" ? (
              employee.contractExpired ? (
                <StatusBadge label={`منقضی‌شده — ${formatExpiry(employee.daysToExpiry)}`} tone="destructive" />
              ) : employee.daysToExpiry !== null && employee.daysToExpiry <= 30 ? (
                <StatusBadge label={`در حال اتمام — ${formatExpiry(employee.daysToExpiry)}`} tone="warning" />
              ) : (
                <StatusBadge label={formatExpiry(employee.daysToExpiry)} tone="success" />
              )
            ) : null}
          </p>
        ) : null}
        <input ref={uploadInput} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(event) => void uploadDocument(uploadTarget.current ?? 0, event.target.files?.[0] ?? null)} />
        {employee.contracts.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            قراردادی ثبت نشده است — سابقهٔ کار فعلاً از تاریخ استخدام محاسبه می‌شود.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[44rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">نوع</th>
                  <th className="px-3 py-2 font-medium">از تاریخ</th>
                  <th className="px-3 py-2 font-medium">تا تاریخ</th>
                  <th className="px-3 py-2 font-medium">مدت</th>
                  <th className="px-3 py-2 font-medium">یادداشت</th>
                  <th className="px-3 py-2 font-medium">فایل</th>
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {employee.contracts.map((contract, index) => (
                  <tr key={contract.id}>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{toPersianDigits(employee.contracts.length - index)}</td>
                    <td className="px-3 py-2">{contractTypeLabels[contract.contractType]}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatJalali(contract.startDate)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{contract.endDate ? formatJalali(contract.endDate) : "بدون پایان"}</td>
                    <td className="px-3 py-2">{contractDuration(contract)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{contract.note || "-"}</td>
                    <td className="px-3 py-2">
                      {contract.documentPath ? (
                        <a href={`/api${contract.documentPath}`} target="_blank" rel="noreferrer" className="text-primary underline">مشاهده</a>
                      ) : canManage ? (
                        <Button type="button" size="sm" variant="ghost" disabled={busyId === contract.id} onClick={() => { uploadTarget.current = contract.id; uploadInput.current?.click(); }}>
                          <Paperclip className="size-3.5" aria-hidden="true" />
                          بارگذاری
                        </Button>
                      ) : (
                        "-"
                      )}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Button type="button" size="sm" variant="link" disabled={busyId === contract.id} onClick={() => openEdit(contract)}>ویرایش</Button>
                        {canDelete ? (
                          <Button type="button" size="icon" variant="ghost" aria-label="حذف قرارداد" disabled={busyId === contract.id} onClick={() => void remove(contract)}>
                            <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (!open && !saving ? setDialogOpen(false) : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "ویرایش قرارداد" : current ? "تمدید / قرارداد جدید" : "قرارداد جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="contract-form" className="grid gap-4" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contract-type">نوع قرارداد<RequiredMark /></Label>
                <select id="contract-type" className={selectClass} value={form.contractType} onChange={(event) => setForm((c) => ({ ...c, contractType: event.target.value as ContractType }))}>
                  {Object.entries(contractTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="contract-start-year">تاریخ شروع<RequiredMark /></Label>
                  <JalaliDateInput idPrefix="contract-start" value={form.startDate} maxYear={JALALI_MAX_YEAR} onChange={(value) => setForm((c) => ({ ...c, startDate: value }))} />
                </div>
                {form.contractType !== "permanent" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="contract-end-year">تاریخ پایان<RequiredMark /></Label>
                    <JalaliDateInput idPrefix="contract-end" value={form.endDate} minDate={form.startDate || undefined} maxYear={JALALI_MAX_YEAR} onChange={(value) => setForm((c) => ({ ...c, endDate: value }))} />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contract-note">یادداشت</Label>
                <Input id="contract-note" value={form.note} maxLength={500} placeholder="مثلاً: تمدید یک‌ساله پس از قرارداد ماهانه" onChange={(event) => setForm((c) => ({ ...c, note: event.target.value }))} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contract-file">فایل قرارداد (PDF یا تصویر، اختیاری)</Label>
                <input id="contract-file" type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-xs" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="contract-form" disabled={saving}>{saving ? "در حال ثبت..." : "ثبت قرارداد"}</Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
