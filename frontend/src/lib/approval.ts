// Workflow approval shapes shared by every document that goes through the
// approval engine (backend/src/workflow/): purchases, purchase requests and
// sales orders.
import type { BadgeTone } from "@/components/ui/status-badge";

// Workflow approval (backend/src/workflow): one approval request per
// submission of the purchase for approval; each has ordered steps.
export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";
export type ApprovalStepStatus = "WAITING" | "OPEN" | "APPROVED" | "REJECTED" | "CANCELLED";
export type ApprovalPerson = { id: number; username: string; fullName: string | null };
export type ApprovalStepRow = {
  id: number;
  level: number;
  approverType: "ROLE" | "USER";
  approverLabel: string;
  status: ApprovalStepStatus;
  decidedBy: ApprovalPerson | null;
  decidedAt: string | null;
  comment: string | null;
};
export type ApprovalRequestRow = {
  id: number;
  status: ApprovalRequestStatus;
  amount: string;
  ruleName: string;
  ruleVersion: number;
  currentLevel: number;
  requestedBy: ApprovalPerson;
  createdAt: string;
  decidedAt: string | null;
  closeReason: string | null;
  steps: ApprovalStepRow[];
};
// GET /purchases/:id → `approval`. Absent on responses of the write endpoints
// (PATCH …) — the detail page reloads after those.
export type PurchaseApproval = {
  requests: ApprovalRequestRow[];
  canDecide: boolean;
  requestedByUserId: number | null;
  // Purchase requests only: an approval request is open (status SUBMITTED alone
  // can also mean a plain, rule-less submission).
  waitingOnWorkflow?: boolean;
};
/** The `approval` block of GET /purchases|/purchase-requests|/sales-orders/:id. */
export type DocumentApproval = PurchaseApproval;

export type ApprovalPreview =
  | { required: false; reapproval: boolean }
  | { required: true; reapproval: boolean; ruleName: string; levels: { level: number; approverLabel: string }[] };

export const approvalRequestStatusLabels: Record<ApprovalRequestStatus, string> = {
  PENDING: "در انتظار تصمیم",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
  WITHDRAWN: "پس‌گرفته‌شده",
  CANCELLED: "لغوشده",
};
export const approvalRequestStatusTone: Record<ApprovalRequestStatus, BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  WITHDRAWN: "muted",
  CANCELLED: "muted",
};
export const approvalStepStatusLabels: Record<ApprovalStepStatus, string> = {
  WAITING: "در نوبت",
  OPEN: "منتظر تصمیم",
  APPROVED: "تأیید کرد",
  REJECTED: "رد کرد",
  CANCELLED: "لغو شد",
};

export function approvalPersonName(person: ApprovalPerson | null): string {
  return person ? person.fullName?.trim() || person.username : "-";
}

