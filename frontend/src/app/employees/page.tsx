"use client";

import { Fragment, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Paperclip, Search, User, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { useToasts, ToastViewport } from "@/components/ui/toast";
import { formatJalali } from "@/lib/jalali";
import { apiFetch, apiUpload, type ApiError } from "@/lib/api";
import { useAdminUser } from "../admin/layout";

type Department = { id: number; name: string; status: "active" | "inactive" };
type EmployeeStatus = "active" | "on_leave" | "terminated";
type EducationLevel = "under_diploma" | "diploma" | "associate" | "bachelor" | "master" | "phd";
type MaritalStatus = "single" | "married";
type Gender = "male" | "female";
type ContractType = "permanent" | "temporary" | "fixed_task";
type SalaryPeriod = "monthly" | "weekly" | "daily";
// How the employee list is ordered. "tenure" is seniority — time since
// hireDate — not a separate stored field.
type SortField = "department" | "name" | "age" | "tenure" | "status";
type SortDirection = "asc" | "desc";
// EMPLOYEE records only — no User/account data is joined in or displayed here.
type Employee = {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  position: string | null;
  nationalId: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  birthDate: string | null;
  hireDate: string | null;
  email: string | null;
  note: string | null;
  status: EmployeeStatus;
  photoPath: string | null;
  department: Department;
  // --- اطلاعات هویتی و خانوادگی ---
  fatherName: string | null;
  birthCertificateNumber: string | null;
  maritalStatus: MaritalStatus | null;
  childrenCount: number | null;
  gender: Gender | null;
  // --- تحصیلات ---
  educationLevel: EducationLevel | null;
  // Only meaningful when educationLevel === "under_diploma".
  belowDiplomaGrade: string | null;
  // The field/major studied — relevant at every education level (e.g. a
  // bachelor's in accounting), not just under_diploma.
  fieldOfStudy: string | null;
  // --- اطلاعات استخدام و قرارداد ---
  workLocation: string | null;
  workingHours: string | null;
  contractType: ContractType | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  // Serialized as a string by Prisma's Decimal type — parsed with Number()
  // only where it's actually used as a number.
  salaryAmount: string | null;
  salaryPeriod: SalaryPeriod | null;
  bankAccountNumber: string | null;
  // A scanned/photographed contract document (PDF or image) — uploaded the
  // same way the photo above is, via its own endpoint.
  contractDocumentPath: string | null;
  // --- اطلاعات تماس و سایر ---
  address: string | null;
};

type FormState = {
  code: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  position: string;
  nationalId: string;
  mobilePhone: string;
  landlinePhone: string;
  birthDate: string;
  hireDate: string;
  email: string;
  note: string;
  status: EmployeeStatus;
  // --- اطلاعات هویتی و خانوادگی ---
  fatherName: string;
  birthCertificateNumber: string;
  maritalStatus: MaritalStatus | "";
  childrenCount: string;
  gender: Gender | "";
  // --- تحصیلات ---
  educationLevel: EducationLevel | "";
  belowDiplomaGrade: string;
  fieldOfStudy: string;
  // --- اطلاعات استخدام و قرارداد ---
  workLocation: string;
  workingHours: string;
  contractType: ContractType | "";
  contractStartDate: string;
  contractEndDate: string;
  salaryAmount: string;
  salaryPeriod: SalaryPeriod | "";
  bankAccountNumber: string;
  // --- اطلاعات تماس و سایر ---
  address: string;
};

const statusLabels: Record<EmployeeStatus, string> = {
  active: "فعال",
  on_leave: "مرخصی",
  terminated: "خاتمه همکاری",
};

const educationLevelLabels: Record<EducationLevel, string> = {
  under_diploma: "زیر دیپلم",
  diploma: "دیپلم",
  associate: "کاردانی",
  bachelor: "کارشناسی",
  master: "کارشناسی ارشد",
  phd: "دکترا",
};

const maritalStatusLabels: Record<MaritalStatus, string> = {
  single: "مجرد",
  married: "متأهل",
};

const genderLabels: Record<Gender, string> = {
  male: "مرد",
  female: "زن",
};

const contractTypeLabels: Record<ContractType, string> = {
  permanent: "دائم",
  temporary: "موقت",
  fixed_task: "کار معین",
};

const salaryPeriodLabels: Record<SalaryPeriod, string> = {
  monthly: "ماهانه",
  weekly: "هفتگی",
  daily: "روزانه",
};

const sortFieldLabels: Record<SortField, string> = {
  department: "واحد سازمانی",
  name: "نام",
  age: "سن",
  tenure: "سابقه کار",
  status: "وضعیت",
};

// Business-priority order for status, not alphabetical — active employees
// sort first.
const STATUS_SORT_RANK: Record<EmployeeStatus, number> = {
  active: 0,
  on_leave: 1,
  terminated: 2,
};

const ALLOWED_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const ALLOWED_CONTRACT_DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_CONTRACT_DOCUMENT_BYTES = 10 * 1024 * 1024;

const PAGE_SIZE = 10;

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
type PageToken = number | "start-ellipsis" | "end-ellipsis";
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

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

// Strip anything that isn't a Latin 0-9 digit (symbols, spaces, Persian
// numerals) and cap the length — used for national ID and both phone fields.
function digitsOnly(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

// First/last name: Persian letters, spaces, and the "نیم‌فاصله" (ZWNJ) only —
// no Latin letters, no digits (Latin or Persian), no symbols.
const PERSIAN_NAME_REGEX = /^[آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإء‌ ]+$/;
function persianTextOnly(value: string) {
  return value.replace(/[^آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإء‌ ]/g, "");
}

// Small red asterisk placed after the label text of a required field.
function RequiredMark() {
  return <span className="text-destructive"> *</span>;
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

  // Live preview for a newly-chosen (not yet uploaded) photo file.
  useEffect(() => {
    if (!photoFile) {
      setPhotoObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setPhotoFile(null);
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
    setPhotoFile(null);
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
    setPhotoFile(file);
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

  // A new search or sort choice starts back at page 1, so the user isn't
  // silently left on a now out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [query, sortField, sortDirection]);

  // If the list shrinks (e.g. after a delete) below the current page,
  // clamp back to the last real page instead of showing an empty one.
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

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

        <Card>
          <CardHeader><CardTitle className="text-base">فهرست کارکنان</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:w-96">
                <Search className="mx-3 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">جستجوی کارمند</span>
                <input
                  className="min-w-0 flex-1 bg-transparent pe-3 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="جستجو بر اساس نام، کد، کد ملی یا شماره تماس"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="flex items-center gap-2">
                <Label htmlFor="employee-sort-field" className="shrink-0 text-xs text-muted-foreground">مرتب‌سازی بر اساس</Label>
                <select
                  id="employee-sort-field"
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={sortField}
                  onChange={(event) => setSortField(event.target.value as SortField)}
                >
                  {Object.entries(sortFieldLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))}
                >
                  {sortDirection === "asc" ? "صعودی" : "نزولی"}
                </Button>
              </div>
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری کارکنان...</p>
            ) : sortedEmployees.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">
                {employees.length === 0 ? "هنوز کارمندی ثبت نشده است." : "کارمندی با این مشخصات یافت نشد."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[60rem] text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">تصویر</th>
                      <th className="px-4 py-3 font-medium">کد</th>
                      <th className="px-4 py-3 font-medium">نام</th>
                      <th className="px-4 py-3 font-medium">واحد</th>
                      <th className="px-4 py-3 font-medium">سمت</th>
                      <th className="px-4 py-3 font-medium">وضعیت</th>
                      {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                      <th className="px-4 py-3 font-medium">جزئیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagedEmployees.map((employee) => {
                      const expanded = expandedId === employee.id;
                      return (
                        <Fragment key={employee.id}>
                          <tr className="hover:bg-muted/30">
                            <td className="px-4 py-3">
                              <div className="flex size-14 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                                {employee.photoPath ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={`/api${employee.photoPath}`} alt="" className="size-full object-cover" />
                                ) : (
                                  <User className="size-6 text-muted-foreground" aria-hidden="true" />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium">{employee.code}</td>
                            <td className="px-4 py-3">{employee.firstName} {employee.lastName}</td>
                            <td className="px-4 py-3">{employee.department.name}</td>
                            <td className="px-4 py-3">{employee.position || "-"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{statusLabels[employee.status]}</td>
                            {canManage ? (
                              <td className="px-4 py-3"><Button variant="link" size="sm" onClick={() => openEditForm(employee)}>ویرایش</Button></td>
                            ) : null}
                            <td className="px-4 py-3">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={expanded ? "بستن جزئیات" : "نمایش جزئیات بیشتر"}
                                aria-expanded={expanded}
                                onClick={() => setExpandedId(expanded ? null : employee.id)}
                              >
                                {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                              </Button>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="bg-muted/20">
                              <td colSpan={canManage ? 8 : 7} className="px-4 py-4">
                                <div className="space-y-5">
                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات هویتی و خانوادگی</h4>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">جنسیت</p>
                                        <p className="text-sm">{employee.gender ? genderLabels[employee.gender] : "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">نام پدر</p>
                                        <p className="text-sm">{employee.fatherName || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">کد ملی</p>
                                        <p className="text-sm">{employee.nationalId || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">شماره شناسنامه</p>
                                        <p className="text-sm">{employee.birthCertificateNumber || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">تاریخ تولد</p>
                                        <p className="text-sm">{formatJalali(employee.birthDate) || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">وضعیت تأهل</p>
                                        <p className="text-sm">
                                          {employee.maritalStatus ? maritalStatusLabels[employee.maritalStatus] : "وارد نشده"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">تعداد فرزند</p>
                                        <p className="text-sm">{employee.childrenCount ?? "وارد نشده"}</p>
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">تحصیلات</h4>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">تحصیلات</p>
                                        <p className="text-sm">
                                          {employee.educationLevel
                                            ? `${educationLevelLabels[employee.educationLevel]}${
                                                employee.educationLevel === "under_diploma" && employee.belowDiplomaGrade
                                                  ? ` (${employee.belowDiplomaGrade})`
                                                  : ""
                                              }`
                                            : "وارد نشده"}
                                        </p>
                                      </div>
                                      {employee.educationLevel ? (
                                        <div>
                                          <p className="text-xs text-muted-foreground">رشته</p>
                                          <p className="text-sm">{employee.fieldOfStudy || "وارد نشده"}</p>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات استخدام و قرارداد</h4>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">محل انجام کار</p>
                                        <p className="text-sm">{employee.workLocation || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">ساعات کار</p>
                                        <p className="text-sm">{employee.workingHours || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">نوع قرارداد</p>
                                        <p className="text-sm">
                                          {employee.contractType ? contractTypeLabels[employee.contractType] : "وارد نشده"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">مدت قرارداد</p>
                                        <p className="text-sm">
                                          {employee.contractStartDate || employee.contractEndDate
                                            ? `${formatJalali(employee.contractStartDate) || "؟"} تا ${formatJalali(employee.contractEndDate) || "؟"}`
                                            : "وارد نشده"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">حقوق</p>
                                        <p className="text-sm">
                                          {employee.salaryAmount
                                            ? `${Number(employee.salaryAmount).toLocaleString("fa-IR")} تومان${
                                                employee.salaryPeriod ? ` (${salaryPeriodLabels[employee.salaryPeriod]})` : ""
                                              }`
                                            : "وارد نشده"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">شماره حساب بانکی</p>
                                        <p className="text-sm">{employee.bankAccountNumber || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">فایل قرارداد</p>
                                        <p className="text-sm">
                                          {employee.contractDocumentPath ? (
                                            <a
                                              href={`/api${employee.contractDocumentPath}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-primary underline"
                                            >
                                              مشاهده فایل
                                            </a>
                                          ) : (
                                            "وارد نشده"
                                          )}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold text-foreground">اطلاعات تماس و سایر</h4>
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                      <div>
                                        <p className="text-xs text-muted-foreground">تلفن همراه</p>
                                        <p className="text-sm">{employee.mobilePhone || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">تلفن ثابت</p>
                                        <p className="text-sm">{employee.landlinePhone || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">ایمیل</p>
                                        <p className="text-sm">{employee.email || "وارد نشده"}</p>
                                      </div>
                                      <div>
                                        <p className="text-xs text-muted-foreground">تاریخ استخدام</p>
                                        <p className="text-sm">{formatJalali(employee.hireDate) || "وارد نشده"}</p>
                                      </div>
                                      <div className="sm:col-span-2 lg:col-span-4">
                                        <p className="text-xs text-muted-foreground">آدرس</p>
                                        <p className="text-sm">{employee.address || "وارد نشده"}</p>
                                      </div>
                                      <div className="sm:col-span-2 lg:col-span-4">
                                        <p className="text-xs text-muted-foreground">یادداشت</p>
                                        <p className="text-sm">{employee.note || "بدون یادداشت"}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && sortedEmployees.length > 0 && totalPages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  نمایش {(page - 1) * PAGE_SIZE + 1} تا {Math.min(page * PAGE_SIZE, sortedEmployees.length)} از {sortedEmployees.length} کارمند
                </p>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    قبلی
                  </Button>
                  {pageNumbers.map((pageToken) =>
                    typeof pageToken === "number" ? (
                      <Button
                        key={pageToken}
                        type="button"
                        variant={pageToken === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPage(pageToken)}
                      >
                        {pageToken}
                      </Button>
                    ) : (
                      <span key={pageToken} className="px-1 text-xs text-muted-foreground">…</span>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  >
                    بعدی
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Add/edit is a popup: fixed to the screen and centered, with its own
          backdrop. It never becomes part of the page's layout, so the page
          itself never needs to scroll to reach it or its buttons — only the
          field area inside the popup scrolls, and only if it doesn't fit. */}
      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "ویرایش کارمند" : "افزودن کارمند جدید"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
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
                        onClick={() => setPhotoFile(null)}
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
            <Button type="button" variant="outline" onClick={closeForm}>انصراف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
