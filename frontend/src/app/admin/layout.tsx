"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ChevronLeft,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Truck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

export type SessionUser = {
  id: number;
  username: string;
  permissions: string[];
};

export const AdminUserContext = createContext<SessionUser | null>(null);

type NavChild = { label: string; href: string };
type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: string;
  // Optional sub-items — rendered as a collapsible group (same pattern as
  // "مدیریت سیستم" below) instead of navigating directly on click.
  children?: NavChild[];
};
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "تراکنش‌ها",
    items: [
      {
        label: "خرید",
        href: "/admin/purchases",
        icon: ShoppingCart,
        permission: "purchases.manage",
        children: [
          { label: "ثبت خرید", href: "/admin/purchases/new" },
          { label: "خریدها", href: "/admin/purchases" },
          { label: "ثبت درخواست خرید", href: "/admin/purchase-requests/new" },
          { label: "درخواست‌های خرید", href: "/admin/purchase-requests" },
        ],
      },
      { label: "فروش", href: "/admin/sales", icon: ReceiptText, permission: "sales.manage" },
    ],
  },
  {
    label: "اطلاعات پایه",
    items: [
      { label: "تأمین‌کنندگان", href: "/admin/suppliers", icon: Truck, permission: "suppliers.manage" },
      { label: "مشتریان", href: "/admin/customers", icon: Users, permission: "customers.manage" },
      { label: "کارکنان", href: "/employees", icon: UserRound, permission: "employees.manage" },
      { label: "دپارتمان‌ها", href: "/admin/departments", icon: Building2, permission: "employees.manage" },
      { label: "کالاها", href: "/admin/products", icon: Package, permission: "products.manage" },
      { label: "دسته‌بندی کالاها", href: "/admin/product-categories", icon: Tags, permission: "products.manage" },
      { label: "واحدها", href: "/admin/units", icon: Boxes, permission: "products.manage" },
    ],
  },
];

export function useAdminUser() {
  return useContext(AdminUserContext);
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  // Which collapsible nav items (those with `children`) are expanded —
  // keyed by the item's href. A route match auto-expands its item even
  // before the user has clicked it (see the "خرید" rendering below).
  const [expandedNavItems, setExpandedNavItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    apiFetch<SessionUser>("/auth/me")
      .then((data) => {
        if (active) setUser(data);
      })
      .catch(() => router.replace("/login"))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
      </div>
    );
  }

  if (!user) return null;

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => user.permissions.includes(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
  const canManageUsers = user.permissions.includes("users.create");
  const isSystemRoute = pathname.startsWith("/admin/users") || pathname.startsWith("/admin/add-users") || pathname.startsWith("/admin/user-activity") || pathname.startsWith("/admin/roles");
  const canViewSystemManagement = canManageUsers;

  return (
    <AdminUserContext.Provider value={user}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card px-4 shadow-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              <BarChart3 className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">سامانه مدیریت کسب‌وکار</p>
              <p className="hidden text-xs text-muted-foreground sm:block">پنل مدیریت داخلی</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-3">
            <label className="hidden h-9 items-center overflow-hidden rounded-lg border border-input bg-background md:flex">
              <span className="flex h-full w-10 shrink-0 items-center justify-center border-e border-input text-muted-foreground">
                <Search className="size-4" aria-hidden="true" />
              </span>
              <span className="sr-only">جستجو در سامانه</span>
              <input className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-3 focus:ring-ring/20" placeholder="جستجو در سامانه" type="search" />
            </label>
            <Button variant="ghost" size="icon" aria-label="اعلان‌ها"><Bell /></Button>
            <div className="relative">
              <Button variant="ghost" className="gap-2 px-2" aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen((open) => !open)}>
                <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{user.username.slice(0, 1).toUpperCase()}</span>
                <span className="hidden max-w-28 truncate text-sm sm:block">{user.username}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
              {userMenuOpen ? (
                <div className="absolute left-0 top-11 z-30 w-48 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                  <div className="border-b border-border px-3 py-2 text-right">
                    <p className="truncate text-sm font-medium">{user.username}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">کاربر سامانه</p>
                  </div>
                  <button className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10" onClick={handleLogout}>
                    <LogOut className="size-4" />
                    خروج از سامانه
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-[1600px] flex-col lg:flex-row">
          <aside className="border-b border-border bg-sidebar text-sidebar-foreground lg:min-h-[calc(100vh-4rem)] lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-e lg:border-sidebar-border">
            <nav className="flex gap-1 overflow-x-auto p-3 lg:sticky lg:top-16 lg:block lg:space-y-5 lg:p-4" aria-label="ناوبری اصلی">
              <button className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium lg:w-full ${pathname === "/admin" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin")}>
                <LayoutDashboard className="size-4" />
                داشبورد
              </button>
              {visibleGroups.map((group) => (
                <div className="shrink-0 lg:space-y-1" key={group.label}>
                  <p className="hidden px-3 pb-1 text-xs font-medium text-sidebar-foreground/60 lg:block">{group.label}</p>
                  <div className="flex gap-1 lg:block">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      // A child's own href isn't always nested under the parent's
                      // path (e.g. "خرید" → /admin/purchases and /admin/purchase-requests
                      // are siblings, not parent/child routes), so it's checked
                      // separately rather than relying on the prefix match alone.
                      const childActive = item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || Boolean(childActive);

                      if (item.children && item.children.length > 0) {
                        const expanded = expandedNavItems[item.href] ?? active;
                        return (
                          <div className="shrink-0 lg:w-full" key={item.href}>
                            <button
                              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm lg:w-full ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
                              onClick={() => setExpandedNavItems((current) => ({ ...current, [item.href]: !expanded }))}
                              aria-expanded={expanded}
                            >
                              <span className="flex items-center gap-3">
                                <ItemIcon className="size-4" />
                                <span className="whitespace-nowrap">{item.label}</span>
                              </span>
                              <ChevronLeft className={`size-4 transition-transform ${expanded ? "-rotate-90" : ""}`} />
                            </button>
                            {expanded ? (
                              <div className="mt-1 space-y-1 pe-3">
                                {item.children.map((child) => {
                                  const childActive = pathname === child.href;
                                  return (
                                    <button
                                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${childActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
                                      key={child.href}
                                      onClick={() => router.push(child.href)}
                                    >
                                      {child.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      return <button className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm lg:w-full ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} key={item.href} onClick={() => router.push(item.href)}><ItemIcon className="size-4" /><span className="whitespace-nowrap">{item.label}</span></button>;
                    })}
                  </div>
                </div>
              ))}
              <div className="flex shrink-0 gap-1 lg:block lg:space-y-1">
                {user.permissions.includes("reports.view") ? <button className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm lg:w-full ${pathname.startsWith("/admin/reports") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin/reports")}><BarChart3 className="size-4" />گزارش‌ها</button> : null}
              </div>
              {canViewSystemManagement ? (
                <div className="mt-4 border-t border-sidebar-border pt-4">
                  <button className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isSystemRoute ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => setSystemMenuOpen((open) => !open)} aria-expanded={systemMenuOpen || isSystemRoute}>
                    <span className="flex items-center gap-3"><ShieldCheck className="size-4" />مدیریت سیستم</span>
                    <ChevronLeft className={`size-4 transition-transform ${systemMenuOpen || isSystemRoute ? "-rotate-90" : ""}`} />
                  </button>
                  {systemMenuOpen || isSystemRoute ? (
                    <div className="mt-1 space-y-1 pe-3">
                      <button className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${pathname === "/admin/users" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin/users")}><Users className="size-4" />کاربران</button>
                      <button className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${pathname === "/admin/add-users" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin/add-users")}><Users className="size-4" />افزودن کاربر</button>
                      <button className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${pathname.startsWith("/admin/user-activity") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin/user-activity")}><ReceiptText className="size-4" />فعالیت کاربران</button>
                      <button className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm ${pathname.startsWith("/admin/roles") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`} onClick={() => router.push("/admin/roles")}><ShieldCheck className="size-4" />نقش‌ها و دسترسی‌ها</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </nav>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </AdminUserContext.Provider>
  );
}
