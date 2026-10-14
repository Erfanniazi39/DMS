"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { RequiredMark, selectClass, textareaClass } from "@/components/ui/form-field";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAdminUser } from "@/app/admin/layout";
import {
  AMOUNT_BASIS_LABELS,
  DOCUMENT_TYPE_LABELS,
  roleName,
  userName,
  type AmountBasis,
  type ApproverType,
  type DocumentType,
  type FormOptions,
  type WorkflowRule,
} from "../shared";

type Props = { mode: "create" } | { mode: "edit"; ruleId: number };

type StepDraft = { key: number; approverType: ApproverType; roleId: string; userId: string; label: string };

const MAX_STEPS = 5;
let stepKey = 0;
const newStep = (): StepDraft => ({ key: ++stepKey, approverType: "ROLE", roleId: "", userId: "", label: "" });

// Create / edit one approval rule. The document type is fixed once saved. A
// rule's amount band and scope only make sense for some documents: purchase
// requests carry no prices (no amount band), sales orders no purchase type /
// supplier — hidden fields are saved as «any».
export function RuleForm(props: Props) {
  const router = useRouter();
  const user = useAdminUser();
  const canManage = user?.permissions.includes("workflow.manage") ?? false;
  const { toasts, pushError, pushSuccess, dismiss } = useToasts();
  const ruleId = props.mode === "edit" ? props.ruleId : null;

  const [options, setOptions] = useState<FormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("PURCHASE");
  const [isActive, setIsActive] = useState(true);
  const [note, setNote] = useState("");
  const [amountBasis, setAmountBasis] = useState<AmountBasis>("TOTAL");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [minDiscount, setMinDiscount] = useState("");
  const [purchaseTypeId, setPurchaseTypeId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [notifyByLetter, setNotifyByLetter] = useState(true);
  const [steps, setSteps] = useState<StepDraft[]>([newStep()]);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    async function load() {
      try {
        const formOptions = await apiFetch<FormOptions>("/workflow/form-options");
        if (cancelled) return;
        setOptions(formOptions);
        if (ruleId !== null) {
          const rule = await apiFetch<WorkflowRule>(`/workflow/rules/${ruleId}`);
          if (cancelled) return;
          setName(rule.name);
          setDocumentType(rule.documentType);
          setIsActive(rule.isActive);
          setNote(rule.note ?? "");
          setAmountBasis(rule.amountBasis);
          setMinAmount(rule.minAmount ?? "");
          setMaxAmount(rule.maxAmount ?? "");
          setMinDiscount(rule.minDiscountPercent ?? "");
          setPurchaseTypeId(rule.purchaseTypeId === null ? "" : String(rule.purchaseTypeId));
          setSupplierId(rule.supplierId === null ? "" : String(rule.supplierId));
          setDepartmentId(rule.requesterDepartmentId === null ? "" : String(rule.requesterDepartmentId));
          setNotifyByLetter(rule.notifyByLetter);
          setVersion(rule.version);
          setSteps(
            rule.steps.map((step) => ({
              key: ++stepKey,
              approverType: step.approverType,
              roleId: step.roleId === null ? "" : String(step.roleId),
              userId: step.userId === null ? "" : String(step.userId),
              label: step.label ?? "",
            })),
          );
        }
      } catch (reason) {
        if (!cancelled) setLoadError((reason as ApiError).message ?? "دریافت اطلاعات ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canManage, ruleId]);

  const showsAmount = documentType !== "PURCHASE_REQUEST";
  const showsPurchaseScope = documentType !== "SALES_ORDER";
  const showsDiscount = documentType === "SALES_ORDER";

  function updateStep(key: number, patch: Partial<StepDraft>) {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return pushError("نام قانون الزامی است.");
    for (const [index, step] of steps.entries()) {
      if (step.approverType === "ROLE" && !step.roleId) return pushError(`نقش تأییدکنندهٔ مرحلهٔ ${index + 1} را انتخاب کنید.`);
      if (step.approverType === "USER" && !step.userId) return pushError(`کاربر تأییدکنندهٔ مرحلهٔ ${index + 1} را انتخاب کنید.`);
    }
    const userIds = steps.filter((step) => step.approverType === "USER").map((step) => step.userId);
    if (new Set(userIds).size !== userIds.length) return pushError("یک کاربر نمی‌تواند در دو مرحلهٔ یک قانون باشد.");
    if (showsAmount && minAmount !== "" && maxAmount !== "" && Number(minAmount) >= Number(maxAmount)) {
      return pushError("حداکثر مبلغ باید بیشتر از حداقل مبلغ باشد.");
    }

    const toId = (value: string) => (value === "" ? null : Number(value));
    const body = {
      name: name.trim(),
      documentType,
      isActive,
      note: note.trim() || null,
      amountBasis: showsAmount ? amountBasis : "TOTAL",
      minAmount: showsAmount && minAmount !== "" ? Number(minAmount) : null,
      maxAmount: showsAmount && maxAmount !== "" ? Number(maxAmount) : null,
      minDiscountPercent: showsDiscount && minDiscount !== "" ? Number(minDiscount) : null,
      purchaseTypeId: showsPurchaseScope ? toId(purchaseTypeId) : null,
      supplierId: showsPurchaseScope ? toId(supplierId) : null,
      requesterDepartmentId: toId(departmentId),
      notifyByLetter,
      steps: steps.map((step) => ({
        approverType: step.approverType,
        roleId: step.approverType === "ROLE" ? Number(step.roleId) : null,
        userId: step.approverType === "USER" ? Number(step.userId) : null,
        label: step.label.trim() || null,
      })),
    };

    setSaving(true);
    try {
      await apiFetch(ruleId === null ? "/workflow/rules" : `/workflow/rules/${ruleId}`, { method: ruleId === null ? "POST" : "PUT", body: JSON.stringify(body) });
      pushSuccess(ruleId === null ? "قانون ایجاد شد." : "قانون ذخیره شد.");
      router.push("/workflow/rules");
    } catch (reason) {
      pushError((reason as ApiError).message ?? "ذخیرهٔ قانون ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <p className="p-8 text-center text-sm text-muted-foreground">دسترسی به این بخش ندارید.</p>;
  if (loading) return <p className="p-8 text-center text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (loadError || !options) {
    return (
      <p className="p-8 text-center text-sm text-destructive" role="alert">
        {loadError ?? "دریافت اطلاعات ناموفق بود."}
      </p>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <form className="mx-auto max-w-4xl space-y-6" onSubmit={submit} noValidate>
        <div>
          <h1 className="text-2xl font-semibold">{ruleId === null ? "قانون تأیید جدید" : "ویرایش قانون تأیید"}</h1>
          {version !== null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              نسخهٔ {version.toLocaleString("fa-IR")} — ذخیرهٔ تغییرات یک نسخهٔ جدید می‌سازد؛ درخواست‌های تأییدِ در جریان با همان قانونِ زمان ارسال ادامه می‌یابند.
            </p>
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">مشخصات</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-name">
                نام قانون
                <RequiredMark />
              </Label>
              <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً: مواد اولیه بالای ۱۰۰ میلیون" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rule-type">نوع سند</Label>
              <select id="rule-type" className={selectClass} value={documentType} disabled={ruleId !== null} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
                {(Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[]).map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {ruleId !== null ? <p className="text-xs text-muted-foreground">نوع سند پس از ایجاد قانون قابل تغییر نیست.</p> : null}
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="rule-note">توضیح</Label>
              <textarea id="rule-note" className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" className="size-4" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              فعال
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">شرط اجرا</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              قانون فقط وقتی اجرا می‌شود که همهٔ شرط‌های پر‌شده برقرار باشد؛ شرطِ خالی یعنی «هر مورد». اگر هیچ شرطی پر نشود، قانون برای همهٔ {DOCUMENT_TYPE_LABELS[documentType]}‌ها اجرا می‌شود.
            </p>
            {showsAmount ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="rule-basis">مبلغ مبنا</Label>
                  <select id="rule-basis" className={selectClass} value={amountBasis} onChange={(event) => setAmountBasis(event.target.value as AmountBasis)}>
                    {(Object.keys(AMOUNT_BASIS_LABELS) as AmountBasis[]).map((basis) => (
                      <option key={basis} value={basis}>
                        {AMOUNT_BASIS_LABELS[basis]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="rule-min">از مبلغ (ریال، شامل)</Label>
                  <MoneyInput id="rule-min" value={minAmount} onChange={setMinAmount} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="rule-max">تا مبلغ (ریال، غیرشامل)</Label>
                  <MoneyInput id="rule-max" value={maxAmount} onChange={setMaxAmount} />
                </div>
                {amountBasis === "ANY_UNIT_PRICE" ? (
                  <p className="text-xs text-warning md:col-span-3">قیمت واحد به واحد کالا وابسته است (مثلاً کیلو در برابر تن)؛ برای کنترل مطمئن‌تر «جمع کل سند» را انتخاب کنید.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">درخواست خرید مبلغ ندارد؛ شرط مبلغ برای آن در دسترس نیست.</p>
            )}
            {showsDiscount ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="rule-discount">تخفیف (درصد)</Label>
                  <Input id="rule-discount" dir="ltr" inputMode="decimal" value={minDiscount} placeholder="خالی = بدون شرط تخفیف" onChange={(event) => setMinDiscount(event.target.value.replace(/[^0-9.]/g, ""))} />
                  <p className="text-xs text-muted-foreground md:col-span-3">
                    قانون فقط برای سفارشی اجرا می‌شود که در آن تخفیف باشد و بزرگ‌ترین تخفیف یک ردیف دست‌کم این درصد باشد. «۰» یعنی هر تخفیفی. مبلغ تخفیف‌های ریالی به درصدِ همان ردیف تبدیل می‌شود.
                  </p>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              {showsPurchaseScope ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="rule-ptype">نوع خرید</Label>
                    <select id="rule-ptype" className={selectClass} value={purchaseTypeId} onChange={(event) => setPurchaseTypeId(event.target.value)}>
                      <option value="">هر نوع</option>
                      {options.purchaseTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.nameFa}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="rule-supplier">تأمین‌کننده</Label>
                    <select id="rule-supplier" className={selectClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                      <option value="">هر تأمین‌کننده</option>
                      {options.suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name} ({supplier.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-dept">دپارتمان درخواست‌کننده</Label>
                <select id="rule-dept" className={selectClass} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                  <option value="">هر دپارتمان</option>
                  {options.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">مراحل تأیید</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              مراحل به ترتیب اجرا می‌شوند. «نقش» یعنی هر کاربر فعالِ آن نقش می‌تواند تأیید کند (برای جلوگیری از توقف در تعطیلات توصیه می‌شود). درخواست‌دهنده هرگز نمی‌تواند سند خود را تأیید کند و هر کاربر فقط در یک مرحلهٔ هر درخواست تصمیم می‌گیرد.
            </p>
            {steps.map((step, index) => (
              <div key={step.key} className="grid items-end gap-3 rounded-lg border border-border p-3 md:grid-cols-[2rem_9rem_1fr_1fr_auto]">
                <span className="pb-2 text-sm font-medium">{(index + 1).toLocaleString("fa-IR")}.</span>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`step-type-${step.key}`}>تأییدکننده</Label>
                  <select
                    id={`step-type-${step.key}`}
                    className={selectClass}
                    value={step.approverType}
                    onChange={(event) => updateStep(step.key, { approverType: event.target.value as ApproverType })}
                  >
                    <option value="ROLE">یک نقش</option>
                    <option value="USER">یک کاربر مشخص</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`step-who-${step.key}`}>{step.approverType === "ROLE" ? "نقش" : "کاربر"}</Label>
                  {step.approverType === "ROLE" ? (
                    <select id={`step-who-${step.key}`} className={selectClass} value={step.roleId} onChange={(event) => updateStep(step.key, { roleId: event.target.value })}>
                      <option value="">انتخاب نقش</option>
                      {options.roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {roleName(role.name)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select id={`step-who-${step.key}`} className={selectClass} value={step.userId} onChange={(event) => updateStep(step.key, { userId: event.target.value })}>
                      <option value="">انتخاب کاربر</option>
                      {options.users.map((person) => (
                        <option key={person.id} value={person.id}>
                          {userName(person)} ({person.username})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`step-label-${step.key}`}>عنوان نمایشی (اختیاری)</Label>
                  <Input id={`step-label-${step.key}`} value={step.label} onChange={(event) => updateStep(step.key, { label: event.target.value })} placeholder="مثلاً: مدیر مالی" />
                </div>
                <div className="flex items-center gap-1 pb-0.5">
                  <Button type="button" variant="ghost" size="icon" aria-label="انتقال به بالا" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="انتقال به پایین" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="حذف مرحله" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((item) => item.key !== step.key))}>
                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" disabled={steps.length >= MAX_STEPS} onClick={() => setSteps((current) => [...current, newStep()])}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن مرحله
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={notifyByLetter} onChange={(event) => setNotifyByLetter(event.target.checked)} />
              اعلان با نامه (به تأییدکنندگان هر مرحله و در پایان به درخواست‌دهنده)
            </label>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "در حال ذخیره..." : ruleId === null ? "ایجاد قانون" : "ذخیره تغییرات"}
          </Button>
          <Link href="/workflow/rules">
            <Button type="button" variant="outline">
              انصراف
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
