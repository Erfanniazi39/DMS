// Single source of truth for Persian role-name labels shown across the
// Users & Access screens. Role names are the seeded `Role.name` values;
// anything not listed here (e.g. a custom role) falls back to its raw name.
export type RoleName = "ADMIN" | "DATA_OPERATOR" | "PURCHASE_MANAGER" | "SALES_MANAGER" | "VIEWER" | "SALESPERSON" | "WAREHOUSE" | "ACCOUNTANT";

export const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: "مدیر سیستم",
  DATA_OPERATOR: "اپراتور داده",
  PURCHASE_MANAGER: "مسئول خرید",
  SALES_MANAGER: "مسئول فروش",
  VIEWER: "مشاهده‌گر",
  // Sales batch 1 (2026-10-06).
  SALESPERSON: "فروشنده",
  WAREHOUSE: "انباردار",
  ACCOUNTANT: "حسابدار",
};

export function roleLabel(name: string): string {
  return (ROLE_LABELS as Record<string, string>)[name] ?? name;
}
