// Top-level "/sales-invoices" route sharing the admin chrome — same approach
// as app/deliveries/layout.tsx: re-export the shared AppShell.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
