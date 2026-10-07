"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, customerStatusLabels, customerStatusTone, type DuplicateCandidate } from "../shared";

// Inline "possible duplicate" panel for the CUSTOMER_POSSIBLE_DUPLICATE 409
// (same name or same phone as an existing customer — a soft warning; an
// exact national id match is a hard block and never reaches here).
//
// Deliberately a plain inline banner, NOT a Dialog/modal/window.confirm —
// same rule as purchases/_form/RequestPicker.tsx (see
// purchases/README.md "LANDMINE"). All state lives in CustomerForm.tsx.
export function DuplicateCandidates({
  candidates,
  saving,
  onConfirm,
  onCancel,
}: {
  candidates: DuplicateCandidate[];
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p>
          مشتری با نام یا شماره تلفن مشابه از قبل ثبت شده است. اگر مطمئن هستید این مشتری متفاوت است، ثبت را تأیید کنید؛ در غیر این صورت از مشتری موجود استفاده کنید.
        </p>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Link href={`/customers/${candidate.id}`} target="_blank" className="font-mono text-xs text-primary hover:underline">
              {candidate.customerNumber}
            </Link>
            <span className="font-medium">{candidate.name}</span>
            <StatusBadge label={customerStatusLabels[candidate.status]} tone={customerStatusTone[candidate.status]} />
            <span className="ms-auto text-xs text-muted-foreground">
              تطابق: {candidate.matchedOn.map((field) => (field === "name" ? "نام" : "تلفن")).join(" و ")}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onConfirm} disabled={saving}>
          {saving ? "در حال ذخیره..." : "مشتری متفاوت است — ثبت کن"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          انصراف
        </Button>
      </div>
    </div>
  );
}
