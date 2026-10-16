// Sidebar navigation data for the app shell (AppShell.tsx). Pure data —
// adding a page's nav entry is a one-line edit here. Everything the sidebar
// shows comes from this file, including settings and «مدیریت سیستم».
//
// Shape: groups (an optional small heading) → items (a top-level row with an
// icon) → links (plain text rows inside an expandable item). Only ONE item is
// open at a time; the item holding the current page opens by itself.
//
// Visibility: an item needs its own `permission` (if any) and `feature` (if
// any); an expandable item is shown only when at least one of its links is.
// A link needs its own `permission`/`feature` on top of the item's.
// `hidden` links are never drawn — they only tell the route guard what a page
// reached by its list page's button needs (e.g. /purchases/new needs
// purchases.manage). Create («ثبت …») and historical-entry pages live behind
// their list pages' buttons, not in the sidebar.
// `section` starts a small divider label before that link (used only where an
// item really has two kinds of links, e.g. daily inventory work vs. setup).

import {
  BarChart3,
  ClipboardCheck,
  Database,
  LayoutDashboard,
  Mail,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { FeatureFlag } from "@/lib/session";

export type NavLink = { label: string; href: string; permission?: string; feature?: FeatureFlag; hidden?: boolean; section?: string };

export type NavBadge = "letters" | "approvals";

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  // A leaf item navigates here; an expandable item has `links` instead.
  href?: string;
  permission?: string;
  feature?: FeatureFlag;
  badge?: NavBadge;
  links?: NavLink[];
};

// `pinned` groups sit at the bottom of the sidebar, outside the scroll area.
export type NavGroup = { label?: string; pinned?: boolean; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    items: [
      { key: "dashboard", label: "داشبورد", icon: LayoutDashboard, href: "/main" },
      // Approvals inbox (every role) — hidden until the workflowApprovals flag is on.
      { key: "approvals", label: "کارتابل تأییدها", icon: ClipboardCheck, href: "/workflow/inbox", permission: "workflow.inbox", feature: "workflowApprovals", badge: "approvals" },
      // نامه‌نگاری — every role holds letters.use; what a user sees is decided per letter on the backend.
      {
        key: "letters",
        label: "نامه‌ها",
        icon: Mail,
        permission: "letters.use",
        badge: "letters",
        links: [
          { label: "صندوق دریافت", href: "/letters" },
          { label: "نامه جدید", href: "/letters/new" },
          { label: "ارسال‌شده", href: "/letters/sent" },
          { label: "پیش‌نویس‌ها", href: "/letters/drafts" },
          { label: "بایگانی", href: "/letters/archive" },
          // Management oversight (letters.readAll): read-only, every view audited.
          { label: "همهٔ نامه‌ها (نظارت)", href: "/letters/all", permission: "letters.readAll" },
        ],
      },
    ],
  },
  {
    label: "عملیات",
    items: [
      // Deliveries / invoices / returns are viewable with sales.view; their
      // create/post actions are gated on the pages' own buttons.
      {
        key: "sales",
        label: "فروش",
        icon: Receipt,
        permission: "sales.view",
        links: [
          { label: "سفارش‌های فروش", href: "/sales-orders" },
          { label: "تحویل‌ها", href: "/deliveries" },
          { label: "فاکتورها", href: "/sales-invoices" },
          { label: "مرجوعی‌ها", href: "/sales-returns" },
          { label: "ثبت سفارش فروش", href: "/sales-orders/new", permission: "sales.manage", hidden: true },
          { label: "ثبت فروش تاریخی", href: "/sales-orders/historical", permission: "sales.manage", hidden: true },
        ],
      },
      {
        key: "purchases",
        label: "خرید",
        icon: ShoppingCart,
        permission: "purchases.view",
        links: [
          { label: "درخواست‌های خرید", href: "/purchase-requests" },
          { label: "خریدها", href: "/purchases" },
          { label: "ثبت درخواست خرید", href: "/purchase-requests/new", permission: "purchases.manage", hidden: true },
          { label: "ثبت خرید", href: "/purchases/new", permission: "purchases.manage", hidden: true },
          { label: "ثبت خرید تاریخی", href: "/purchases/historical", permission: "purchases.manage", hidden: true },
        ],
      },
      // Viewable with inventory.view; create/post/QC actions need finer
      // permissions, enforced on the pages. Transfers are out of v1 scope.
      {
        key: "inventory",
        label: "انبار",
        icon: Warehouse,
        permission: "inventory.view",
        links: [
          { label: "موجودی کالا", href: "/inventory" },
          { label: "رسید انبار", href: "/inventory/receipts" },
          { label: "رسید تولید", href: "/inventory/production" },
          { label: "اصلاح موجودی", href: "/inventory/adjustments" },
          { label: "شمارش موجودی", href: "/inventory/counts", feature: "inventoryStockCounts" },
          { label: "دفتر گردش کالا", href: "/inventory/movements" },
          { label: "انبارها", href: "/inventory/locations", section: "تنظیم انبار" },
          { label: "آستانه‌های موجودی", href: "/inventory/stock-levels", permission: "inventory.manage" },
          { label: "تنظیمات بچ و انقضا", href: "/inventory/item-settings", permission: "inventory.manage", feature: "inventoryBatchTracking" },
          { label: "یکپارچگی موجودی", href: "/inventory/integrity", permission: "inventory.manage" },
        ],
      },
      // Receivables — a sibling of sales, not nested under it: the person
      // collecting money isn't necessarily the person selling (B5).
      { key: "receipts", label: "دریافت‌ها", icon: Wallet, href: "/receipts", permission: "receivables.view" },
    ],
  },
  {
    label: "اطلاعات و گزارش",
    items: [
      {
        key: "master-data",
        label: "اطلاعات پایه",
        icon: Database,
        links: [
          { label: "مشتریان", href: "/customers", permission: "customers.view" },
          { label: "گروه‌های مشتری", href: "/customer-groups", permission: "customers.view" },
          { label: "مناطق فروش", href: "/territories", permission: "customers.view", feature: "customerTerritories" },
          { label: "شرایط پرداخت", href: "/payment-terms", permission: "customers.view", feature: "paymentTerms" },
          { label: "تأمین‌کنندگان", href: "/suppliers", permission: "suppliers.view" },
          { label: "کالاها", href: "/items", permission: "items.view" },
          { label: "دسته‌بندی کالاها", href: "/item-categories", permission: "items.view" },
          { label: "کارکنان", href: "/employees", permission: "employees.view" },
          { label: "دپارتمان‌ها", href: "/departments", permission: "employees.manage" },
          { label: "ثبت مشتری", href: "/customers/new", permission: "customers.manage", hidden: true },
        ],
      },
      {
        key: "reports",
        label: "گزارش‌ها",
        icon: BarChart3,
        links: [
          { label: "گزارش‌های فروش", href: "/sales-reports", permission: "sales.view" },
          { label: "سالمندی مطالبات", href: "/receivables/aging", permission: "receivables.view" },
          { label: "کمبود موجودی", href: "/inventory/reports/low-stock", permission: "inventory.view" },
          { label: "انقضای بچ‌ها", href: "/inventory/reports/expiry", permission: "inventory.view", feature: "inventoryBatchTracking" },
        ],
      },
    ],
  },
  {
    pinned: true,
    items: [
      // Company-wide settings that are not admin-only.
      {
        key: "settings",
        label: "تنظیمات",
        icon: Settings,
        links: [
          { label: "مشخصات شرکت", href: "/settings/company", permission: "company.manage" },
          { label: "قالب شماره‌گذاری", href: "/settings/numbering", permission: "numbering.manage" },
          // Approval rules (admin-only, workflow.manage) — hidden until the workflowApprovals flag is on.
          { label: "قوانین تأیید", href: "/workflow/rules", permission: "workflow.manage", feature: "workflowApprovals" },
          { label: "واحدهای اندازه‌گیری", href: "/units", permission: "purchases.manage" },
        ],
      },
      {
        key: "system",
        label: "مدیریت سیستم",
        icon: ShieldCheck,
        links: [
          { label: "کاربران", href: "/admin/users", permission: "users.create" },
          { label: "افزودن کاربر", href: "/admin/add-users", permission: "users.create" },
          { label: "فعالیت کاربران", href: "/admin/user-activity", permission: "users.create" },
          { label: "سندهای حذف‌شده", href: "/admin/deleted-records", permission: "users.create" },
          { label: "نقش‌ها و دسترسی‌ها", href: "/admin/roles", permission: "users.create" },
          { label: "پشتیبان‌گیری", href: "/admin/backup", permission: "backup.manage" },
        ],
      },
    ],
  },
];

export const underPath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// Admin pages reached from inside other admin pages (not sidebar links).
const EXTRA_ROUTE_PERMISSIONS: [string, string][] = [
  ["/admin/permissions", "users.create"],
  ["/admin/user-permissions", "users.create"],
];

type Session = { permissions: string[]; features?: Partial<Record<FeatureFlag, boolean>> };

const allowed = (session: Session, permission?: string, feature?: FeatureFlag) =>
  (!permission || session.permissions.includes(permission)) && (!feature || Boolean(session.features?.[feature]));

/** The sidebar as this user may see it: hidden links dropped, empty items and groups removed. */
export function visibleNav(session: Session): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => allowed(session, item.permission, item.feature))
        .map((item) => (item.links ? { ...item, links: item.links.filter((link) => !link.hidden && allowed(session, link.permission, link.feature)) } : item))
        .filter((item) => !item.links || item.links.length > 0),
    }))
    .filter((group) => group.items.length > 0);
}

/** The one sidebar entry (leaf item or link) the current page belongs to: the longest matching href. */
export function activeHref(groups: NavGroup[], pathname: string): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      for (const href of item.links ? item.links.map((link) => link.href) : item.href ? [item.href] : []) {
        if (underPath(pathname, href) && (!best || href.length > best.length)) best = href;
      }
    }
  }
  return best;
}

// Every permission a route needs, derived from the same nav data that hides
// menu entries — so a URL typed by hand is blocked exactly where the link is
// hidden. The most specific (longest) matching href decides. UX only: the
// backend re-checks each request (SessionAuthGuard + @RequirePermissions).
// Unknown routes need nothing here (and 404 or redirect on their own).
export function requiredPermissionsFor(pathname: string): string[] {
  let best: { length: number; required: string[] } | null = null;
  const consider = (href: string, required: (string | undefined)[]) => {
    if (underPath(pathname, href) && (!best || href.length > best.length)) best = { length: href.length, required: required.filter((p): p is string => Boolean(p)) };
  };
  for (const [prefix, permission] of EXTRA_ROUTE_PERMISSIONS) consider(prefix, [permission]);
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href) consider(item.href, [item.permission]);
      for (const link of item.links ?? []) consider(link.href, [item.permission, link.permission]);
    }
  }
  return (best as { required: string[] } | null)?.required ?? [];
}
