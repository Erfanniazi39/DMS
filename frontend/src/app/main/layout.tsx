// The dashboard lives at the top-level "/main" route (not "/admin"), but it
// still shares the same header/sidebar chrome as the rest of the admin
// panel — same approach as app/employees/layout.tsx and app/purchases/layout.tsx:
// re-export the shared AppShell (components/app-shell/AppShell.tsx).
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
