// This module lives at the top-level "/item-categories" route (not under "/admin"),
// but it still shares the same header/sidebar chrome as the rest of the
// admin panel — same approach as app/units/layout.tsx: re-export the
// existing AdminLayout component as-is rather than duplicating it.
export { default, useAdminUser, AdminUserContext } from "../admin/layout";
