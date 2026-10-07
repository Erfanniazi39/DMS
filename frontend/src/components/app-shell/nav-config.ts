// Sidebar navigation data for the app shell (AppShell.tsx). Pure data —
// adding a module's nav entry is a one-line edit here. The dashboard link,
// reports link, and the "مدیریت سیستم" (system administration) menu are
// rendered directly by AppShell, not from this list.

import {
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  ClipboardPen,
  FilePlus2,
  MapPin,
  Package,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Truck,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

// `permission` on a child is checked in addition to the parent's — used to
// hide create routes from users who can only view (e.g. purchases.view
// without purchases.manage).
// `sectionLabel` groups children that belong to the same sub-concept (e.g.
// "خرید" vs "درخواست خرید" both living under the single "خرید" parent) —
// consecutive children sharing a `sectionLabel` are boxed together with a
// subtly shaded background and a small heading (see `groupChildren` in
// AppShell.tsx).
export type NavChild = { label: string; href: string; permission?: string; icon?: LucideIcon; sectionLabel?: string };

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
    label: "تراکنش‌ها",
    items: [
      {
        label: "خرید",
        href: "/purchases",
        icon: ShoppingCart,
        permission: "purchases.view",
        children: [
          { label: "ثبت خرید", href: "/purchases/new", permission: "purchases.manage", icon: Plus, sectionLabel: "خرید" },
          { label: "خریدها", href: "/purchases", icon: ShoppingBag, sectionLabel: "خرید" },
          { label: "ثبت درخواست خرید", href: "/purchase-requests/new", permission: "purchases.manage", icon: FilePlus2, sectionLabel: "درخواست خرید" },
          { label: "درخواست‌های خرید", href: "/purchase-requests", icon: ClipboardList, sectionLabel: "درخواست خرید" },
        ],
      },
      // Inventory (Sales batch 1). The old "فروش" → /admin/sales entry was a
      // dead link (no page) and was removed; the real Sales routes come with
      // the later Sales batches.
      {
        label: "موجودی",
        href: "/inventory",
        icon: Warehouse,
        permission: "inventory.view",
        children: [
          { label: "لیست موجودی", href: "/inventory", icon: Boxes },
          { label: "اصلاح موجودی", href: "/inventory/adjustments", icon: ClipboardPen },
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
          { label: "مناطق فروش", href: "/territories", icon: MapPin, sectionLabel: "اطلاعات پایه مشتری" },
          { label: "شرایط پرداخت", href: "/payment-terms", icon: CalendarClock, sectionLabel: "اطلاعات پایه مشتری" },
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
