"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

// Building blocks for browser-print document pages (/<doc>/[id]/print) —
// first used by delivery notes (Sales batch 3), meant to be reused by
// invoices and credit notes. No PDF library: the page is laid out like the
// paper document and printed with the browser's own dialog (window.print()).
// globals.css sets the A4 @page; AppShell hides its header/sidebar with
// print:hidden; everything here that is screen-only carries print:hidden too.

/** Screen-only toolbar above the sheet: print + back. */
export function PrintToolbar({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="mx-auto mb-3 flex max-w-[210mm] items-center justify-between gap-2 print:hidden">
      <Link href={backHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowRight className="size-3.5" aria-hidden="true" />
        {backLabel}
      </Link>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden="true" />
        چاپ
      </Button>
    </div>
  );
}

/** The paper: A4 width on screen with a border; edge-to-edge when printed. */
export function PrintSheet({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto max-w-[210mm] border border-border bg-card p-8 text-[13px] leading-relaxed text-foreground print:max-w-none print:border-0 print:bg-transparent print:p-0">
      {children}
    </article>
  );
}

/**
 * Document heading: title in the middle, number/date block on the start
 * side. `draft` prints a clear "not a valid document" marker.
 */
export function PrintHeader({ title, meta, draft }: { title: string; meta: [string, ReactNode][]; draft?: boolean }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-foreground pb-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
        {meta.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}:</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="text-center">
        <h1 className="text-lg font-bold">{title}</h1>
        {draft ? <p className="mt-1 border border-destructive px-2 py-0.5 text-xs font-semibold text-destructive">پیش‌نویس — فاقد اعتبار</p> : null}
      </div>
      <div className="w-32" aria-hidden="true" />
    </header>
  );
}

/** A bordered label/value block (customer, order, carrier, …). */
export function PrintFields({ rows, columns = 2 }: { rows: [string, ReactNode][]; columns?: 1 | 2 }) {
  return (
    <dl className={`mb-4 grid gap-x-6 gap-y-1 border border-border p-3 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="shrink-0 text-muted-foreground">{label}:</dt>
          <dd>{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Signature boxes at the foot of the document. */
export function PrintSignatures({ boxes }: { boxes: { label: string; name?: string | null }[] }) {
  return (
    <div className="mt-8 grid gap-4 break-inside-avoid" style={{ gridTemplateColumns: `repeat(${boxes.length}, minmax(0, 1fr))` }}>
      {boxes.map((box) => (
        <div key={box.label} className="flex h-28 flex-col justify-between border border-border p-2 text-center text-xs">
          <span className="font-medium">{box.label}</span>
          <span className="text-muted-foreground">{box.name ? `نام: ${box.name}` : "نام و امضا"}</span>
        </div>
      ))}
    </div>
  );
}
