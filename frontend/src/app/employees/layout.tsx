// The employees page lives at the top-level "/employees" route (not
// "/admin/employees"), but it still shares the same header/sidebar chrome
// as the rest of the admin panel. Rather than duplicating that ~150-line
// layout, this re-exports the existing AdminLayout component as-is.
export { default, useAdminUser, AdminUserContext } from "../admin/layout";
