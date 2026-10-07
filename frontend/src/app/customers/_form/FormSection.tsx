import type { ReactNode } from "react";

// Section chrome shared across the blocks of CustomerForm (copied from app/purchases/_form) — a plain
// bordered surface with a small uppercase label, not a heavy decorative
// Card. Kept local to this form rather than added to ../shared, since it's
// specific to this page's layout.
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
