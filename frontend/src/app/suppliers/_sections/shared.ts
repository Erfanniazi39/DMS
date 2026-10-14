// Types and labels for the Suppliers screens. Every shape mirrors the backend
// response (backend/src/suppliers/suppliers.service.ts) — the legacy bank_*
// columns are never sent; bank accounts live in supplier_bank_accounts.

export type SupplierStatus = "active" | "inactive" | "blacklisted";
export type SupplierKind = "INDIVIDUAL" | "ORGANIZATION";

export type SupplierBankAccount = {
  id: number;
  bankName: string | null;
  accountNumber: string | null;
  shebaNumber: string | null;
  accountHolderName: string | null;
  isDefault: boolean;
  isActive: boolean;
  note: string | null;
};

export type Supplier = {
  id: number;
  code: string;
  name: string;
  supplierKind: SupplierKind | null;
  title: string | null;
  nationalId: string | null;
  economicCode: string | null;
  registrationNumber: string | null;
  phone: string | null;
  phone2: string | null;
  mobile: string | null;
  fax: string | null;
  telex: string | null;
  website: string | null;
  email: string | null;
  address: string | null;
  address2: string | null;
  province: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  cityCode: string | null;
  locationNumber: string | null;
  locationName: string | null;
  taxOfficeProvince: string | null;
  taxOfficeCity: string | null;
  status: SupplierStatus;
  note: string | null;
};

export type PurchaseTypeRef = { id: number; code: string; nameFa: string; isActive: boolean };
export type SupplierGood = { id: number; name: string; note: string | null };

// GET /suppliers (list rows) also carry the supplier's purchase types.
export type SupplierListRow = Supplier & { purchaseTypes: PurchaseTypeRef[] };

// GET /suppliers/:id only.
export type SupplierDetail = Supplier & { bankAccounts: SupplierBankAccount[]; purchaseTypes: PurchaseTypeRef[]; goods: SupplierGood[] };

export const statusLabels: Record<SupplierStatus, string> = { active: "فعال", inactive: "غیرفعال", blacklisted: "لیست سیاه" };
export const kindLabels: Record<SupplierKind, string> = { ORGANIZATION: "حقوقی", INDIVIDUAL: "حقیقی" };
export const nationalIdLabel: Record<SupplierKind, string> = { ORGANIZATION: "شناسه ملی", INDIVIDUAL: "کد ملی" };

export const textareaClass = "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";
export const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

// Same pattern the backend's z.string().email() uses (zod v4 core regexes),
// so a value passing here is never rejected by the server for its format.
export const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
