// Shared types, Persian labels, and small display helpers for the Customers
// module (list, create/edit form, detail page). Same role as
// app/purchases/shared.tsx — every shape here mirrors an actual backend
// response (backend/src/customers/customers.service.ts and the child
// services); don't add fields the backend doesn't send.

import type { BadgeTone } from "@/components/ui/status-badge";
import type { PaymentMethod } from "@/app/purchases/shared";

export { StatusBadge, ColorLegend, toneCellClasses, type BadgeTone } from "@/components/ui/status-badge";
export { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
export { formatMoney } from "@/lib/format";
// PaymentMethod is one enum shared by Purchases and (future) Sales/customers.
export { PAYMENT_METHODS, paymentMethodLabels, type PaymentMethod } from "@/app/purchases/shared";

export type CustomerKind = "INDIVIDUAL" | "ORGANIZATION";
export type CustomerStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED";
export type CustomerAddressType = "BILLING" | "DELIVERY" | "OTHER";
export type CustomerNoteType = "GENERAL" | "WARNING" | "DELIVERY" | "FINANCE";
export type CustomerDocumentType = "BUSINESS_LICENSE" | "REGISTRATION" | "IDENTITY" | "CONTRACT" | "TAX" | "SCANNED_PAPER_RECORD" | "OTHER";
export type ComplaintSeverity = "LOW" | "MEDIUM" | "HIGH";
export type ComplaintStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export const CUSTOMER_KINDS: CustomerKind[] = ["ORGANIZATION", "INDIVIDUAL"];
export const CUSTOMER_STATUSES: CustomerStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"];
export const CUSTOMER_ADDRESS_TYPES: CustomerAddressType[] = ["DELIVERY", "BILLING", "OTHER"];
export const CUSTOMER_NOTE_TYPES: CustomerNoteType[] = ["GENERAL", "WARNING", "DELIVERY", "FINANCE"];
export const CUSTOMER_DOCUMENT_TYPES: CustomerDocumentType[] = ["BUSINESS_LICENSE", "REGISTRATION", "IDENTITY", "CONTRACT", "TAX", "SCANNED_PAPER_RECORD", "OTHER"];
export const COMPLAINT_SEVERITIES: ComplaintSeverity[] = ["LOW", "MEDIUM", "HIGH"];
export const COMPLAINT_STATUSES: ComplaintStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export const customerKindLabels: Record<CustomerKind, string> = {
  INDIVIDUAL: "حقیقی",
  ORGANIZATION: "حقوقی",
};

// The national-id field's label and expected length depend on the kind
// (backend customer.dto.ts: 10 digits for an individual, 11 for an organization).
export const nationalIdLabel: Record<CustomerKind, string> = {
  INDIVIDUAL: "کد ملی",
  ORGANIZATION: "شناسه ملی",
};
export const nationalIdLength: Record<CustomerKind, number> = {
  INDIVIDUAL: 10,
  ORGANIZATION: 11,
};

export const customerStatusLabels: Record<CustomerStatus, string> = {
  ACTIVE: "فعال",
  INACTIVE: "غیرفعال",
  SUSPENDED: "معلق",
  ARCHIVED: "بایگانی‌شده",
};

export const customerStatusTone: Record<CustomerStatus, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "muted",
  SUSPENDED: "warning",
  ARCHIVED: "secondary",
};

// Mirrors backend customer-rules.ts REASON_REQUIRED_CUSTOMER_STATUSES.
export const REASON_REQUIRED_STATUSES: CustomerStatus[] = ["SUSPENDED", "ARCHIVED"];

export const addressTypeLabels: Record<CustomerAddressType, string> = {
  BILLING: "صورتحساب",
  DELIVERY: "تحویل کالا",
  OTHER: "سایر",
};

export const noteTypeLabels: Record<CustomerNoteType, string> = {
  GENERAL: "عمومی",
  WARNING: "هشدار",
  DELIVERY: "تحویل",
  FINANCE: "مالی",
};

export const noteTypeTone: Record<CustomerNoteType, BadgeTone> = {
  GENERAL: "muted",
  WARNING: "destructive",
  DELIVERY: "primary",
  FINANCE: "warning",
};

export const documentTypeLabels: Record<CustomerDocumentType, string> = {
  BUSINESS_LICENSE: "پروانه کسب",
  REGISTRATION: "مدارک ثبتی",
  IDENTITY: "مدرک هویتی",
  CONTRACT: "قرارداد",
  TAX: "مدارک مالیاتی",
  SCANNED_PAPER_RECORD: "سند کاغذی اسکن‌شده",
  OTHER: "سایر",
};

export const complaintSeverityLabels: Record<ComplaintSeverity, string> = {
  LOW: "کم",
  MEDIUM: "متوسط",
  HIGH: "زیاد",
};

export const complaintSeverityTone: Record<ComplaintSeverity, BadgeTone> = {
  LOW: "muted",
  MEDIUM: "warning",
  HIGH: "destructive",
};

export const complaintStatusLabels: Record<ComplaintStatus, string> = {
  OPEN: "باز",
  IN_PROGRESS: "در حال پیگیری",
  RESOLVED: "حل‌شده",
  CLOSED: "بسته‌شده",
};

export const complaintStatusTone: Record<ComplaintStatus, BadgeTone> = {
  OPEN: "destructive",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CLOSED: "muted",
};

// --- Reference data -----------------------------------------------------------

// GET /customer-groups, /territories (active only) or their /all variants.
export type ReferenceOption = { id: number; code: string; nameFa: string; nameEn: string; isActive: boolean; sortOrder: number };
// GET /payment-terms (active only) or /payment-terms/all.
export type PaymentTermOption = ReferenceOption & { dueDays: number };
// GET /customers/assignable-users (customers.manage) — complaint owner picker.
export type UserOption = { id: number; username: string };

// --- API record shapes ------------------------------------------------------

type UserRef = { id: number; username: string } | null;

// One row of GET /customers (see toListItem() in customers.service.ts).
// nationalId is deliberately not part of list rows.
export type CustomerListItem = {
  id: number;
  customerNumber: string;
  customerKind: CustomerKind;
  name: string;
  legalName: string | null;
  legacyCode: string | null;
  phone: string;
  email: string | null;
  status: CustomerStatus;
  customerGroup: { id: number; code: string; nameFa: string };
  territory: { id: number; code: string; nameFa: string } | null;
  defaultCity: string | null;
  hasPinnedWarning: boolean;
  creditHold: boolean;
};

export type CustomerContactRow = {
  id: number;
  name: string;
  roleTitle: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  isActive: boolean;
  note: string | null;
};

export type CustomerAddressRow = {
  id: number;
  addressType: CustomerAddressType;
  label: string | null;
  province: string | null;
  city: string | null;
  addressLine: string;
  postalCode: string | null;
  phone: string | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  isActive: boolean;
};

export type CustomerNoteRow = {
  id: number;
  noteType: CustomerNoteType;
  body: string;
  isPinned: boolean;
  createdAt: string;
  createdByUser: UserRef;
};

export type CustomerDocumentRow = {
  id: number;
  documentType: CustomerDocumentType;
  documentNumber: string | null;
  date: string | null;
  expiresAt: string | null;
  filePath: string | null;
  note: string | null;
  createdAt: string;
  uploadedByUser: UserRef;
};

export type CustomerComplaintRow = {
  id: number;
  date: string;
  category: string;
  description: string;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  resolution: string | null;
  ownerUserId: number | null;
  ownerUser: UserRef;
  createdByUser: UserRef;
  createdAt: string;
  // Optimistic-locking token for PATCH /customers/:id/complaints/:complaintId.
  updatedAt: string;
};

// GET /customers/:id. No financial profile here — only a two-flag summary;
// the profile itself is GET /customers/:id/financial (customers.finance).
export type CustomerDetail = {
  id: number;
  customerNumber: string;
  customerKind: CustomerKind;
  name: string;
  legalName: string | null;
  // Sensitive — masked on screen (maskNationalId) unless revealed.
  nationalId: string | null;
  economicCode: string | null;
  legacyCode: string | null;
  phone: string;
  email: string | null;
  customerGroupId: number;
  territoryId: number | null;
  status: CustomerStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  // Optimistic-locking token — sent back on PATCH /customers/:id and /status.
  updatedAt: string;
  customerGroup: ReferenceOption;
  territory: ReferenceOption | null;
  createdByUser: UserRef;
  contacts: CustomerContactRow[];
  addresses: CustomerAddressRow[];
  notes: CustomerNoteRow[];
  documents: CustomerDocumentRow[];
  complaints: CustomerComplaintRow[];
  financialSummary: { creditHold: boolean; hasPaymentTerm: boolean };
};

// GET /customers/:id/financial (customers.finance).
export type CustomerFinancialProfile = {
  id: number | null;
  customerId: number;
  paymentTermId: number | null;
  paymentTerm: PaymentTermOption | null;
  preferredPaymentMethod: PaymentMethod | null;
  creditLimit: string | null;
  creditHold: boolean;
  creditHoldReason: string | null;
  updatedAt: string | null;
};

export type AuditChange = { field: string; from: unknown; to: unknown };

// GET /customers/:id/history. `changes` is null when withheld (financial
// diffs without customers.finance).
export type CustomerHistoryEntry = {
  id: number;
  action: string;
  details: string | null;
  changes: AuditChange[] | null;
  createdAt: string;
  user: UserRef;
};

// One candidate in the CUSTOMER_POSSIBLE_DUPLICATE 409's details.candidates.
export type DuplicateCandidate = {
  id: number;
  customerNumber: string;
  name: string;
  status: CustomerStatus;
  matchedOn: ("name" | "phone")[];
};

// --- Helpers ----------------------------------------------------------------

/** "*******678" — national id with all but the last 3 digits hidden. */
export function maskNationalId(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.length <= 3) return "***";
  return `${"*".repeat(value.length - 3)}${value.slice(-3)}`;
}

export function primaryContact(customer: Pick<CustomerDetail, "contacts">): CustomerContactRow | undefined {
  return customer.contacts.find((contact) => contact.isPrimary && contact.isActive) ?? customer.contacts.find((contact) => contact.isActive);
}

export function hasDefaultDeliveryAddress(customer: Pick<CustomerDetail, "addresses">): boolean {
  return customer.addresses.some((address) => address.addressType === "DELIVERY" && address.isDefault && address.isActive);
}

/** Pinned WARNING notes — shown as banners in the detail header. */
export function pinnedWarnings(customer: Pick<CustomerDetail, "notes">): CustomerNoteRow[] {
  return customer.notes.filter((note) => note.isPinned && note.noteType === "WARNING");
}
