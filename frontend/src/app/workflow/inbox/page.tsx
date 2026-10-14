"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LIST_PAGE_SIZE, ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { formatDateTime } from "@/app/letters/shared";
import { useAdminUser } from "@/app/admin/layout";
import { approvalRequestStatusLabels, approvalRequestStatusTone, approvalPersonName, type ApprovalPerson, type ApprovalRequestStatus } from "@/app/purchases/shared";
import { DOCUMENT_TYPE_LABELS, type DocumentType } from "../shared";

type Tab = "mine" | "decided" | "submitted" | "stuck";

type InboxRow = {
  id: number;
  documentType: DocumentType;
  documentId: number;
  documentNumber: string;
  summary: string;
  amount: string;
  status: ApprovalRequestStatus;
  currentLevel: number;
  totalLevels: number;
  currentApproverLabel: string | null;
  requestedBy: ApprovalPerson;
  createdAt: string;
  decidedAt: string | null;
};

type StuckRow = {
  id: number;
  documentType: DocumentType;
  documentId: number;
  documentNumber: string;
  summary: string;
  level: number;
  approverLabel: string;
  requestedBy: ApprovalPerson;
  createdAt: string;
};

// Where each approvable document's page lives (the buttons are on that page).
const DOCUMENT_HREF: Record<DocumentType, (id: number) => string> = {
  PURCHASE: (id) => `/purchases/${id}`,
  SALES_ORDER: (id) => `/sales-orders/${id}`,
  PURCHASE_REQUEST: (id) => `/purchase-requests/${id}`,
};

const TAB_TEXT: Record<Tab, { label: string; empty: string }> = {
  mine: { label: "در انتظار من", empty: "موردی برای تأیید شما وجود ندارد." },
  decided: { label: "تصمیم‌های من", empty: "هنوز تصمیمی ثبت نکرده‌اید." },
  submitted: { label: "ارسال‌شده‌های من", empty: "هنوز سندی برای تأیید نفرستاده‌اید." },
  stuck: { label: "متوقف‌شده‌ها", empty: "درخواست متوقف‌شده‌ای وجود ندارد." },
};

// کارتابل تأییدها — what waits for my decision, what I decided, what I sent
// for approval, and (workflow.manage) requests no active person can decide.
// It only lists and links: approve / reject happen on the document's page,
// where the engine re-checks eligibility.
export default function WorkflowInboxPage() {
  const router = useRouter();
  const user = useAdminUser();
  const canManage = user?.permissions.includes("workflow.manage") ?? false;
  const canUse = user?.permissions.includes("workflow.inbox") ?? false;
  const { toasts, pushError, dismiss } = useToasts();
  const tabs: Tab[] = canManage ? ["mine", "decided", "submitted", "stuck"] : ["mine", "decided", "submitted"];

  const [tab, setTab] = useState<Tab>("mine");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [stuck, setStuck] = useState<StuckRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "stuck") {
        const data = await apiFetch<StuckRow[]>("/workflow/stuck");
        setStuck(data);
        setTotal(data.length);
      } else {
        const params = new URLSearchParams({ tab, page: String(page), pageSize: String(LIST_PAGE_SIZE) });
        const data = await apiFetch<Paginated<InboxRow>>(`/workflow/inbox?${params.toString()}`);
        setRows(data.items);
        setTotal(data.total);
      }
    } catch (reason) {
      pushError((reason as ApiError).message ?? "دریافت کارتابل ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, [tab, page, pushError]);

  useEffect(() => {
    if (!canUse) return;
    const run = async () => load();
    void run();
  }, [canUse, load]);

  if (!canUse) return <p className="p-8 text-center text-sm text-muted-foreground">دسترسی به این بخش ندارید.</p>;

  const empty = tab === "stuck" ? stuck.length === 0 : rows.length === 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">کارتابل تأییدها</h1>
          <p className="mt-1 text-sm text-muted-foreground">برای تأیید یا ردِ یک مورد، شمارهٔ آن را باز کنید.</p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            {tabs.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={tab === item ? "default" : "ghost"}
                onClick={() => {
                  setTab(item);
                  setPage(1);
                }}
              >
                {TAB_TEXT[item].label}
              </Button>
            ))}
          </div>

          {loading && empty ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>
          ) : empty ? (
            <p className="py-14 text-center text-sm text-muted-foreground">{TAB_TEXT[tab].empty}</p>
          ) : tab === "stuck" ? (
            <div className={`overflow-x-auto ${loading ? "pointer-events-none opacity-60" : ""}`}>
              <table className="w-full min-w-[48rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">سند</th>
                    <th className="px-3 py-2.5 font-medium">شرح</th>
                    <th className="px-3 py-2.5 font-medium">مرحلهٔ منتظر</th>
                    <th className="px-3 py-2.5 font-medium">ارسال‌کننده</th>
                    <th className="px-3 py-2.5 font-medium">از تاریخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stuck.map((row) => (
                    <tr key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(DOCUMENT_HREF[row.documentType](row.documentId))}>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-primary">{row.documentNumber}</span>
                        <span className="ms-2 text-xs text-muted-foreground">{DOCUMENT_TYPE_LABELS[row.documentType]}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.summary}</td>
                      <td className="px-3 py-2.5">
                        {row.level.toLocaleString("fa-IR")}. {row.approverLabel}
                        <span className="block text-xs text-destructive">هیچ کاربر فعالی نمی‌تواند این مرحله را تأیید کند</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{approvalPersonName(row.requestedBy)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                راه‌حل: درخواست را از صفحهٔ سند پس بگیرید، قانون تأیید یا کاربران را اصلاح کنید و دوباره بفرستید.
              </p>
            </div>
          ) : (
            <div className={`overflow-x-auto ${loading ? "pointer-events-none opacity-60" : ""}`}>
              <table className="w-full min-w-[56rem] text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">سند</th>
                    <th className="px-3 py-2.5 font-medium">شرح</th>
                    <th className="px-3 py-2.5 font-medium">مبلغ (ریال)</th>
                    <th className="px-3 py-2.5 font-medium">ارسال‌کننده</th>
                    <th className="px-3 py-2.5 font-medium">{tab === "mine" ? "مرحله" : "وضعیت"}</th>
                    <th className="px-3 py-2.5 font-medium">{tab === "decided" ? "تاریخ" : "تاریخ ارسال"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(DOCUMENT_HREF[row.documentType](row.documentId))}>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-primary">{row.documentNumber}</span>
                        <span className="ms-2 text-xs text-muted-foreground">{DOCUMENT_TYPE_LABELS[row.documentType]}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.summary}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatMoney(row.amount)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{approvalPersonName(row.requestedBy)}</td>
                      <td className="px-3 py-2.5">
                        {tab === "mine" ? (
                          <span className="text-xs">
                            {row.currentLevel.toLocaleString("fa-IR")} از {row.totalLevels.toLocaleString("fa-IR")}
                            {row.currentApproverLabel ? ` — ${row.currentApproverLabel}` : ""}
                          </span>
                        ) : (
                          <StatusBadge label={approvalRequestStatusLabels[row.status]} tone={approvalRequestStatusTone[row.status]} />
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(tab === "decided" ? (row.decidedAt ?? row.createdAt) : row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab !== "stuck" && total > LIST_PAGE_SIZE ? (
            <ListPagination page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} className="border-t border-border px-4 py-3" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
