// The employees page lives at the top-level "/employees" route (not
// "/admin/employees"), but it still shares the same header/sidebar chrome
// as the rest of the admin panel. Rather than duplicating that ~150-line
// layout, this re-exports the shared AppShell (components/app-shell/AppShell.tsx).
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
