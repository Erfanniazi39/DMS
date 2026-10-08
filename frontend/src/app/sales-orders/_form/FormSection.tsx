import type { ReactNode } from "react";

// Section chrome for the sales-order form and detail page — the same plain
// bordered surface as purchases/_form/FormSection.tsx (kept local so neither
// module's look depends on the other). `action` is an optional header-row
// button.
export function FormSection({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
