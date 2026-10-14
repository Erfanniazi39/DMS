import Link from "next/link";
import { Fragment } from "react";

// A candidate code: ASCII letters/digits joined by hyphens (SO-1405-000020,
// CUS-000003, MILK-001…). Only the ones the backend confirms (/letters/
// resolve-codes: the record exists and this reader may open its page) become
// links; everything else stays plain text — dates like 1405-07-21 are harmless.
const CODE_PATTERN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g;
const MAX_CODES = 30;

export function extractCodeCandidates(text: string): string[] {
  return [...new Set(text.match(CODE_PATTERN) ?? [])].slice(0, MAX_CODES);
}

// Renders text with confirmed codes as one-click links to their pages.
export function LinkedText({ text, links }: { text: string; links: Record<string, string> }) {
  const parts: { value: string; href?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE_PATTERN)) {
    const index = match.index ?? 0;
    const href = links[match[0]];
    if (!href) continue;
    if (index > last) parts.push({ value: text.slice(last, index) });
    parts.push({ value: match[0], href });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ value: text.slice(last) });

  return (
    <>
      {parts.map((part, index) =>
        part.href ? (
          <Link key={index} href={part.href} className="font-mono text-primary underline underline-offset-2 hover:text-primary-hover" dir="ltr">
            {part.value}
          </Link>
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </>
  );
}
