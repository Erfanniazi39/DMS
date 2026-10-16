"use client";

// The app-wide shell (header, sidebar nav, session loading) shared by every
// authenticated route. Each route segment's layout.tsx re-exports this as its
// default (e.g. app/purchases/layout.tsx, app/admin/layout.tsx). Nav entries
// live in ./nav-config.ts; the session context lives in lib/session.tsx.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BookOpenText, ChevronDown, ChevronLeft, LogOut, Menu, X } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-info";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { SessionUserContext, type SessionUser } from "@/lib/session";
import GlobalSearch from "./GlobalSearch";
import { activeHref, requiredPermissionsFor, visibleNav, type NavBadge, type NavGroup, type NavItem } from "./nav-config";

function UnreadBadge({ count, label = "نامهٔ خوانده‌نشده" }: { count: number; label?: string }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground" aria-label={`${count} ${label}`}>
      {count > 99 ? "۹۹+" : count.toLocaleString("fa-IR")}
    </span>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // The one expanded sidebar item (accordion). null = follow the current page:
  // the item holding it is open. Reset on every navigation.
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setOpenItem(null);
    setMobileNavOpen(false);
  }

  // Unread letters, for the sidebar badge. Polled lightly (no websockets in
  // v1): on every navigation, when the tab regains focus, and once a minute.
  const [unreadLetters, setUnreadLetters] = useState(0);
  const canUseLetters = user?.permissions.includes("letters.use") ?? false;
  useEffect(() => {
    if (!canUseLetters) return;
    let active = true;
    const refresh = () => {
      apiFetch<{ count: number }>("/letters/unread-count")
        .then((data) => {
          if (active) setUnreadLetters(data.count);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("dms:letters-changed", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("dms:letters-changed", refresh);
    };
  }, [canUseLetters, pathname]);

  // Approvals waiting for this user (workflow engine), for the «کارتابل تأییدها»
  // badge — same light polling as letters; the document page fires
  // "dms:workflow-changed" after a decision so the badge drops at once.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const canUseApprovals = (user?.permissions.includes("workflow.inbox") && user?.features?.workflowApprovals) ?? false;
  useEffect(() => {
    if (!canUseApprovals) return;
    let active = true;
    const refresh = () => {
      apiFetch<{ count: number }>("/workflow/inbox/count")
        .then((data) => {
          if (active) setPendingApprovals(data.count);
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("dms:workflow-changed", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("dms:workflow-changed", refresh);
    };
  }, [canUseApprovals, pathname]);

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

  const groups = visibleNav(user);
  const currentHref = activeHref(groups, pathname);
  const itemHolds = (item: NavItem) => (item.links ? item.links.some((link) => link.href === currentHref) : item.href === currentHref);
  const currentItem = groups.flatMap((group) => group.items).find(itemHolds)?.key ?? null;
  const expandedItem = openItem ?? currentItem;
  const badgeCount = (badge?: NavBadge) => (badge === "letters" ? unreadLetters : badge === "approvals" ? pendingApprovals : 0);
  const routeAllowed = requiredPermissionsFor(pathname).every((permission) => user.permissions.includes(permission));

  return (
    <SessionUserContext.Provider value={user}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-20 flex h-16 print:hidden items-center justify-between border-b border-border bg-card px-4 shadow-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="منو" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
              <Menu />
            </Button>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              <BookOpenText className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{APP_NAME}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{APP_TAGLINE}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-3">
            <GlobalSearch />
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
          {mobileNavOpen ? <div className="fixed inset-0 z-30 bg-black/40 lg:hidden print:hidden" aria-hidden="true" onClick={() => setMobileNavOpen(false)} /> : null}
          <aside
            className={`fixed inset-y-0 right-0 z-40 flex w-72 flex-col border-s border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform print:hidden lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100vh-4rem)] lg:w-60 lg:shrink-0 lg:translate-x-0 lg:border-s-0 lg:border-e ${mobileNavOpen ? "visible translate-x-0" : "invisible translate-x-full lg:visible"}`}
          >
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4 lg:hidden">
              <span className="text-sm font-semibold">منو</span>
              <Button variant="ghost" size="icon" aria-label="بستن منو" onClick={() => setMobileNavOpen(false)}>
                <X />
              </Button>
            </div>
            <nav className="flex min-h-0 flex-1 flex-col" aria-label="ناوبری اصلی">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
                {groups.filter((group) => !group.pinned).map((group, index) => (
                  <NavSection key={group.label ?? index} group={group} currentHref={currentHref} currentItem={currentItem} expandedItem={expandedItem} onToggle={setOpenItem} badgeCount={badgeCount} />
                ))}
              </div>
              {groups.some((group) => group.pinned) ? (
                <div className="space-y-1 border-t border-sidebar-border p-3">
                  {groups.filter((group) => group.pinned).map((group, index) => (
                    <NavSection key={index} group={group} currentHref={currentHref} currentItem={currentItem} expandedItem={expandedItem} onToggle={setOpenItem} badgeCount={badgeCount} />
                  ))}
                </div>
              ) : null}
            </nav>
          </aside>
          <main className="min-w-0 flex-1">
            {routeAllowed ? children : (
              <div className="p-4 sm:p-6 lg:p-8">
                <p className="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground">شما اجازه دسترسی به این بخش را ندارید.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </SessionUserContext.Provider>
  );
}

type NavSectionProps = {
  group: NavGroup;
  currentHref: string | null;
  currentItem: string | null;
  expandedItem: string | null;
  onToggle: (key: string | null) => void;
  badgeCount: (badge?: NavBadge) => number;
};

const rowBase = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors";
const rowIdle = "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground";
const rowCurrent = "bg-sidebar-accent font-medium text-sidebar-accent-foreground";

// One sidebar group: an optional small heading, then its items. A leaf item is
// a link; an expandable item is a header that opens its plain-text links
// (accordion — opening one closes the others). Only the current page's row is
// highlighted; its item's header is just bolder.
function NavSection({ group, currentHref, currentItem, expandedItem, onToggle, badgeCount }: NavSectionProps) {
  return (
    <div className="space-y-0.5">
      {group.label ? <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-sidebar-foreground/45">{group.label}</p> : null}
      {group.items.map((item) => {
        const Icon = item.icon;
        const count = badgeCount(item.badge);
        if (!item.links) {
          const current = item.href === currentHref;
          return (
            <Link key={item.key} href={item.href ?? "/"} className={`${rowBase} ${current ? rowCurrent : rowIdle}`} aria-current={current ? "page" : undefined}>
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {count > 0 ? <UnreadBadge count={count} label={item.badge === "approvals" ? "مورد در انتظار تأیید" : undefined} /> : null}
            </Link>
          );
        }
        const expanded = expandedItem === item.key;
        const holdsCurrent = currentItem === item.key;
        return (
          <div key={item.key}>
            <button
              type="button"
              className={`${rowBase} ${holdsCurrent ? "font-semibold text-sidebar-accent-foreground hover:bg-sidebar-accent/60" : rowIdle}`}
              aria-expanded={expanded}
              onClick={() => onToggle(expanded ? "" : item.key)}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate text-start">{item.label}</span>
              {count > 0 ? <UnreadBadge count={count} /> : null}
              <ChevronLeft className={`size-3.5 shrink-0 opacity-60 transition-transform ${expanded ? "-rotate-90" : ""}`} />
            </button>
            {expanded ? (
              <div className="my-1 ms-5 space-y-0.5 border-s border-sidebar-border ps-2">
                {item.links.map((link) => {
                  const current = link.href === currentHref;
                  return (
                    <div key={link.href}>
                      {link.section ? <p className="px-3 pb-0.5 pt-2 text-[11px] text-sidebar-foreground/45">{link.section}</p> : null}
                      <Link href={link.href} className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors ${current ? rowCurrent : rowIdle}`} aria-current={current ? "page" : undefined}>
                        <span className="flex-1 truncate">{link.label}</span>
                        {item.badge === "letters" && link.href === "/letters" && count > 0 ? <UnreadBadge count={count} /> : null}
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
