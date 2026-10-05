"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { todayIso } from "@/lib/format";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { useAdminUser } from "../admin/layout";
import { EmployeeListSection } from "./_sections/EmployeeListSection";
import { EmployeeFormDialog } from "./_sections/EmployeeFormDialog";
import {
  PAGE_SIZE,
  PERSIAN_NAME_REGEX,
  STATUS_SORT_RANK,
  type Department,
  type Employee,
  type FormState,
  type PageToken,
  type SortDirection,
  type SortField,
} from "./_sections/shared";

// List/filter/sort/pagination state, the add/edit form state and the
// load/validate/save flow live here; the list (with its detail rows) and
// the form popup are rendered by the components in ./_sections.

// Age in whole years as of today. Returns null when birthDate is missing or
// unparseable, so it can be sorted to the end regardless of direction.
function computeAgeInYears(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// Tenure in whole days as of today, used to sort by seniority. Same
// null-handling as computeAgeInYears.
function computeTenureInDays(hireDate: string | null): number | null {
  if (!hireDate) return null;
  const hire = new Date(hireDate);
  if (Number.isNaN(hire.getTime())) return null;
  return Math.floor((Date.now() - hire.getTime()) / (1000 * 60 * 60 * 24));
}

// Windowed page numbers with "..." gaps, so a large employee list doesn't
// render a button for every single page.
function buildPageNumbers(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages: PageToken[] = [1];
  if (current > 3) pages.push("start-ellipsis");
  const rangeStart = Math.max(2, current - 1);
  const rangeEnd = Math.min(total - 1, current + 1);
  for (let pageNumber = rangeStart; pageNumber <= rangeEnd; pageNumber += 1) pages.push(pageNumber);
  if (current < total - 2) pages.push("end-ellipsis");
  pages.push(total);
  return pages;
}

function emptyForm(): FormState {
  return {
    code: "",
    firstName: "",
    lastName: "",
    departmentId: "",
    position: "",
    nationalId: "",
    mobilePhone: "",
    landlinePhone: "",
    birthDate: "",
    hireDate: todayIso(),
    email: "",
    note: "",
    status: "active",
    fatherName: "",
    birthCertificateNumber: "",
    maritalStatus: "",
    childrenCount: "",
    gender: "",
    educationLevel: "",
    belowDiplomaGrade: "",
    fieldOfStudy: "",
    workLocation: "",
    workingHours: "",
    contractType: "",
    contractStartDate: "",
    contractEndDate: "",
    salaryAmount: "",
    salaryPeriod: "",
    bankAccountNumber: "",
    address: "",
  };
}

export default function EmployeesPage() {
  const user = useAdminUser();
  // employees.view reads the list (also granted to PURCHASE_MANAGER for the
  // buyer/requester dropdowns); create/edit need employees.manage.
  const canView = user?.permissions.includes("employees.view") ?? false;
  const canManage = user?.permissions.includes("employees.manage") ?? false;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("department");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The add/edit form is a popup, not a section of the page — it floats
  // above the list and never pushes it down or makes the page scroll.
  const [formOpen, setFormOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const photoObjectUrlRef = useRef<string | null>(null);
  const [existingPhotoPath, setExistingPhotoPath] = useState<string | null>(null);
  // Contract document (PDF or image): no live thumbnail preview like the
  // photo above, since it isn't always an image — just the chosen file's
  // name, or a link to the existing one when editing.
  const [contractDocumentFile, setContractDocumentFile] = useState<File | null>(null);
  const [existingContractDocumentPath, setExistingContractDocumentPath] = useState<string | null>(null);
  const { toasts, pushError, pushErrors, pushSuccess, dismiss } = useToasts();

  async function load() {
    setLoading(true);
    try {
      const [employeeData, departmentData] = await Promise.all([
        apiFetch<Employee[]>("/employees"),
        apiFetch<Department[]>("/departments"),
      ]);
      setEmployees(employeeData);
      setDepartments(departmentData.filter((department) => department.status === "active"));
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت اطلاعات کارکنان ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    const run = async () => load();
    void run();
    // Load employee data once when the page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  // Live preview for a newly-chosen (not yet uploaded) photo file. The
  // object URL is created/revoked right where the file changes (an event,
  // not an effect), so the previous preview URL is always released.
  function choosePhoto(file: File | null) {
    if (photoObjectUrlRef.current) URL.revokeObjectURL(photoObjectUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    photoObjectUrlRef.current = url;
    setPhotoFile(file);
    setPhotoObjectUrl(url);
  }

  // Release the last preview URL when the page unmounts.
  useEffect(() => {
    const ref = photoObjectUrlRef;
    return () => {
      if (ref.current) URL.revokeObjectURL(ref.current);
      ref.current = null;
    };
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    choosePhoto(null);
    setExistingPhotoPath(null);
    setContractDocumentFile(null);
    setExistingContractDocumentPath(null);
  }

  function startEdit(employee: Employee) {
    setEditingId(employee.id);
    setForm({
      code: employee.code,
      firstName: employee.firstName,
      lastName: employee.lastName,
      departmentId: String(employee.department.id),
      position: employee.position ?? "",
      nationalId: employee.nationalId ?? "",
      mobilePhone: employee.mobilePhone ?? "",
      landlinePhone: employee.landlinePhone ?? "",
      birthDate: employee.birthDate ? employee.birthDate.slice(0, 10) : "",
      hireDate: employee.hireDate ? employee.hireDate.slice(0, 10) : "",
      email: employee.email ?? "",
      note: employee.note ?? "",
      status: employee.status,
      fatherName: employee.fatherName ?? "",
      birthCertificateNumber: employee.birthCertificateNumber ?? "",
      maritalStatus: employee.maritalStatus ?? "",
      childrenCount: employee.childrenCount != null ? String(employee.childrenCount) : "",
      gender: employee.gender ?? "",
      educationLevel: employee.educationLevel ?? "",
      belowDiplomaGrade: employee.belowDiplomaGrade ?? "",
      fieldOfStudy: employee.fieldOfStudy ?? "",
      workLocation: employee.workLocation ?? "",
      workingHours: employee.workingHours ?? "",
      contractType: employee.contractType ?? "",
      contractStartDate: employee.contractStartDate ? employee.contractStartDate.slice(0, 10) : "",
      contractEndDate: employee.contractEndDate ? employee.contractEndDate.slice(0, 10) : "",
      salaryAmount: employee.salaryAmount ?? "",
      salaryPeriod: employee.salaryPeriod ?? "",
      bankAccountNumber: employee.bankAccountNumber ?? "",
      address: employee.address ?? "",
    });
    choosePhoto(null);
    setExistingPhotoPath(employee.photoPath);
    setContractDocumentFile(null);
    setExistingContractDocumentPath(employee.contractDocumentPath);
  }

  function openCreateForm() {
    startCreate();
    setFormOpen(true);
  }

  function openEditForm(employee: Employee) {
    startEdit(employee);
    setFormOpen(true);
  }

  // Also wired to the dialog's own onOpenChange, so pressing Escape,
  // clicking the backdrop, or the × button all discard the draft the same
  // way the "انصراف" button does.
  function closeForm() {
    startCreate();
    setFormOpen(false);
  }

  // One specific message per problem, so several issues at once each get
  // their own clear notification instead of a single vague sentence.
  function validate(): string[] {
    const errors: string[] = [];
    if (!form.departmentId) errors.push("واحد سازمانی را انتخاب کنید.");
    if (!form.firstName.trim()) {
      errors.push("نام را وارد کنید.");
    } else if (!PERSIAN_NAME_REGEX.test(form.firstName.trim())) {
      errors.push("نام باید فقط شامل حروف فارسی باشد.");
    }
    if (!form.lastName.trim()) {
      errors.push("نام خانوادگی را وارد کنید.");
    } else if (!PERSIAN_NAME_REGEX.test(form.lastName.trim())) {
      errors.push("نام خانوادگی باید فقط شامل حروف فارسی باشد.");
    }
    if (!form.mobilePhone.trim()) {
      errors.push("تلفن همراه را وارد کنید.");
    } else if (!/^[0-9]{11}$/.test(form.mobilePhone.trim())) {
      errors.push("تلفن همراه باید دقیقاً ۱۱ رقم باشد.");
    }
    if (!form.nationalId.trim()) {
      errors.push("کد ملی را وارد کنید.");
    } else if (!/^[0-9]{10}$/.test(form.nationalId.trim())) {
      errors.push("کد ملی باید دقیقاً ۱۰ رقم باشد.");
    }
    if (!form.birthDate) errors.push("تاریخ تولد را مشخص کنید.");
    if (!form.hireDate) errors.push("تاریخ استخدام را مشخص کنید.");
    if (form.landlinePhone.trim() && !/^[0-9]{6,11}$/.test(form.landlinePhone.trim())) {
      errors.push("تلفن ثابت واردشده معتبر نیست.");
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.push("ایمیل واردشده معتبر نیست.");
    }
    if (form.fatherName.trim() && !PERSIAN_NAME_REGEX.test(form.fatherName.trim())) {
      errors.push("نام پدر باید فقط شامل حروف فارسی باشد.");
    }
    if (form.educationLevel === "under_diploma" && !form.belowDiplomaGrade.trim()) {
      errors.push("در صورت انتخاب «زیر دیپلم»، مقطع تحصیلی (تا چه کلاسی) را مشخص کنید.");
    }
    if (form.childrenCount.trim() && (!/^[0-9]+$/.test(form.childrenCount.trim()) || Number(form.childrenCount) < 0)) {
      errors.push("تعداد فرزندان باید عددی صحیح و غیرمنفی باشد.");
    }
    if (form.salaryAmount.trim() && (Number.isNaN(Number(form.salaryAmount)) || Number(form.salaryAmount) < 0)) {
      errors.push("مبلغ حقوق باید عددی غیرمنفی باشد.");
    }
    if (form.salaryAmount.trim() && !form.salaryPeriod) {
      errors.push("دوره پرداخت حقوق (ماهانه، هفتگی یا روزانه) را مشخص کنید.");
    }
    if (form.contractStartDate && form.contractEndDate && form.contractEndDate < form.contractStartDate) {
      errors.push("تاریخ پایان قرارداد نمی‌تواند قبل از تاریخ شروع باشد.");
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
      contractType: form.contractType || undefined,
      contractStartDate: form.contractStartDate || undefined,
      contractEndDate: form.contractEndDate || undefined,
      salaryAmount: form.salaryAmount.trim() ? Number(form.salaryAmount) : undefined,
      salaryPeriod: form.salaryPeriod || undefined,
      bankAccountNumber: form.bankAccountNumber.trim() || undefined,
      address: form.address.trim() || undefined,
      ...(editingId ? { status: form.status } : {}),
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
      if (contractDocumentFile) {
        try {
          await apiUpload(`/employees/${saved.id}/contract-document`, contractDocumentFile);
        } catch (reason) {
          pushError((reason as ApiError).message ?? "بارگذاری فایل قرارداد ناموفق بود.");
        }
      }
      pushSuccess(editingId ? "اطلاعات کارمند با موفقیت ویرایش شد." : "کارمند جدید با موفقیت ایجاد شد.");
      startCreate();
      setFormOpen(false);
      await load();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) {
        pushErrors(apiError.messages);
      } else {
        pushError(apiError.message ?? "ذخیره اطلاعات کارمند ناموفق بود.");
      }
    } finally {
      setSaving(false);
    }
  }

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return employees;
    return employees.filter((employee) => {
      const haystack = [
        employee.code,
        employee.firstName,
        employee.lastName,
        employee.position ?? "",
        employee.nationalId ?? "",
        employee.mobilePhone ?? "",
        employee.landlinePhone ?? "",
        employee.email ?? "",
        employee.department.name,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [employees, query]);

  const sortedEmployees = useMemo(() => {
    const directionMultiplier = sortDirection === "asc" ? 1 : -1;
    // Missing data (no birth/hire date) always sorts to the end, regardless
    // of ascending/descending, so it doesn't jump to the top on "descending".
    const compareWithNullsLast = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * directionMultiplier;
    };
    const list = [...filteredEmployees];
    list.sort((a, b) => {
      switch (sortField) {
        case "department":
          return a.department.name.localeCompare(b.department.name, "fa") * directionMultiplier;
        case "name":
          return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "fa") * directionMultiplier;
        case "age":
          return compareWithNullsLast(computeAgeInYears(a.birthDate), computeAgeInYears(b.birthDate));
        case "tenure":
          return compareWithNullsLast(computeTenureInDays(a.hireDate), computeTenureInDays(b.hireDate));
        case "status":
          return (STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status]) * directionMultiplier;
        default:
          return 0;
      }
    });
    return list;
  }, [filteredEmployees, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedEmployees.length / PAGE_SIZE));
  const pagedEmployees = useMemo(
    () => sortedEmployees.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [sortedEmployees, page],
  );
  const pageNumbers = useMemo(() => buildPageNumbers(page, totalPages), [page, totalPages]);

  // A new search or sort choice starts back at page 1 (done in those
  // controls' own handlers), so the user isn't silently left on a now
  // out-of-range page.
  // If the list shrinks (e.g. after a delete) below the current page,
  // clamp back to the last real page instead of showing an empty one.
  // Adjusted during render (React's "adjusting state when props change"
  // pattern) rather than in an effect, so there's no extra render pass.
  if (page > totalPages) setPage(totalPages);

  const photoPreviewSrc = photoObjectUrl ?? (existingPhotoPath ? `/api${existingPhotoPath}` : null);

  if (!canView) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
            اجازه دسترسی به کارکنان را ندارید.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">کارکنان</h1>
            <p className="mt-2 text-sm text-muted-foreground">مدیریت کارکنان و واحد سازمانی هر کارمند</p>
          </div>
          {canManage ? (
            <Button onClick={openCreateForm}>
              <UserPlus className="size-4" aria-hidden="true" />
              افزودن کارمند
            </Button>
          ) : null}
        </div>

        <EmployeeListSection
          employees={employees}
          sortedEmployees={sortedEmployees}
          pagedEmployees={pagedEmployees}
          loading={loading}
          canManage={canManage}
          query={query}
          setQuery={setQuery}
          sortField={sortField}
          setSortField={setSortField}
          sortDirection={sortDirection}
          setSortDirection={setSortDirection}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          pageNumbers={pageNumbers}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onEdit={openEditForm}
        />
      </div>

      <EmployeeFormDialog
        open={formOpen}
        onClose={closeForm}
        editingId={editingId}
        form={form}
        update={update}
        departments={departments}
        photoPreviewSrc={photoPreviewSrc}
        photoFile={photoFile}
        onChoosePhoto={choosePhoto}
        contractDocumentFile={contractDocumentFile}
        setContractDocumentFile={setContractDocumentFile}
        existingContractDocumentPath={existingContractDocumentPath}
        saving={saving}
        onSubmit={save}
        pushError={pushError}
      />
    </div>
  );
}
