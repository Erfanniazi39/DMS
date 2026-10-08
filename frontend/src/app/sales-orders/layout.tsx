// Top-level "/sales-orders" route sharing the admin chrome — same approach as
// app/purchases/layout.tsx: re-export the shared AppShell.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
