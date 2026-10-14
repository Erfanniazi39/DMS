"use client";

import { useMemo } from "react";

export type PickerPermission = { code: string; label: string; module: string };

// A checkbox whose "some but not all" state shows as indeterminate.
function TriCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate;
      }}
      onChange={onChange}
    />
  );
}

// Compact permission chooser: one small box per module (several per row) with
// a select-all box for the module, plus one select-all for everything.
// Controlled — `selected` holds permission codes, `onChange` receives the new
// full list. Only the permissions passed in are affected by the select-alls.
export function PermissionPicker({ permissions, selected, onChange, disabled }: { permissions: PickerPermission[]; selected: string[]; onChange: (codes: string[]) => void; disabled?: boolean }) {
  const groups = useMemo(() => {
    const map = new Map<string, PickerPermission[]>();
    for (const permission of permissions) map.set(permission.module, [...(map.get(permission.module) ?? []), permission]);
    return [...map.entries()];
  }, [permissions]);
  const selectedSet = new Set(selected);
  const allCodes = permissions.map((permission) => permission.code);
  const selectedCount = allCodes.filter((code) => selectedSet.has(code)).length;

  function setCodes(codes: string[], on: boolean) {
    const next = new Set(selected);
    for (const code of codes) {
      if (on) next.add(code);
      else next.delete(code);
    }
    onChange([...next]);
  }

  return (
    <div className={`space-y-3 ${disabled ? "pointer-events-none opacity-60" : ""}`}>
      <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium">
        <TriCheckbox
          label="انتخاب همه دسترسی‌ها"
          checked={allCodes.length > 0 && selectedCount === allCodes.length}
          indeterminate={selectedCount > 0 && selectedCount < allCodes.length}
          onChange={() => setCodes(allCodes, selectedCount !== allCodes.length)}
        />
        انتخاب همه دسترسی‌ها
        <span className="ms-auto text-xs font-normal text-muted-foreground">{selectedCount.toLocaleString("fa-IR")} از {allCodes.length.toLocaleString("fa-IR")}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map(([module, items]) => {
          const codes = items.map((item) => item.code);
          const count = codes.filter((code) => selectedSet.has(code)).length;
          return (
            <fieldset key={module} className="rounded-md border border-border">
              <legend className="sr-only">{module}</legend>
              <label className="flex items-center gap-2 border-b border-border bg-muted/30 px-2.5 py-1.5 text-sm font-medium">
                <TriCheckbox label={`انتخاب همه ${module}`} checked={count === codes.length} indeterminate={count > 0 && count < codes.length} onChange={() => setCodes(codes, count !== codes.length)} />
                {module}
                <span className="ms-auto text-xs font-normal text-muted-foreground">{count.toLocaleString("fa-IR")}/{codes.length.toLocaleString("fa-IR")}</span>
              </label>
              <div className="p-1">
                {items.map((permission) => (
                  <label key={permission.code} title={permission.code} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
                    <input type="checkbox" checked={selectedSet.has(permission.code)} onChange={() => setCodes([permission.code], !selectedSet.has(permission.code))} />
                    {permission.label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
