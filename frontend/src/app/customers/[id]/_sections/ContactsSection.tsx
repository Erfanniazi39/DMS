"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeDigits } from "@/lib/number-input";
import { RequiredMark, StatusBadge, textareaClass, type CustomerContactRow, type CustomerDetail } from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";

type ContactForm = { name: string; roleTitle: string; mobile: string; phone: string; email: string; isPrimary: boolean; isActive: boolean; note: string };

const emptyContactForm: ContactForm = { name: "", roleTitle: "", mobile: "", phone: "", email: "", isPrimary: false, isActive: true, note: "" };

// «مخاطبین» — POST/PATCH/DELETE /customers/:id/contacts[/:contactId]
// (customers.manage). Marking a contact primary unsets the previous primary
// server-side (CustomerContactsService).
export function ContactsSection({
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyContactForm);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    // The first contact defaults to primary.
    setForm({ ...emptyContactForm, isPrimary: customer.contacts.length === 0 });
    setDialogOpen(true);
  }

  function openEdit(contact: CustomerContactRow) {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      roleTitle: contact.roleTitle ?? "",
      mobile: contact.mobile ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      isPrimary: contact.isPrimary,
      isActive: contact.isActive,
      note: contact.note ?? "",
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      pushError("نام مخاطب الزامی است.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editingId === null ? `/customers/${customer.id}/contacts` : `/customers/${customer.id}/contacts/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          name: form.name.trim(),
          roleTitle: form.roleTitle.trim(),
          mobile: normalizeDigits(form.mobile).trim(),
          phone: normalizeDigits(form.phone).trim(),
          email: form.email.trim(),
          isPrimary: form.isPrimary,
          isActive: form.isActive,
          note: form.note.trim(),
        }),
      });
      pushSuccess(editingId === null ? "مخاطب اضافه شد." : "مخاطب ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره مخاطب ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(contact: CustomerContactRow) {
    if (!window.confirm(`آیا از حذف مخاطب «${contact.name}» مطمئن هستید؟`)) return;
    try {
      await apiFetch(`/customers/${customer.id}/contacts/${contact.id}`, { method: "DELETE" });
      pushSuccess("مخاطب حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف مخاطب ناموفق بود.");
    }
  }

  return (
    <>
      <DetailSection
        title="مخاطبین"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن مخاطب
            </Button>
          ) : undefined
        }
      >
        {customer.contacts.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز مخاطبی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[40rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">نام</th>
                  <th className="px-3 py-2 font-medium">سمت</th>
                  <th className="px-3 py-2 font-medium">موبایل</th>
                  <th className="px-3 py-2 font-medium">تلفن</th>
                  <th className="px-3 py-2 font-medium">ایمیل</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.contacts.map((contact) => (
                  <tr key={contact.id} className={contact.isActive ? "" : "text-muted-foreground"}>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        {contact.isPrimary ? <Star className="size-3.5 fill-current text-warning" aria-label="مخاطب اصلی" /> : null}
                        {contact.name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{contact.roleTitle || "-"}</td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr"><span className="block text-right">{contact.mobile || "-"}</span></td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr"><span className="block text-right">{contact.phone || "-"}</span></td>
                    <td className="px-3 py-2" dir="ltr"><span className="block text-right">{contact.email || "-"}</span></td>
                    <td className="px-3 py-2">
                      <StatusBadge label={contact.isActive ? "فعال" : "غیرفعال"} tone={contact.isActive ? "success" : "muted"} />
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(contact)}>
                            <Pencil className="size-4" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(contact)}>
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
            <DialogTitle>{editingId === null ? "افزودن مخاطب" : "ویرایش مخاطب"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="contact-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-name">نام<RequiredMark /></Label>
                <Input id="contact-name" value={form.name} onChange={(event) => update("name", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-role">سمت</Label>
                <Input id="contact-role" value={form.roleTitle} onChange={(event) => update("roleTitle", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-mobile">موبایل</Label>
                <Input id="contact-mobile" dir="ltr" inputMode="tel" value={form.mobile} onChange={(event) => update("mobile", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact-phone">تلفن</Label>
                <Input id="contact-phone" dir="ltr" inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="contact-email">ایمیل</Label>
                <Input id="contact-email" dir="ltr" type="email" value={form.email} onChange={(event) => update("email", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="contact-note">یادداشت</Label>
                <textarea id="contact-note" className={textareaClass} value={form.note} onChange={(event) => update("note", event.target.value)} />
              </div>
              <label htmlFor="contact-primary" className="flex items-center gap-2 text-sm">
                <input id="contact-primary" type="checkbox" className="size-4" checked={form.isPrimary} onChange={(event) => update("isPrimary", event.target.checked)} />
                مخاطب اصلی
              </label>
              <label htmlFor="contact-active" className="flex items-center gap-2 text-sm">
                <input id="contact-active" type="checkbox" className="size-4" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
                فعال
              </label>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="contact-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId === null ? "افزودن مخاطب" : "ذخیره تغییرات"}
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
