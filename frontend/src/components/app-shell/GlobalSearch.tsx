"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Hit = { id: number; title: string; subtitle: string | null; href: string };
type Group = { key: string; label: string; hits: Hit[] };

const MIN_LENGTH = 2;

// Header search: type a document number, customer/supplier/item name, or (for
// admins) a username. Results are grouped and already limited by the backend to
// what this user may open. Enter opens the first result; Escape closes.
export default function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; groups: Group[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_LENGTH;

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = window.setTimeout(() => {
      apiFetch<{ query: string; groups: Group[] }>(`/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (!active) return;
          setResult(data);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [trimmed, ready]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    setResult(null);
    router.push(href);
  }

  const current = ready && result?.query === trimmed ? result : null;
  const firstHit = current?.groups[0]?.hits[0];

  return (
    <div className="relative hidden md:block" ref={boxRef}>
      <label className="flex h-9 items-center overflow-hidden rounded-lg border border-input bg-background">
        <span className="flex h-full w-10 shrink-0 items-center justify-center border-e border-input text-muted-foreground">
          <Search className="size-4" aria-hidden="true" />
        </span>
        <span className="sr-only">جستجو در سامانه</span>
        <input
          className="h-full w-64 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-3 focus:ring-ring/20"
          placeholder="جستجو: شماره سند، مشتری، کالا..."
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && firstHit) go(firstHit.href);
          }}
        />
      </label>
      {open && trimmed.length > 0 ? (
        <div className="absolute end-0 top-11 z-40 max-h-[70vh] w-[26rem] overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-lg" role="listbox">
          {!ready ? <p className="px-3 py-3 text-sm text-muted-foreground">حداقل ۲ حرف وارد کنید.</p> : null}
          {ready && failed ? <p className="px-3 py-3 text-sm text-destructive">جستجو ناموفق بود.</p> : null}
          {ready && !failed && !current ? <p className="px-3 py-3 text-sm text-muted-foreground">در حال جستجو...</p> : null}
          {current && current.groups.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">نتیجه‌ای یافت نشد.</p> : null}
          {current?.groups.map((group) => (
            <div key={group.key} className="py-1">
              <p className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">{group.label}</p>
              {group.hits.map((hit) => (
                <button key={`${group.key}-${hit.id}`} type="button" role="option" aria-selected="false" className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-right text-sm hover:bg-muted" onClick={() => go(hit.href)}>
                  <span className="min-w-0 truncate">{hit.title}</span>
                  {hit.subtitle ? <span className="shrink-0 truncate text-xs text-muted-foreground">{hit.subtitle}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
