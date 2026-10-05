// App-wide form-field primitives shared by every module's create/edit forms.

export const textareaClass =
  "min-h-16 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground";
export const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

// Only required fields are marked (a small red asterisk after the label
// text) — optional fields get no marker at all.
export function RequiredMark() {
  return <span className="text-destructive"> *</span>;
}
