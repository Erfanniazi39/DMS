"use client";

import { RequirePermission } from "@/components/require-permission";
import { LetterList } from "../LetterList";

export default function AllLettersPage() {
  return (
    <RequirePermission permission="letters.readAll" message="شما به نظارت بر همهٔ نامه‌ها دسترسی ندارید.">
      <LetterList box="all" />
    </RequirePermission>
  );
}
