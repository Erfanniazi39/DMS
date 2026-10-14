"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, type ApiError } from "@/lib/api";
import { normalizeDigits } from "@/lib/number-input";
import { isIranCountry, isValidPostalCode } from "@/lib/iran-identifiers";
import {
  CUSTOMER_ADDRESS_TYPES,
  RequiredMark,
  StatusBadge,
  addressTypeLabels,
  selectClass,
  textareaClass,
  type CustomerAddressRow,
  type CustomerAddressType,
  type CustomerDetail,
} from "../../shared";
import { DetailSection, type SectionToasts } from "./DetailSection";
import { SortHeader, useClientTable } from "@/components/ui/sortable";
import { ListPagination } from "@/components/ui/list-pagination";
import type { SortValue } from "@/lib/table-sort";

type AddressForm = {
  addressType: CustomerAddressType;
  label: string;
  province: string;
  city: string;
  addressLine: string;
  postalCode: string;
  country: string;
  cityCode: string;
  locationNumber: string;
  locationName: string;
  phone: string;
  deliveryInstructions: string;
  isDefault: boolean;
  isActive: boolean;
};

const emptyAddressForm: AddressForm = {
  addressType: "DELIVERY",
  label: "",
  province: "",
  city: "",
  addressLine: "",
  postalCode: "",
  country: "",
  cityCode: "",
  locationNumber: "",
  locationName: "",
  phone: "",
  deliveryInstructions: "",
  isDefault: false,
  isActive: true,
};

// Accessors for in-memory column sorting — each sorts by what its column shows.
const CUSTOMERS_ID__SECTIONS_ADDRESSESSECTION_TSX_SORT_GETTERS: Record<string, (row: CustomerAddressRow) => SortValue> = {
  addressType: (row) => addressTypeLabels[row.addressType],
  label: (row) => row.label,
  region: (row) => [row.country, row.province, row.city].filter(Boolean).join(" "),
  addressLine: (row) => row.addressLine,
  postalCode: (row) => row.postalCode,
  isActive: (row) => row.isActive ? "فعال" : "غیرفعال",
};

// «آدرس‌ها» — POST/PATCH/DELETE /customers/:id/addresses[/:addressId]
// (customers.manage). At most one default per address type: setting a new
// default unsets the previous one of that type server-side
// (CustomerAddressesService).
export function AddressesSection({
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
  // Sort + page the (small, already loaded) rows in memory; click a header to sort.
  const table = useClientTable(customer.addresses, CUSTOMERS_ID__SECTIONS_ADDRESSESSECTION_TSX_SORT_GETTERS, { pageSize: 20 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyAddressForm);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof AddressForm>(key: K, value: AddressForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setEditingId(null);
    // Default to "default" when this type has no default yet.
    const hasDeliveryDefault = customer.addresses.some((address) => address.addressType === "DELIVERY" && address.isDefault);
    setForm({ ...emptyAddressForm, isDefault: !hasDeliveryDefault });
    setDialogOpen(true);
  }

  function openEdit(address: CustomerAddressRow) {
    setEditingId(address.id);
    setForm({
      addressType: address.addressType,
      label: address.label ?? "",
      province: address.province ?? "",
      city: address.city ?? "",
      addressLine: address.addressLine,
      postalCode: address.postalCode ?? "",
      country: address.country ?? "",
      cityCode: address.cityCode ?? "",
      locationNumber: address.locationNumber ?? "",
      locationName: address.locationName ?? "",
      phone: address.phone ?? "",
      deliveryInstructions: address.deliveryInstructions ?? "",
      isDefault: address.isDefault,
      isActive: address.isActive,
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.addressLine.trim()) {
      pushError("نشانی الزامی است.");
      return;
    }
    const postalCode = normalizeDigits(form.postalCode).trim();
    if (postalCode && isIranCountry(form.country) && !isValidPostalCode(postalCode)) {
      pushError("کد پستی باید ۱۰ رقم باشد.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(editingId === null ? `/customers/${customer.id}/addresses` : `/customers/${customer.id}/addresses/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH",
        body: JSON.stringify({
          addressType: form.addressType,
          label: form.label.trim(),
          province: form.province.trim(),
          city: form.city.trim(),
          addressLine: form.addressLine.trim(),
          postalCode,
          country: form.country.trim(),
          cityCode: form.cityCode.trim(),
          locationNumber: form.locationNumber.trim(),
          locationName: form.locationName.trim(),
          phone: normalizeDigits(form.phone).trim(),
          deliveryInstructions: form.deliveryInstructions.trim(),
          isDefault: form.isDefault,
          isActive: form.isActive,
        }),
      });
      pushSuccess(editingId === null ? "آدرس اضافه شد." : "آدرس ویرایش شد.");
      setDialogOpen(false);
      await onChanged();
    } catch (reason) {
      const apiError = reason as ApiError;
      if (apiError.messages?.length) pushErrors(apiError.messages);
      else pushError(apiError.message ?? "ذخیره آدرس ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(address: CustomerAddressRow) {
    if (!window.confirm("آیا از حذف این آدرس مطمئن هستید؟")) return;
    try {
      await apiFetch(`/customers/${customer.id}/addresses/${address.id}`, { method: "DELETE" });
      pushSuccess("آدرس حذف شد.");
      await onChanged();
    } catch (reason) {
      pushError((reason as ApiError).message ?? "حذف آدرس ناموفق بود.");
    }
  }

  return (
    <>
      <DetailSection
        title="آدرس‌ها"
        action={
          canManage ? (
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              افزودن آدرس
            </Button>
          ) : undefined
        }
      >
        {customer.addresses.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">هنوز آدرسی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[44rem] text-right text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <SortHeader label="نوع" sortKey="addressType" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="عنوان" sortKey="label" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="کشور / استان / شهر" sortKey="region" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="نشانی" sortKey="addressLine" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="کد پستی" sortKey="postalCode" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  <SortHeader label="وضعیت" sortKey="isActive" sort={table.sort} onSort={table.onSort} className="px-3 py-2 font-medium" />
                  {canManage ? <th className="px-3 py-2 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.pageRows.map((address) => (
                  <tr key={address.id} className={address.isActive ? "" : "text-muted-foreground"}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {addressTypeLabels[address.addressType]}
                      {address.isDefault ? <span className="ms-1.5"><StatusBadge label="پیش‌فرض" tone="primary" /></span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{address.label || "-"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{[address.country, address.province, address.city].filter(Boolean).join(" / ") || "-"}
                      {address.locationName || address.locationNumber ? <span className="block text-xs">محل: {[address.locationNumber, address.locationName].filter(Boolean).join(" - ")}</span> : null}</td>
                    <td className="px-3 py-2">
                      {address.addressLine}
                      {address.deliveryInstructions ? <span className="block text-xs text-muted-foreground">{address.deliveryInstructions}</span> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{address.postalCode || "-"}</span></td>
                    <td className="px-3 py-2">
                      <StatusBadge label={address.isActive ? "فعال" : "غیرفعال"} tone={address.isActive ? "success" : "muted"} />
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(address)}>
                            <Pencil className="size-4" aria-hidden="true" />
                            ویرایش
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void remove(address)}>
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
            {table.total > table.pageSize ? <ListPagination page={table.page} pageSize={table.pageSize} total={table.total} onPageChange={table.setPage} className="mt-3" /> : null}
      </DetailSection>

      <Dialog open={dialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId === null ? "افزودن آدرس" : "ویرایش آدرس"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody>
            <form id="address-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-type">نوع آدرس<RequiredMark /></Label>
                <select id="address-type" className={selectClass} value={form.addressType} onChange={(event) => update("addressType", event.target.value as CustomerAddressType)}>
                  {CUSTOMER_ADDRESS_TYPES.map((type) => (
                    <option key={type} value={type}>{addressTypeLabels[type]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-label">عنوان</Label>
                <Input id="address-label" placeholder="مثلاً انبار مرکزی" value={form.label} onChange={(event) => update("label", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-province">استان</Label>
                <Input id="address-province" value={form.province} onChange={(event) => update("province", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-city">شهر</Label>
                <Input id="address-city" value={form.city} onChange={(event) => update("city", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-country">کشور</Label>
                <Input id="address-country" placeholder="خالی = ایران" value={form.country} onChange={(event) => update("country", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-city-code">کد شهر</Label>
                <Input id="address-city-code" dir="ltr" value={form.cityCode} onChange={(event) => update("cityCode", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-location-number">شماره محل</Label>
                <Input id="address-location-number" dir="ltr" value={form.locationNumber} onChange={(event) => update("locationNumber", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-location-name">نام محل</Label>
                <Input id="address-location-name" value={form.locationName} onChange={(event) => update("locationName", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="address-line">نشانی<RequiredMark /></Label>
                <Input id="address-line" value={form.addressLine} onChange={(event) => update("addressLine", event.target.value)} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-postal-code">کد پستی (۱۰ رقم)</Label>
                <Input id="address-postal-code" dir="ltr" inputMode="numeric" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address-phone">تلفن</Label>
                <Input id="address-phone" dir="ltr" inputMode="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <Label htmlFor="address-instructions">توضیحات تحویل</Label>
                <textarea id="address-instructions" className={textareaClass} value={form.deliveryInstructions} onChange={(event) => update("deliveryInstructions", event.target.value)} />
              </div>
              <label htmlFor="address-default" className="flex items-center gap-2 text-sm">
                <input id="address-default" type="checkbox" className="size-4" checked={form.isDefault} onChange={(event) => update("isDefault", event.target.checked)} />
                آدرس پیش‌فرض این نوع
              </label>
              <label htmlFor="address-active" className="flex items-center gap-2 text-sm">
                <input id="address-active" type="checkbox" className="size-4" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
                فعال
              </label>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" form="address-form" disabled={saving}>
              {saving ? "در حال ذخیره..." : editingId === null ? "افزودن آدرس" : "ذخیره تغییرات"}
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
