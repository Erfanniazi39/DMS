"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { toJalali } from "@/lib/jalali";
import { apiFetch, type ApiError } from "@/lib/api";
import { parseNumberInput } from "@/lib/number-input";
import {
  RequiredMark,
  selectClass,
  textareaClass,
  type DepartmentOption,
  type EmployeeOption,
  type UnitOption,
} from "../purchases/shared";
import {
  PURCHASE_REQUEST_PRIORITIES,
  PURCHASE_REQUEST_STATUSES,
  purchaseRequestPriorityLabels,
  purchaseRequestStatusLabels,
  type PurchaseRequestDetail,
  type PurchaseRequestPriority,
  type PurchaseRequestStatus,
} from "./shared";

type ItemFormRow = {
  key: string;
  // The existing PurchaseRequestItem id (edit mode), sent back on PATCH so
  // the backend diffs lines by id and keeps any Purchase lines linked to
  // them — undefined for a row added in this form.
  id?: number;
  name: string;
  quantity: string;
  unitId: string;
  requiredDate: string;
  note: string;
};

function emptyItemRow(): ItemFormRow {
  return { key: crypto.randomUUID(), name: "", quantity: "", unitId: "", requiredDate: "", note: "" };
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// "Required by" looks forward in time, unlike the other dates in this app —
// a few years' headroom past the current Jalali year.
const requiredDateMaxYear = toJalali(new Date()).jy + 3;

// Set only by the system from actual purchased quantities (CLAUDE.md rule
// 6) — the backend refuses a manual change into either, so they're only
// offered when the request is already in that status.
const SYSTEM_ONLY_STATUSES: PurchaseRequestStatus[] = ["PARTIALLY_PURCHASED", "COMPLETED"];

type FormState = {
  requestDate: string;
  requesterDepartmentId: string;
  // Optional — a request can come from a department in general without
  // naming the specific person who asked for it (see purchase-request.dto.ts).
  requestedByEmployeeId: string;
  priority: PurchaseRequestPriority;
  status: PurchaseRequestStatus;
  note: string;
  items: ItemFormRow[];
};

// Defaults to today — the common case is logging a request as it's made,
// not backdating one. Still a plain editable date field afterwards.
function emptyForm(): FormState {
  return {
    requestDate: todayIso(),
    requesterDepartmentId: "",
    requestedByEmployeeId: "",
    priority: "NORMAL",
    status: "DRAFT",
    note: "",
    items: [emptyItemRow()],
  };
}

type Props = { mode: "create" } | { mode: "edit"; purchaseRequestId: number };

// Used by both /purchase-requests/new and
// /purchase-requests/[id]/edit — same full-page (not modal) pattern
// as the Purchase module's own form. Status is only editable once a
// request exists (edit mode): a new request always starts DRAFT (see
// PurchaseRequestsService.create()).
export function PurchaseRequestForm(props: Props) {
  const router = useRouter();
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  const [loading, setLoading] = useState(props.mode === "edit");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);
  // The status the request had when loaded — see SYSTEM_ONLY_STATUSES.
  const [loadedStatus, setLoadedStatus] = useState<PurchaseRequestStatus | null>(null);
  // Optimistic locking: the request's updatedAt as loaded, sent back on
  // save; `staleRecord` = the backend answered RECORD_MODIFIED (someone else
  // saved in between) — saving stays blocked until the page is reloaded.
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [staleRecord, setStaleRecord] = useState(false);

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);

  useEffect(() => {
    async function loadOptions() {
      try {
        const [departmentsData, employeesData, unitsData] = await Promise.all([
          apiFetch<DepartmentOption[]>("/departments"),
          apiFetch<EmployeeOption[]>("/employees"),
          apiFetch<UnitOption[]>("/units"),
        ]);
        setDepartments(departmentsData.filter((department) => department.status === "active"));
        setEmployees(employeesData.filter((employee) => employee.status === "active"));
        setUnits(unitsData);
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات پایه ناموفق بود.");
      }
    }
    void loadOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (props.mode !== "edit") return;
    async function loadRequest() {
      if (props.mode !== "edit") return;
      setLoading(true);
      try {
        const request = await apiFetch<PurchaseRequestDetail>(`/purchase-requests/${props.purchaseRequestId}`);
        setRequestNumber(request.requestNumber);
        setLoadedUpdatedAt(request.updatedAt);
        setLoadedStatus(request.status);
        setForm({
          requestDate: request.requestDate.slice(0, 10),
          requesterDepartmentId: String(request.requesterDepartment.id),
          requestedByEmployeeId: request.requestedByEmployee ? String(request.requestedByEmployee.id) : "",
          priority: request.priority,
          status: request.status,
          note: request.note ?? "",
          items: request.items.length
            ? request.items.map((item) => ({
                key: crypto.randomUUID(),
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                unitId: String(item.unit.id),
                requiredDate: item.requiredDate ? item.requiredDate.slice(0, 10) : "",
                note: item.note ?? "",
              }))
            : [emptyItemRow()],
        });
      } catch (reason) {
        pushError((reason as ApiError).message ?? "دریافت اطلاعات درخواست خرید ناموفق بود.");
      } finally {
        setLoading(false);
      }
    }
    void loadRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === "edit" ? props.purchaseRequestId : null]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateItem(key: string, patch: Partial<ItemFormRow>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    }));
  }

  function addItemRow() {
    setForm((current) => ({ ...current, items: [...current.items, emptyItemRow()] }));
  }

  function removeItemRow(key: string) {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((item) => item.key !== key) : current.items,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.requestDate || !form.requesterDepartmentId) {
      pushError("تاریخ درخواست و دپارتمان درخواست‌کننده الزامی است.");
      return;
    }
    const items = form.items.filter((item) => item.name.trim() !== "");
    if (items.length === 0) {
      pushError("حداقل یک قلم کالا را وارد کنید.");
      return;
    }
    for (const item of items) {
      if (!item.unitId || item.quantity === "") {
        pushError("مقدار و واحد همه اقلام باید تکمیل شود.");
        return;
      }
    }

    const payload = {
      requestDate: form.requestDate,
      requesterDepartmentId: Number(form.requesterDepartmentId),
      requestedByEmployeeId: form.requestedByEmployeeId ? Number(form.requestedByEmployeeId) : undefined,
      priority: form.priority,
      note: form.note.trim(),
      items: items.map((item) => ({
        ...(props.mode === "edit" && item.id !== undefined ? { id: item.id } : {}),
        name: item.name.trim(),
        quantity: parseNumberInput(item.quantity),
        unitId: Number(item.unitId),
        requiredDate: item.requiredDate || undefined,
        note: item.note.trim(),
      })),
      ...(props.mode === "edit" ? { status: form.status, updatedAt: loadedUpdatedAt } : {}),
    };

    setSaving(true);
    try {
      const saved = await apiFetch<PurchaseRequestDetail>(
        props.mode === "edit" ? `/purchase-requests/${props.purchaseRequestId}` : "/purchase-requests",
        {
          method: props.mode === "edit" ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      pushSuccess(props.mode === "edit" ? "درخواست خرید با موفقیت ویرایش شد." : "درخواست خرید جدید با موفقیت ثبت شد.");
      router.push(`/purchase-requests/${saved.id}`);
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        setStaleRecord(true);
        pushError(apiError.message);
      } else if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره درخواست خرید ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      {/* Same compact, wide layout as PurchaseForm — header fields 4-per-row
          on desktop so the items table starts within the first screenful. */}
      <div className="mx-auto max-w-7xl space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">{props.mode === "edit" ? "ویرایش درخواست خرید" : "ثبت درخواست خرید جدید"}</h1>
          <p className="text-sm text-muted-foreground">
            {props.mode === "edit" && requestNumber ? `شماره درخواست: ${requestNumber}` : "اطلاعات درخواست خرید و اقلام آن را وارد کنید"}
          </p>
        </div>

        {staleRecord ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
            <span>
              این درخواست پس از باز شدن این فرم توسط کاربر دیگری تغییر کرده است. برای جلوگیری از بازنویسی تغییرات او، ابتدا صفحه را بازخوانی کنید
              (تغییرات واردشده در این فرم از بین می‌رود).
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
              بازخوانی صفحه
            </Button>
          </div>
        ) : null}

        <form id="purchase-request-form" onSubmit={submit} className="space-y-3" noValidate>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">اطلاعات درخواست</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="request-date-year">تاریخ درخواست<RequiredMark /></Label>
                <JalaliDateInput idPrefix="request-date" value={form.requestDate} onChange={(value) => update("requestDate", value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="request-department">دپارتمان درخواست‌کننده<RequiredMark /></Label>
                <select
                  id="request-department"
                  className={selectClass}
                  value={form.requesterDepartmentId}
                  onChange={(event) => update("requesterDepartmentId", event.target.value)}
                  required
                >
                  <option value="">انتخاب کنید</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="request-employee">درخواست‌کننده</Label>
                <select
                  id="request-employee"
                  className={selectClass}
                  value={form.requestedByEmployeeId}
                  onChange={(event) => update("requestedByEmployeeId", event.target.value)}
                >
                  <option value="">مشخص نیست</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.firstName} {employee.lastName} ({employee.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="request-priority">اولویت</Label>
                <select
                  id="request-priority"
                  className={selectClass}
                  value={form.priority}
                  onChange={(event) => update("priority", event.target.value as PurchaseRequestPriority)}
                >
                  {PURCHASE_REQUEST_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {purchaseRequestPriorityLabels[priority]}
                    </option>
                  ))}
                </select>
              </div>
              {props.mode === "edit" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="request-status">وضعیت</Label>
                  <select
                    id="request-status"
                    className={selectClass}
                    value={form.status}
                    onChange={(event) => update("status", event.target.value as PurchaseRequestStatus)}
                  >
                    {PURCHASE_REQUEST_STATUSES.filter(
                      (status) => !SYSTEM_ONLY_STATUSES.includes(status) || status === loadedStatus,
                    ).map((status) => (
                      <option key={status} value={status}>
                        {purchaseRequestStatusLabels[status]}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="request-note">یادداشت</Label>
                <textarea id="request-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-semibold">اقلام درخواستی</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[56rem] text-right text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">نام / شرح<RequiredMark /></th>
                      <th className="w-24 px-2 py-1.5 font-medium">مقدار<RequiredMark /></th>
                      <th className="w-32 px-2 py-1.5 font-medium">واحد<RequiredMark /></th>
                      <th className="w-40 px-2 py-1.5 font-medium">تاریخ موردنیاز</th>
                      <th className="px-2 py-1.5 font-medium">یادداشت</th>
                      <th className="w-12 px-2 py-1.5 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {form.items.map((item) => (
                      <tr key={item.key}>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="نام یا شرح قلم"
                            value={item.name}
                            onChange={(event) => updateItem(item.key, { name: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="مقدار"
                            inputMode="decimal"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            aria-label="واحد"
                            className={`${selectClass} w-full`}
                            value={item.unitId}
                            onChange={(event) => updateItem(item.key, { unitId: event.target.value })}
                          >
                            <option value="">-</option>
                            {units.map((unit) => (
                              <option key={unit.id} value={unit.id}>
                                {unit.nameFa}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          {/* Unlike other dates in this app (birth date,
                              purchase date, ...), "required by" looks
                              forward — JalaliDateInput's default maxYear
                              stops at the current year, so it's extended a
                              few years out here. */}
                          <JalaliDateInput
                            idPrefix={`item-required-date-${item.key}`}
                            value={item.requiredDate}
                            onChange={(value) => updateItem(item.key, { requiredDate: value })}
                            maxYear={requiredDateMaxYear}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            aria-label="یادداشت"
                            value={item.note}
                            onChange={(event) => updateItem(item.key, { note: event.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="حذف قلم"
                            onClick={() => removeItemRow(item.key)}
                            disabled={form.items.length === 1}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItemRow}>
                <Plus className="size-4" aria-hidden="true" />
                افزودن قلم
              </Button>
            </CardContent>
          </Card>
        </form>

        {/* Sticky so saving never requires scrolling past the items first. */}
        <div className="sticky bottom-0 z-10 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 shadow-sm">
          <Button type="submit" form="purchase-request-form" disabled={saving || staleRecord}>
            {saving ? "در حال ذخیره..." : props.mode === "edit" ? "ذخیره تغییرات" : "ثبت درخواست خرید"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            انصراف
          </Button>
        </div>
      </div>
    </div>
  );
}
