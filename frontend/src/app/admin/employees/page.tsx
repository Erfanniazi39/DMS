"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// This page moved to the top-level "/employees" route. Anything that still
// links here (an old bookmark, etc.) gets bounced there automatically.
export default function AdminEmployeesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employees");
  }, [router]);
  return null;
}
