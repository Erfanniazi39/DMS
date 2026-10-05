// Types, Persian labels and small input helpers shared by the Employees
// page (page.tsx) and its colocated sections in this folder. Not a route:
// Next.js ignores the underscore-prefixed `_sections` folder.

export type Department = { id: number; name: string; status: "active" | "inactive" };
export type EmployeeStatus = "active" | "on_leave" | "terminated";
export type EducationLevel = "under_diploma" | "diploma" | "associate" | "bachelor" | "master" | "phd";
export type MaritalStatus = "single" | "married";
export type Gender = "male" | "female";
export type ContractType = "permanent" | "temporary" | "fixed_task";
export type SalaryPeriod = "monthly" | "weekly" | "daily";
// How the employee list is ordered. "tenure" is seniority — time since
// hireDate — not a separate stored field.
export type SortField = "department" | "name" | "age" | "tenure" | "status";
export type SortDirection = "asc" | "desc";
// EMPLOYEE records only — no User/account data is joined in or displayed here.
export type Employee = {
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

export type FormState = {
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

export const statusLabels: Record<EmployeeStatus, string> = {
  active: "فعال",
  on_leave: "مرخصی",
  terminated: "خاتمه همکاری",
};

export const educationLevelLabels: Record<EducationLevel, string> = {
  under_diploma: "زیر دیپلم",
  diploma: "دیپلم",
  associate: "کاردانی",
  bachelor: "کارشناسی",
  master: "کارشناسی ارشد",
  phd: "دکترا",
};

export const maritalStatusLabels: Record<MaritalStatus, string> = {
  single: "مجرد",
  married: "متأهل",
};

export const genderLabels: Record<Gender, string> = {
  male: "مرد",
  female: "زن",
};

export const contractTypeLabels: Record<ContractType, string> = {
  permanent: "دائم",
  temporary: "موقت",
  fixed_task: "کار معین",
};

export const salaryPeriodLabels: Record<SalaryPeriod, string> = {
  monthly: "ماهانه",
  weekly: "هفتگی",
  daily: "روزانه",
};

export const sortFieldLabels: Record<SortField, string> = {
  department: "واحد سازمانی",
  name: "نام",
  age: "سن",
  tenure: "سابقه کار",
  status: "وضعیت",
};

// Business-priority order for status, not alphabetical — active employees
// sort first.
export const STATUS_SORT_RANK: Record<EmployeeStatus, number> = {
  active: 0,
  on_leave: 1,
  terminated: 2,
};

export const PAGE_SIZE = 10;

// One entry of the windowed page-number list built by buildPageNumbers()
// in page.tsx.
export type PageToken = number | "start-ellipsis" | "end-ellipsis";

// Strip anything that isn't a Latin 0-9 digit (symbols, spaces, Persian
// numerals) and cap the length — used for national ID and both phone fields.
export function digitsOnly(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

// First/last name: Persian letters, spaces, and the "نیم‌فاصله" (ZWNJ) only —
// no Latin letters, no digits (Latin or Persian), no symbols.
export const PERSIAN_NAME_REGEX = /^[آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإء‌ ]+$/;
export function persianTextOnly(value: string) {
  return value.replace(/[^آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیئؤأإء‌ ]/g, "");
}
