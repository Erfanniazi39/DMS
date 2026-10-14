// Top-level "/workflow" route (approval engine, موتور گردش کار) sharing the
// admin chrome — same approach as app/letters/layout.tsx.
export { default } from "@/components/app-shell/AppShell";
export { useAdminUser, AdminUserContext } from "@/lib/session";
