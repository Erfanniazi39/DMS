import { redirect } from "next/navigation";

export default function UserPermissionsRedirect() {
  redirect("/admin/roles#user-permissions-section");
}
