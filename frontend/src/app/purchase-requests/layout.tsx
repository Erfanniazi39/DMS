// This module lives at the top-level "/purchase-requests" route (not "/admin/purchase-requests"),
// but it still shares the same header/sidebar chrome as the rest of the
// admin panel — same approach as app/employees/layout.tsx: re-export the
// shared AppShell (components/app-shell/AppShell.tsx) rather than duplicating it.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
