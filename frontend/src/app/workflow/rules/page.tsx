"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { selectClass } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  DOCUMENT_TYPE_LABELS,
  bandSummary,
  roleName,
  scopeSummary,
  userName,
  type DocumentType,
  type FormOptions,
  type WorkflowRule,
} from "../shared";

const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];

type TestResult = { required: false } | { required: true; ruleId: number; ruleName: string; levels: { level: number; approverLabel: string }[] };

// Approval rules (workflow.manage, ADMIN). The first ACTIVE rule that matches
// a document wins, top to bottom — so put higher amount bands above lower
// ones. Editing a rule never changes an approval already in progress.
export default function WorkflowRulesPage() {
  const user = useAdminUser();
  const canManage = user?.permissions.includes("workflow.manage") ?? false;
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();

  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<WorkflowRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ruleList, formOptions] = await Promise.all([apiFetch<WorkflowRule[]>("/workflow/rules"), apiFetch<FormOptions>("/workflow/form-options")]);
      setRules(ruleList);
      setOptions(formOptions);
    } catch (reason) {
      setLoadError((reason as ApiError).message ?? "دریافت قوانین ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    const run = async () => load();
    void run();
  }, [canManage, load]);

  const grouped = useMemo(() => DOCUMENT_TYPES.map((type) => ({ type, rules: rules.filter((rule) => rule.documentType === type) })), [rules]);

  function approverText(step: WorkflowRule["steps"][number]) {
    if (step.label) return step.label;
    const names = step.approvers.map((approver) => {
      if (approver.approverType === "ROLE") {
        const role = options?.roles.find((item) => item.id === approver.roleId);
        return role ? `نقش «${roleName(role.name)}»` : approver.name;
      }
      const person = options?.users.find((item) => item.id === approver.userId);
      return person ? userName(person) : approver.name;
    });
    return names.join(" یا ");
  }

  async function move(type: DocumentType, ruleId: number, direction: -1 | 1) {
    const ids = rules.filter((rule) => rule.documentType === type).map((rule) => rule.id);
    const index = ids.indexOf(ruleId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(ruleId);
    try {
      await apiFetch("/workflow/rules/reorder", { method: "POST", body: JSON.stringify({ documentType: type, ruleIds: ids }) });
      await load();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "تغییر ترتیب ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(rule: WorkflowRule) {
    setBusyId(rule.id);
    try {
      await apiFetch(`/workflow/rules/${rule.id}/${rule.isActive ? "deactivate" : "activate"}`, { method: "POST" });
      pushSuccess(rule.isActive ? "قانون غیرفعال شد." : "قانون فعال شد.");
      await load();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "تغییر وضعیت ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await apiFetch(`/workflow/rules/${deleting.id}`, { method: "DELETE" });
      pushSuccess("قانون حذف شد.");
      setDeleting(null);
      await load();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف ناموفق بود.");
      setDeleting(null);
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) {
    return <p className="p-8 text-center text-sm text-muted-foreground">دسترسی به این بخش ندارید.</p>;
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">قوانین تأیید</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              تعیین کنید کدام اسناد به تأیید نیاز دارند و چه کسی تأیید می‌کند. در هر نوع سند، اولین قانونِ فعالِ منطبق (از بالا به پایین) اجرا می‌شود؛ بازه‌های مبلغ بالاتر را بالاتر قرار دهید.
            </p>
          </div>
          <Link href="/workflow/rules/new">
            <Button>
              <Plus className="size-4" aria-hidden="true" />
              افزودن قانون
            </Button>
          </Link>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">در حال بارگذاری قوانین...</p>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 p-10 text-center">
            <p className="text-sm text-destructive" role="alert">
              {loadError}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              تلاش مجدد
            </Button>
          </div>
        ) : (
          grouped.map(({ type, rules: typeRules }) => (
            <Card key={type}>
              <CardHeader>
                <CardTitle className="text-base">
                  قوانین {DOCUMENT_TYPE_LABELS[type]} <span className="text-xs font-normal text-muted-foreground">({typeRules.length.toLocaleString("fa-IR")})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {typeRules.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    قانونی تعریف نشده است؛ {DOCUMENT_TYPE_LABELS[type]} بدون تأیید ثبت می‌شود.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[56rem] text-right text-sm">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-3 font-medium">اولویت</th>
                          <th className="px-3 py-3 font-medium">نام قانون</th>
                          <th className="px-3 py-3 font-medium">شرط</th>
                          <th className="px-3 py-3 font-medium">مراحل تأیید</th>
                          <th className="px-3 py-3 font-medium">وضعیت</th>
                          <th className="px-3 py-3 font-medium">عملیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {typeRules.map((rule, index) => {
                          const scope = scopeSummary(rule, options);
                          const noAccess = rule.steps.flatMap((step) => step.approvers.filter((approver) => !approver.canViewDocument));
                          return (
                            <tr key={rule.id} className={rule.isActive ? "hover:bg-muted/30" : "text-muted-foreground hover:bg-muted/30"}>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1">
                                  <span className="w-5 text-center">{(index + 1).toLocaleString("fa-IR")}</span>
                                  <Button variant="ghost" size="icon" aria-label="انتقال به بالا" disabled={index === 0 || busyId !== null} onClick={() => void move(type, rule.id, -1)}>
                                    <ArrowUp className="size-4" aria-hidden="true" />
                                  </Button>
                                  <Button variant="ghost" size="icon" aria-label="انتقال به پایین" disabled={index === typeRules.length - 1 || busyId !== null} onClick={() => void move(type, rule.id, 1)}>
                                    <ArrowDown className="size-4" aria-hidden="true" />
                                  </Button>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <span className="font-medium">{rule.name}</span>
                                <span className="ms-2 text-xs text-muted-foreground">نسخهٔ {rule.version.toLocaleString("fa-IR")}</span>
                                {noAccess.length > 0 ? (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                                    {noAccess.map((approver) => approver.name).join("، ")} دسترسی مشاهدهٔ این سند را ندارد و نمی‌تواند تأیید کند.
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-xs leading-6">
                                <div>{bandSummary(rule)}</div>
                                {scope.map((line) => (
                                  <div key={line} className="text-muted-foreground">
                                    {line}
                                  </div>
                                ))}
                              </td>
                              <td className="px-3 py-3">
                                <ol className="space-y-0.5 text-xs">
                                  {rule.steps.map((step) => (
                                    <li key={step.id}>
                                      <span className="text-muted-foreground">{step.level.toLocaleString("fa-IR")}.</span> {approverText(step)}
                                    </li>
                                  ))}
                                </ol>
                                {!rule.notifyByLetter ? <p className="mt-1 text-xs text-muted-foreground">بدون اعلان با نامه</p> : null}
                              </td>
                              <td className="px-3 py-3">
                                <StatusBadge label={rule.isActive ? "فعال" : "غیرفعال"} tone={rule.isActive ? "success" : "muted"} />
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-1">
                                  <Link href={`/workflow/rules/${rule.id}/edit`}>
                                    <Button variant="ghost" size="sm">
                                      <Pencil className="size-4" aria-hidden="true" />
                                      ویرایش
                                    </Button>
                                  </Link>
                                  <Button variant="ghost" size="sm" disabled={busyId === rule.id} onClick={() => void toggleActive(rule)}>
                                    {rule.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                                  </Button>
                                  <Button variant="ghost" size="icon" aria-label="حذف قانون" disabled={busyId === rule.id} onClick={() => setDeleting(rule)}>
                                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
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
          ))
        )}

        {options ? <TestBox options={options} /> : null}
      </div>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف قانون</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <p className="text-sm">
              قانون «{deleting?.name}» حذف شود؟ قانونی که قبلاً در یک درخواست تأیید استفاده شده قابل حذف نیست؛ آن را غیرفعال کنید.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="destructive" disabled={busyId !== null} onClick={() => void confirmDelete()}>
              حذف
            </Button>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// «اگر سندی با این مشخصات ثبت شود چه می‌شود؟» — runs the real matching on the
// server against the currently active rules; nothing is saved.
function TestBox({ options }: { options: FormOptions }) {
  const [documentType, setDocumentType] = useState<DocumentType>("PURCHASE");
  const [amountTotal, setAmountTotal] = useState("");
  const [maxLineTotal, setMaxLineTotal] = useState("");
  const [maxUnitPrice, setMaxUnitPrice] = useState("");
  const [maxDiscount, setMaxDiscount] = useState("");
  const [purchaseTypeId, setPurchaseTypeId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const toNumber = (value: string) => (value === "" ? null : Number(value));
      setResult(
        await apiFetch<TestResult>("/workflow/rules/test", {
          method: "POST",
          body: JSON.stringify({
            documentType,
            amountTotal: toNumber(amountTotal),
            maxLineTotal: toNumber(maxLineTotal),
            maxUnitPrice: toNumber(maxUnitPrice),
            maxDiscountPercent: toNumber(maxDiscount),
            purchaseTypeId: toNumber(purchaseTypeId),
            supplierId: toNumber(supplierId),
            requesterDepartmentId: toNumber(departmentId),
          }),
        }),
      );
    } catch (reason) {
      setResult(null);
      setError((reason as ApiError).message ?? "آزمایش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4" aria-hidden="true" />
          آزمایش قوانین
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">مشخصات یک سند فرضی را وارد کنید تا ببینید کدام قانون اجرا می‌شود. چیزی ذخیره نمی‌شود و فقط قوانین فعال بررسی می‌شوند.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-type">نوع سند</Label>
            <select id="test-type" className={selectClass} value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-total">جمع کل (ریال)</Label>
            <MoneyInput id="test-total" value={amountTotal} onChange={setAmountTotal} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-line">بزرگ‌ترین مبلغ یک ردیف (ریال)</Label>
            <MoneyInput id="test-line" value={maxLineTotal} onChange={setMaxLineTotal} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-unit">بزرگ‌ترین قیمت واحد (ریال)</Label>
            <MoneyInput id="test-unit" value={maxUnitPrice} onChange={setMaxUnitPrice} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-discount">بزرگ‌ترین تخفیف یک ردیف (٪) — سفارش فروش</Label>
            <input id="test-discount" dir="ltr" inputMode="decimal" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={maxDiscount} onChange={(event) => setMaxDiscount(event.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-ptype">نوع خرید</Label>
            <select id="test-ptype" className={selectClass} value={purchaseTypeId} onChange={(event) => setPurchaseTypeId(event.target.value)}>
              <option value="">—</option>
              {options.purchaseTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.nameFa}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="test-dept">دپارتمان درخواست‌کننده</Label>
            <select id="test-dept" className={selectClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">—</option>
              {options.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2 md:col-span-3">
            <Label htmlFor="test-supplier">تأمین‌کننده</Label>
            <select id="test-supplier" className={selectClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">—</option>
              {options.suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name} ({supplier.code})
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button onClick={() => void run()} disabled={busy}>
          {busy ? "در حال بررسی..." : "بررسی"}
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : result ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            {result.required ? (
              <>
                <p className="font-medium">نیاز به تأیید دارد — قانون «{result.ruleName}»</p>
                <ol className="mt-2 space-y-0.5 text-xs">
                  {result.levels.map((level) => {
                    const role = options.roles.find((item) => item.name === level.approverLabel);
                    return (
                      <li key={level.level}>
                        {level.level.toLocaleString("fa-IR")}. {role ? `نقش «${roleName(role.name)}»` : level.approverLabel}
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <p className="font-medium">نیاز به تأیید ندارد.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
