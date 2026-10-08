// Top-level "/deliveries" route sharing the admin chrome — same approach as
// app/sales-orders/layout.tsx: re-export the shared AppShell.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
