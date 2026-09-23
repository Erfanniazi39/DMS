import { redirect } from "next/navigation";

export default function PermissionsRedirect() {
  redirect("/admin/roles#permissions-section");
}
