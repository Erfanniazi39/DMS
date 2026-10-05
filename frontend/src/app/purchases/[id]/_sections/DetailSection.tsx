import type { ReactNode } from "react";

// Section chrome matching PurchaseForm.tsx's local FormSection — a plain
// bordered surface with a small header, not a heavy decorative Card. Kept
// local to this page (rather than added to ../../shared) so it never affects
// any other module's look; `action` is for a section-level button such as
// "افزودن پرداخت" placed at the end of the header row.
export function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// The page's toast callbacks (from useToasts() in page.tsx), handed down to
// each section so every section reports through the same ToastViewport.
export type SectionToasts = {
  pushError: (message: string) => void;
  pushErrors: (messages: string[]) => void;
  pushSuccess: (message: string) => void;
};
