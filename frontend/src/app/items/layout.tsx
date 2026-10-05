// This module lives at the top-level "/items" route (not under "/admin"),
// but it still shares the same header/sidebar chrome as the rest of the
// admin panel — same approach as app/units/layout.tsx: re-export the
// shared AppShell (components/app-shell/AppShell.tsx) rather than duplicating it.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
