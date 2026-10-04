// The dashboard lives at the top-level "/main" route (not "/admin"), but it
// still shares the same header/sidebar chrome as the rest of the admin
// panel — same approach as app/employees/layout.tsx and app/purchases/layout.tsx:
// re-export the existing AdminLayout component as-is.
export { default, useAdminUser, AdminUserContext } from "../admin/layout";
