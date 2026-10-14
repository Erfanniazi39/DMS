// Sidebar navigation data for the app shell (AppShell.tsx). Pure data —
// adding a module's nav entry is a one-line edit here. The dashboard link,
// reports link, and the "مدیریت سیستم" (system administration) menu are
// rendered directly by AppShell, not from this list.

import {
  BarChart3,
  Boxes,
  Building,
  Building2,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  Archive,
  Eye,
  Inbox,
  Mail,
  PencilLine,
  Send,
  Factory,
  FilePlus2,
  FileText,
  HandCoins,
  Layers,
  LineChart,
  MapPin,
  Package,
  PackageCheck,
  PackagePlus,
  Plus,
  History,
  Receipt,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Tags,
  TrendingDown,
  Truck,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { FeatureFlag } from "@/lib/session";

// `permission` on a child is checked in addition to the parent's — used to
// hide create routes from users who can only view (e.g. purchases.view
// without purchases.manage).
// `sectionLabel` groups children that belong to the same sub-concept (e.g.
// "خرید" vs "درخواست خرید" both living under the single "خرید" parent) —
// consecutive children sharing a `sectionLabel` are boxed together with a
// subtly shaded background and a small heading (see `groupChildren` in
// AppShell.tsx).
// `feature` hides a child while that v1 feature flag is off (lib/session.tsx).
export type NavChild = { label: string; href: string; permission?: string; feature?: FeatureFlag; icon?: LucideIcon; sectionLabel?: string };

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: string;
  // Optional sub-items — rendered as a collapsible group (same pattern as
  // "مدیریت سیستم") instead of navigating directly on click.
  children?: NavChild[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    // نامه‌نگاری — internal letters between system users. Every role holds
    // letters.use; what a user sees is decided per letter on the backend.
    label: "ارتباطات",
    items: [
      {
        label: "نامه‌ها",
        href: "/letters",
        icon: Mail,
        permission: "letters.use",
        children: [
          { label: "نامه جدید", href: "/letters/new", icon: Plus },
          { label: "صندوق دریافت", href: "/letters", icon: Inbox },
          { label: "ارسال‌شده", href: "/letters/sent", icon: Send },
          { label: "پیش‌نویس‌ها", href: "/letters/drafts", icon: PencilLine },
          { label: "بایگانی", href: "/letters/archive", icon: Archive },
          // Management oversight (letters.readAll): read-only, every view audited.
          { label: "همهٔ نامه‌ها (نظارت)", href: "/letters/all", permission: "letters.readAll", icon: Eye },
        ],
      },
    ],
  },
  {
    label: "تراکنش‌ها",
    items: [
      {
        label: "خرید",
        href: "/purchases",
        icon: ShoppingCart,
        permission: "purchases.view",
        children: [
          { label: "ثبت خرید", href: "/purchases/new", permission: "purchases.manage", icon: Plus, sectionLabel: "خرید" },
          { label: "ثبت خرید تاریخی", href: "/purchases/historical", permission: "purchases.manage", icon: History, sectionLabel: "خرید" },
          { label: "خریدها", href: "/purchases", icon: ShoppingBag, sectionLabel: "خرید" },
          { label: "ثبت درخواست خرید", href: "/purchase-requests/new", permission: "purchases.manage", icon: FilePlus2, sectionLabel: "درخواست خرید" },
          { label: "درخواست‌های خرید", href: "/purchase-requests", icon: ClipboardList, sectionLabel: "درخواست خرید" },
        ],
      },
      // Sales (batch 2: orders, batch 3: deliveries, batch 4: invoices).
      // Returns join this parent when their batch lands, under its own
      // sectionLabel. Invoices are viewable with sales.view; creating /
      // posting one needs sales.invoice, enforced on the page's buttons
      // (an invoice is always started from a posted delivery). Deliveries
      // are viewable with sales.view (the parent's gate); creating/posting
      // one needs sales.deliver, enforced on the page's buttons (no separate
      // create route — a delivery is always started from an order in the
      // queue).
      {
        label: "فروش",
        href: "/sales-orders",
        icon: Receipt,
        permission: "sales.view",
        children: [
          { label: "سفارش‌های فروش", href: "/sales-orders", icon: ScrollText, sectionLabel: "سفارش فروش" },
          { label: "ثبت سفارش فروش", href: "/sales-orders/new", permission: "sales.manage", icon: Plus, sectionLabel: "سفارش فروش" },
          { label: "ثبت فروش تاریخی", href: "/sales-orders/historical", permission: "sales.manage", icon: History, sectionLabel: "سفارش فروش" },
          { label: "تحویل‌ها", href: "/deliveries", icon: PackageCheck, sectionLabel: "تحویل" },
          { label: "فاکتورها", href: "/sales-invoices", icon: FileText, sectionLabel: "فاکتور" },
          { label: "مرجوعی‌ها", href: "/sales-returns", icon: RotateCcw, sectionLabel: "مرجوعی" },
          // Reports (Sales batch 7) — backlog, by item/customer, daily trend.
          { label: "گزارش‌های فروش", href: "/sales-reports", icon: LineChart, sectionLabel: "گزارش" },
        ],
      },
      // Inventory (Sales batch 1; movements/integrity added I1; stock
      // levels + low-stock report added I3; goods receipts + production
      // output added I5 — viewable with inventory.view, the parent's gate;
      // create/post/QC release need inventory.receive, enforced on the pages).
      {
        label: "موجودی",
        href: "/inventory",
        icon: Warehouse,
        permission: "inventory.view",
        children: [
          { label: "لیست موجودی", href: "/inventory", icon: Boxes },
          { label: "رسید انبار", href: "/inventory/receipts", icon: PackagePlus },
          { label: "رسید تولید", href: "/inventory/production", icon: Factory },
          { label: "اصلاح موجودی", href: "/inventory/adjustments", icon: ClipboardPen },
          // I6 — create/edit/start/enter-count/submit/cancel need
          // inventory.count; approve/request-recount need inventory.approve;
          // gated here only on inventory.view (the parent's gate), same as
          // every other inventory child — the page's own buttons gate further.
          { label: "شمارش موجودی", href: "/inventory/counts", feature: "inventoryStockCounts", icon: ClipboardCheck },
          { label: "دفتر گردش کالا", href: "/inventory/movements", icon: ScrollText },
          // Read-only report — inventory.view (the parent's own gate) is
          // enough; editing the thresholds it's based on needs inventory.manage.
          { label: "گزارش کمبود موجودی", href: "/inventory/reports/low-stock", icon: TrendingDown },
          // I4 — read-only, inventory.view like the low-stock report.
          { label: "گزارش انقضای بچ‌ها", href: "/inventory/reports/expiry", feature: "inventoryBatchTracking", icon: CalendarClock },
          // Admin-level inventory configuration (I3) — never WAREHOUSE/SALES_MANAGER.
          { label: "آستانه‌های موجودی", href: "/inventory/stock-levels", permission: "inventory.manage", icon: SlidersHorizontal },
          // I4 — per-item batch/expiry configuration, inventory.manage only.
          { label: "تنظیمات بچ و انقضا", href: "/inventory/item-settings", permission: "inventory.manage", feature: "inventoryBatchTracking", icon: Layers },
          // I7's location-admin slice only — transfers are explicitly out of
          // scope. Listing needs only inventory.view (same as every other
          // inventory child); the page's own "افزودن/ویرایش" buttons gate on
          // inventory.manage.
          { label: "انبارها", href: "/inventory/locations", icon: Building },
          // Admin-only diagnostic — moved from inventory.adjust (I1's stand-in)
          // to inventory.manage (I3) now that it exists in the permission catalog.
          { label: "یکپارچگی موجودی", href: "/inventory/integrity", permission: "inventory.manage", icon: ShieldCheck },
        ],
      },
      // Receivables (Sales batch 5) — a sibling of "فروش", not nested under
      // it (build plan §7's nav note): the person collecting money isn't
      // necessarily the person selling (separation of duties, B5).
      {
        label: "دریافت‌ها",
        href: "/receipts",
        icon: Wallet,
        permission: "receivables.view",
        children: [
          { label: "دریافت‌ها", href: "/receipts", icon: HandCoins },
          { label: "سالمندی مطالبات", href: "/receivables/aging", icon: BarChart3 },
        ],
      },
    ],
  },
  {
    label: "اطلاعات پایه",
    items: [
      { label: "تأمین‌کنندگان", href: "/suppliers", icon: Truck, permission: "suppliers.view" },
      // Gated on customers.view (was customers.manage, which hid the list
      // from view-only users even though the page itself accepts
      // customers.view). Create stays customers.manage.
      {
        label: "مشتریان",
        href: "/customers",
        icon: Users,
        permission: "customers.view",
        children: [
          { label: "ثبت مشتری", href: "/customers/new", permission: "customers.manage", icon: Plus, sectionLabel: "مشتری" },
          { label: "مشتریان", href: "/customers", icon: Users, sectionLabel: "مشتری" },
          { label: "گروه‌های مشتری", href: "/customer-groups", icon: Tags, sectionLabel: "اطلاعات پایه مشتری" },
          { label: "مناطق فروش", href: "/territories", feature: "customerTerritories", icon: MapPin, sectionLabel: "اطلاعات پایه مشتری" },
          { label: "شرایط پرداخت", href: "/payment-terms", feature: "paymentTerms", icon: CalendarClock, sectionLabel: "اطلاعات پایه مشتری" },
        ],
      },
      { label: "کارکنان", href: "/employees", icon: UserRound, permission: "employees.view" },
      { label: "دپارتمان‌ها", href: "/departments", icon: Building2, permission: "employees.manage" },
      // Visible with items.view; write actions inside both pages need items.manage.
      { label: "کالاها", href: "/items", icon: Package, permission: "items.view" },
      { label: "دسته‌بندی کالاها", href: "/item-categories", icon: Tags, permission: "items.view" },
      { label: "واحدها", href: "/units", icon: Boxes, permission: "purchases.manage" },
    ],
  },
];

const underPath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// Admin-panel routes (not in navGroups — AppShell renders that menu itself).
const ADMIN_ROUTE_PERMISSIONS: [string, string][] = [
  ["/admin/users", "users.create"],
  ["/admin/add-users", "users.create"],
  ["/admin/user-activity", "users.create"],
  ["/admin/deleted-records", "users.create"],
  ["/admin/roles", "users.create"],
  ["/admin/permissions", "users.create"],
  ["/admin/user-permissions", "users.create"],
  ["/admin/reports", "reports.view"],
];

// Every permission a route needs, derived from the same nav data that hides
// menu entries — so a URL typed by hand is blocked exactly where the link is
// hidden. UX only: the backend re-checks each request (SessionAuthGuard +
// @RequirePermissions). Unknown routes need nothing here (and 404 or
// redirect on their own).
export function requiredPermissionsFor(pathname: string): string[] {
  for (const [prefix, permission] of ADMIN_ROUTE_PERMISSIONS) {
    if (underPath(pathname, prefix)) return [permission];
  }
  for (const group of navGroups) {
    for (const item of group.items) {
      const children = item.children ?? [];
      const childHits = children.filter((child) => underPath(pathname, child.href));
      if (!underPath(pathname, item.href) && childHits.length === 0) continue;
      const required = [item.permission];
      // The most specific matching child (longest href) can add its own gate.
      const best = childHits.sort((a, b) => b.href.length - a.href.length)[0];
      if (best?.permission) required.push(best.permission);
      return required;
    }
  }
  return [];
}
