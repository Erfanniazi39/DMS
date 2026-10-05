// App-wide status badge / color-tone primitives. Each module maps its own
// statuses to a BadgeTone (e.g. purchaseStatusTone in
// app/purchases/shared.tsx) — the tone→class mapping lives here once so the
// colors never drift between modules.

export type BadgeTone = "primary" | "secondary" | "muted" | "accent" | "destructive" | "success" | "warning";

const toneClasses: Record<BadgeTone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-secondary-foreground/15 bg-secondary text-secondary-foreground",
  muted: "border-border bg-muted text-muted-foreground",
  accent: "border-accent-foreground/15 bg-accent text-accent-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
};

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

// A light full-cell tint (same colors/opacity as the badge above, just
// without the border/pill shape) — used on list tables so a status/payment
// column reads as a color block at a glance, not just a small chip.
export const toneCellClasses: Record<BadgeTone, string> = {
  primary: "bg-primary/10",
  secondary: "bg-secondary",
  muted: "bg-muted",
  accent: "bg-accent",
  destructive: "bg-destructive/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
};

// A small "what does this color mean" key, placed once above/below a list
// whose columns use toneCellClasses/StatusBadge tones — so the coloring is
// explained rather than left for the user to guess.
export function ColorLegend({ title, items }: { title: string; items: { label: string; tone: BadgeTone }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{title}:</span>
      {items.map((item) => (
        <StatusBadge key={item.label} label={item.label} tone={item.tone} />
      ))}
    </div>
  );
}
