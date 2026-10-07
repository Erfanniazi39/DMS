"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { formatJalali } from "@/lib/jalali";
import { todayIso } from "@/lib/format";
import { apiFetch, type ApiError } from "@/lib/api";
import {
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  RequiredMark,
  StatusBadge,
  complaintSeverityLabels,
  complaintSeverityTone,
  complaintStatusLabels,
  complaintStatusTone,
  selectClass,
  textareaClass,
  type ComplaintSeverity,
  type ComplaintStatus,
  type CustomerComplaintRow,
  type CustomerDetail,
  type UserOption,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

type ComplaintForm = {
  date: string;
  category: string;
  description: string;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  resolution: string;
  ownerUserId: string;
};

const emptyComplaintForm: ComplaintForm = { date: "", category: "", description: "", severity: "MEDIUM", status: "OPEN", resolution: "", ownerUserId: "" };

// «شکایات» — minimal complaint/issue register (business decision 8):
// POST/PATCH/DELETE /customers/:id/complaints[/:complaintId]
// (customers.manage; reading is part of GET /customers/:id). Status is a
// plain field the user sets — no workflow. Edits send updatedAt (optimistic
// lock). The owner picker reads GET /customers/assignable-users.
export function ComplaintsSection({
  customer,
  canManage,
  onChanged,
  toasts,
}: {
  customer: CustomerDetail;
  canManage: boolean;
  onChanged: () => Promise<void>;
  toasts: SectionToasts;
}) {
  const { pushError, pushErrors, pushSuccess } = toasts;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerComplaintRow | null>(null);
  const [form, setForm] = useState<ComplaintForm>(emptyComplaintForm);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    if (!canManage) return;
    let ignore = false;
    apiFetch<UserOption[]>("/customers/assignable-users")
      .then((data) => {
        if (!ignore) setUsers(data);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [canManage]);

  function update<K extends keyof ComplaintForm>(key: K, value: ComplaintForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyComplaintForm, date: todayIso() });
    setDialogOpen(true);
  }

  function openEdit(complaint: CustomerComplaintRow) {
    setEditing(complaint);
    setForm({
      date: complaint.date.slice(0, 10),
      category: complaint.category,
      description: complaint.description,
      severity: complaint.severity,
      status: complaint.status,
      resolution: complaint.resolution ?? "",
      ownerUserId: complaint.ownerUserId ? String(complaint.ownerUserId) : "",
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.date || !form.category.trim() || !form.description.trim()) {
      pushError("تاریخ، دسته‌بندی و شرح شکایت الزامی است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editing === null ? `/customers/${customer.id}/complaints` : `/customers/${customer.id}/complaints/${editing.id}`, {
        method: editing === null ? "POST" : "PATCH",
        body: JSON.stringify({
          date: form.date,
          category: form.category.trim(),
          description: form.description.trim(),
          severity: form.severity,
          status: form.status,
          resolution: form.resolution.trim(),
          ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,
          ...(editing ? { updatedAt: editing.updatedAt } : {}),
        }),
      });
      pushSuccess(editing === null ? "شکایت ثبت شد." : "شکایت ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.code === "RECORD_MODIFIED") {
        // Reload so the next edit starts from the current version.
        setDialogOpen(false);
        await onChanged();
      }
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره شکایت ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(complaint: CustomerComplaintRow) {
    if (!window.confirm("آیا از حذف این شکایت مطمئن هستید؟")) return;
    try {
      await apiFetch(`/customers/${customer.id}/complaints/${complaint.id}`, { method: "DELETE" });
      pushSuccess("شکایت حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف شکایت ناموفق بود.");
    }
  }

  // The current owner stays selectable even if no longer in the active list.
  const ownerOptions =
    editing?.ownerUser && !users.some((user) => user.id === editing.ownerUser?.id) ? [...users, editing.ownerUser] : users;

  return (
    <>
      <DetailSection
        title="شکایات و مسائل"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              ثبت شکایت
            </Button>
          ) : undefined
        }
      >
        {customer.complaints.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">شکایتی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[48rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">تاریخ</th>
                  <th className="px-3 py-2 font-medium">دسته‌بندی</th>
                  <th className="px-3 py-2 font-medium">شرح</th>
                  <th className="px-3 py-2 font-medium">شدت</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                  <th className="px-3 py-2 font-medium">مسئول پیگیری</th>
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.complaints.map((complaint) => (
                  <tr key={complaint.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatJalali(complaint.date)}</td>
                    <td className="px-3 py-2">{complaint.category}</td>
                    <td className="max-w-xs px-3 py-2">
                      <span className="line-clamp-2">{complaint.description}</span>
                      {complaint.resolution ? <span className="mt-0.5 block text-xs text-muted-foreground">راه‌حل: {complaint.resolution}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={complaintSeverityLabels[complaint.severity]} tone={complaintSeverityTone[complaint.severity]} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={complaintStatusLabels[complaint.status]} tone={complaintStatusTone[complaint.status]} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{complaint.ownerUser?.username ?? "-"}</td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(complaint)}>
                            <Pencil className="size-4" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(complaint)}>
                            <Trash2 className="size-4" aria-hidden="true" />
                            حذف
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === null ? "ثبت شکایت" : "ویرایش شکایت"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="complaint-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="complaint-date-year">تاریخ<RequiredMark /></Label>
                <JalaliDateInput idPrefix="complaint-date" value={form.date} onChange={(value) => update("date", value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="complaint-category">دسته‌بندی<RequiredMark /></Label>
                <Input id="complaint-category" placeholder="مثلاً کیفیت کالا، تأخیر تحویل" value={form.category} onChange={(event) => update("category", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="complaint-description">شرح<RequiredMark /></Label>
                <textarea id="complaint-description" className={`${textareaClass} min-h-24`} value={form.description} onChange={(event) => update("description", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="complaint-severity">شدت</Label>
                <select id="complaint-severity" className={selectClass} value={form.severity} onChange={(event) => update("severity", event.target.value as ComplaintSeverity)}>
                  {COMPLAINT_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>{complaintSeverityLabels[severity]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="complaint-status">وضعیت</Label>
                <select id="complaint-status" className={selectClass} value={form.status} onChange={(event) => update("status", event.target.value as ComplaintStatus)}>
                  {COMPLAINT_STATUSES.map((status) => (
                    <option key={status} value={status}>{complaintStatusLabels[status]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="complaint-owner">مسئول پیگیری</Label>
                <select id="complaint-owner" className={selectClass} value={form.ownerUserId} onChange={(event) => update("ownerUserId", event.target.value)}>
                  <option value="">تعیین نشده</option>
                  {ownerOptions.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="complaint-resolution">راه‌حل / نتیجه</Label>
                <textarea id="complaint-resolution" className={textareaClass} value={form.resolution} onChange={(event) => update("resolution", event.target.value)} />
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="complaint-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editing === null ? "ثبت شکایت" : "ذخیره تغییرات"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
