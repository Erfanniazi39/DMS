// Top-level "/sales-reports" route sharing the admin chrome — same approach
// as app/inventory/layout.tsx and app/purchases/layout.tsx: re-export the
// shared AppShell.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
