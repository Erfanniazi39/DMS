import { roleLabels } from "@/app/letters/shared";
import { formatMoney } from "@/lib/format";

export type DocumentType = "PURCHASE" | "SALES_ORDER" | "PURCHASE_REQUEST";
export type AmountBasis = "TOTAL" | "ANY_LINE_TOTAL" | "ANY_UNIT_PRICE";
export type ApproverType = "ROLE" | "USER";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PURCHASE: "خرید",
  SALES_ORDER: "سفارش فروش",
  PURCHASE_REQUEST: "درخواست خرید",
};

export const AMOUNT_BASIS_LABELS: Record<AmountBasis, string> = {
  TOTAL: "جمع کل سند",
  ANY_LINE_TOTAL: "مبلغ هر ردیف",
  ANY_UNIT_PRICE: "قیمت واحد هر ردیف",
};

export type RuleStepApprover = {
  id: number;
  approverType: ApproverType;
  roleId: number | null;
  userId: number | null;
  name: string;
  canViewDocument: boolean;
};

// A step lists one or more approvers; ANY ONE of them can decide it.
export type RuleStep = {
  id: number;
  level: number;
  label: string | null;
  approverLabel: string;
  approvers: RuleStepApprover[];
  canViewDocument: boolean;
};

export type WorkflowRule = {
  id: number;
  name: string;
  documentType: DocumentType;
  isActive: boolean;
  sortOrder: number;
  version: number;
  purchaseTypeId: number | null;
  supplierId: number | null;
  requesterDepartmentId: number | null;
  amountBasis: AmountBasis;
  minAmount: string | null;
  maxAmount: string | null;
  minDiscountPercent: string | null;
  notifyByLetter: boolean;
  note: string | null;
  steps: RuleStep[];
};

export type FormOptions = {
  roles: { id: number; name: string }[];
  users: { id: number; username: string; fullName: string | null; roleId: number }[];
  purchaseTypes: { id: number; code: string; nameFa: string }[];
  departments: { id: number; code: string; name: string }[];
  suppliers: { id: number; code: string; name: string }[];
};

export function roleName(name: string) {
  return roleLabels[name] ?? name;
}

export function userName(user: { username: string; fullName: string | null }) {
  return user.fullName?.trim() || user.username;
}

// «از ۱٬۰۰۰٬۰۰۰ تا ۵٬۰۰۰٬۰۰۰ ریال» style summary of a rule's amount band.
export function bandSummary(rule: Pick<WorkflowRule, "amountBasis" | "minAmount" | "maxAmount" | "minDiscountPercent">): string {
  const discount =
    rule.minDiscountPercent === null
      ? null
      : Number(rule.minDiscountPercent) === 0
        ? "فقط وقتی تخفیف دارد"
        : `تخفیف حداقل ${Number(rule.minDiscountPercent).toLocaleString("fa-IR")}٪`;
  if (rule.minAmount === null && rule.maxAmount === null) return discount ?? "هر مبلغ";
  const parts: string[] = [];
  if (rule.minAmount !== null) parts.push(`از ${formatMoney(rule.minAmount)}`);
  if (rule.maxAmount !== null) parts.push(`تا کمتر از ${formatMoney(rule.maxAmount)}`);
  return `${AMOUNT_BASIS_LABELS[rule.amountBasis]}: ${parts.join(" ")} ریال${discount ? ` — ${discount}` : ""}`;
}

export function scopeSummary(rule: WorkflowRule, options: FormOptions | null): string[] {
  const parts: string[] = [];
  if (rule.purchaseTypeId !== null) parts.push(`نوع خرید: ${options?.purchaseTypes.find((t) => t.id === rule.purchaseTypeId)?.nameFa ?? `#${rule.purchaseTypeId}`}`);
  if (rule.supplierId !== null) parts.push(`تأمین‌کننده: ${options?.suppliers.find((s) => s.id === rule.supplierId)?.name ?? `#${rule.supplierId}`}`);
  if (rule.requesterDepartmentId !== null) parts.push(`دپارتمان: ${options?.departments.find((d) => d.id === rule.requesterDepartmentId)?.name ?? `#${rule.requesterDepartmentId}`}`);
  return parts;
}
