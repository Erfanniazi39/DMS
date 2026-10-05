// The /admin/* routes (users, roles, permissions, audit log) share the same
// header/sidebar chrome as every other module — re-export the shared AppShell
// (components/app-shell/AppShell.tsx), same pattern as the other module
// layouts. useAdminUser/AdminUserContext/SessionUser are re-exported here only
// so existing `from "@/app/admin/layout"` imports keep working; their
// canonical home is lib/session.tsx.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, useSessionUser, AdminUserContext, SessionUserContext, type SessionUser } from "@/lib/session";
