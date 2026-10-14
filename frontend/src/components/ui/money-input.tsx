"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { normalizeDigits } from "@/lib/number-input";

// Whole-Rial amount input: shows thousands separators while typing
// (200000 → 200,000) but its value — and so everything the parent sends to
// the API and the database — is the plain digit string. The separators exist
// only on screen. Persian/Arabic digits typed are converted; anything that
// is not a digit (letters, commas, a decimal point) is dropped. Money is
// whole Rials (Decimal(15,0)); quantities are NOT money — keep a plain
// <Input inputMode="decimal"> for those.

export function groupThousands(rawDigits: string): string {
  return rawDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Plain digits from whatever was typed or pasted; no leading zeros ("0" alone
// is kept). Anything after a decimal point is dropped, so a stored "15000000.00"
// stays 15,000,000 instead of becoming 1,500,000,000.
export function toRawDigits(text: string): string {
  const [whole] = normalizeDigits(text).split(".");
  return whole.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

type MoneyInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  /** Plain digits, or "" when empty. */
  value: string;
  onChange: (rawDigits: string) => void;
};

export function MoneyInput({ value, onChange, dir = "ltr", inputMode = "numeric", ...props }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  // How many digits were left of the caret after the last edit; restored
  // after React re-renders the formatted text so typing mid-number doesn't
  // throw the caret to the end.
  const digitsBeforeCaret = useRef<number | null>(null);
  const display = groupThousands(toRawDigits(value));

  useLayoutEffect(() => {
    const input = ref.current;
    const target = digitsBeforeCaret.current;
    digitsBeforeCaret.current = null;
    if (!input || target === null || document.activeElement !== input) return;
    let position = 0;
    let seen = 0;
    while (position < display.length && seen < target) {
      if (/\d/.test(display[position])) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  });

  return (
    <Input
      {...props}
      ref={ref}
      dir={dir}
      inputMode={inputMode}
      autoComplete="off"
      value={display}
      onChange={(event) => {
        const text = event.target.value;
        const caret = event.target.selectionStart ?? text.length;
        digitsBeforeCaret.current = toRawDigits(text.slice(0, caret)).length;
        onChange(toRawDigits(text));
      }}
    />
  );
}
