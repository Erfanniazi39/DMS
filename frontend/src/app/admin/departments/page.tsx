"use client";

import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";

type DepartmentStatus = "active" | "inactive";
type Department = { id: number; code: string; name: string; status: DepartmentStatus; note: string | null };
// Only the fields this page actually needs from the employee list — the real
// /employees response carries the full employee record, but here we only
// group employees by department to compute a running count and, for the
// detail view, list each one's name and position.
type EmployeeLite = {
  id: number;
  firstName: string;
  lastName: string;
  position: string | null;
  department: { id: number };
};
type FormState = { code: string; name: string; note: string; status: DepartmentStatus };
type StatusFilter = "all" | DepartmentStatus;

const emptyForm: FormState = { code: "", name: "", note: "", status: "active" };
const statusLabels: Record<DepartmentStatus, string> = { active: "فعال", inactive: "غیرفعال" };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const [detailDepartment, setDetailDepartment] = useState<Department | null>(null);

  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  async function loadAll() {
    setLoading(true);
    try {
      const [departmentData, employeeData] = await Promise.all([
        apiFetch<Department[]>("/departments"),
        apiFetch<EmployeeLite[]>("/employees"),
      ]);
      setDepartments(departmentData);
      setEmployees(employeeData);
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات دپارتمان‌ها ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const run = async () => loadAll();
    void run();
    // Loaded once on mount; loadAll is re-invoked explicitly after any
    // create/edit/delete instead of being tracked as a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Employees grouped by department id. The count shown in the table and the
  // roster shown in the detail view are both derived from this fetch rather
  // than stored redundantly on the department record.
  const employeesByDepartment = useMemo(() => {
    const map = new Map<number, EmployeeLite[]>();
    for (const employee of employees) {
      const list = map.get(employee.department.id);
      if (list) {
        list.push(employee);
      } else {
        map.set(employee.department.id, [employee]);
      }
    }
    return map;
  }, [employees]);

  const filteredDepartments = useMemo(() => {
    const normalizedQuery = query.trim();
    return departments.filter((department) => {
      const matchesQuery =
        normalizedQuery === "" || department.name.includes(normalizedQuery) || department.code.includes(normalizedQuery);
      const matchesStatus = statusFilter === "all" || department.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [departments, query, statusFilter]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreateForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEditForm(event: MouseEvent, department: Department) {
    event.stopPropagation();
    setEditingId(department.id);
    setForm({ code: department.code, name: department.name, note: department.note ?? "", status: department.status });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function saveDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      pushError("کد و نام دپارتمان الزامی است.");
      return;
    }
    setSaving(true);
    try {
      const payload = editingId
        ? { code: form.code.trim(), name: form.name.trim(), note: form.note.trim(), status: form.status }
        : { code: form.code.trim(), name: form.name.trim(), note: form.note.trim() };
      await apiFetch(editingId ? `/departments/${editingId}` : "/departments", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      pushSuccess(editingId ? "دپارتمان با موفقیت ویرایش شد." : "دپارتمان جدید با موفقیت ایجاد شد.");
      closeForm();
      await loadAll();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره دپارتمان ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteDepartment(event: MouseEvent, department: Department) {
    event.stopPropagation();
    const employeeCount = employeesByDepartment.get(department.id)?.length ?? 0;
    // The backend already rejects this with the same message, but checking
    // here first avoids a round-trip and lets the button be disabled outright.
    if (employeeCount > 0) {
      pushError(`دپارتمان «${department.name}» دارای ${employeeCount.toLocaleString("fa-IR")} کارمند است و قابل حذف نیست.`);
      return;
    }
    if (!window.confirm(`آیا از حذف دپارتمان «${department.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/departments/${department.id}`, { method: "DELETE" });
      pushSuccess(`دپارتمان «${department.name}» حذف شد.`);
      if (detailDepartment?.id === department.id) setDetailDepartment(null);
      await loadAll();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف دپارتمان ناموفق بود.");
    }
  }

  const detailEmployees = detailDepartment ? employeesByDepartment.get(detailDepartment.id) ?? [] : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">دپارتمان‌ها</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت دپارتمان‌های سازمان</p>
          </div>
          <Button onClick={openCreateForm}>
            <Plus className="size-4" aria-hidden="true" />
            افزودن دپارتمان
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">فهرست دپارتمان‌ها</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی دپارتمان</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس نام یا کد"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="department-status-filter" className="shrink-0 text-xs text-muted-foreground">
                  وضعیت
                </Label>
                <select
                  id="department-status-filter"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                >
                  <option value="all">همه</option>
                  <option value="active">فعال</option>
                  <option value="inactive">غیرفعال</option>
                </select>
              </div>
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری دپارتمان‌ها...</p>
            ) : filteredDepartments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {departments.length === 0 ? "هنوز دپارتمانی ثبت نشده است." : "دپارتمانی با این مشخصات یافت نشد."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[42rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">نام دپارتمان</th>
                      <th className="px-4 py-3 font-medium">کد</th>
                      <th className="px-4 py-3 font-medium">تعداد کارکنان</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      <th className="px-4 py-3 font-medium">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredDepartments.map((department) => {
                      const employeeCount = employeesByDepartment.get(department.id)?.length ?? 0;
                      return (
                        <tr
                          key={department.id}
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => setDetailDepartment(department)}
                        >
                          <td className="px-4 py-3 font-medium">{department.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{department.code}</td>
                          <td className="px-4 py-3">{employeeCount.toLocaleString("fa-IR")}</td>
                          <td className="px-4 py-3 text-muted-foreground">{statusLabels[department.status]}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Button variant="link" size="sm" onClick={(event) => openEditForm(event, department)}>
                                ویرایش
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={employeeCount > 0}
                                title={employeeCount > 0 ? "دپارتمان دارای کارمند قابل حذف نیست" : undefined}
                                onClick={(event) => void deleteDepartment(event, department)}
                              >
                                حذف
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "ویرایش دپارتمان" : "افزودن دپارتمان جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="department-form" className="grid gap-4 md:grid-cols-2" onSubmit={saveDepartment} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="department-code">کد دپارتمان</Label>
                <Input id="department-code" value={form.code} onChange={(event) => update("code", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="department-name">نام دپارتمان</Label>
                <Input id="department-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="department-note">یادداشت</Label>
                <Input id="department-note" value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
              {editingId ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="department-status">وضعیت</Label>
                  <select
                    id="department-status"
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form.status}
                    onChange={(event) => update("status", event.target.value as DepartmentStatus)}
                  >
                    <option value="active">فعال</option>
                    <option value="inactive">غیرفعال</option>
                  </select>
                </div>
              ) : null}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="department-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId ? "ذخیره تغییرات" : "ایجاد دپارتمان"}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailDepartment !== null}
        onOpenChange={(open) => {
          if (!open) setDetailDepartment(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailDepartment?.name ?? "جزئیات دپارتمان"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            {detailDepartment ? (
              <div className="space-y-5">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">نام دپارتمان</dt>
                    <dd className="mt-1 font-medium">{detailDepartment.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">کد</dt>
                    <dd className="mt-1 font-mono">{detailDepartment.code}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">وضعیت</dt>
                    <dd className="mt-1">{statusLabels[detailDepartment.status]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">تعداد کارکنان</dt>
                    <dd className="mt-1">{detailEmployees.length.toLocaleString("fa-IR")}</dd>
                  </div>
                </dl>

                <div>
                  <p className="mb-2 text-sm font-medium">کارکنان این دپارتمان</p>
                  {detailEmployees.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                      کارمندی در این دپارتمان ثبت نشده است.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-right text-sm">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 font-medium">نام کارمند</th>
                            <th className="px-4 py-2 font-medium">سمت</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {detailEmployees.map((employee) => (
                            <tr key={employee.id}>
                              <td className="px-4 py-2">
                                {employee.firstName} {employee.lastName}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">{employee.position || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDetailDepartment(null)}>
              بستن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
