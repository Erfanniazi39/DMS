"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LIST_PAGE_SIZE, ListPagination, type Paginated } from "@/components/ui/list-pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastViewport, useToasts } from "@/components/ui/toast";
import { apiFetch, type ApiError } from "@/lib/api";
import { toPersianDigits } from "@/lib/jalali";
import { formatDateTime, personName, type LetterBox, type LetterListItem } from "./shared";
import { SortHeader, useTableSort } from "@/components/ui/sortable";
import { sortQuery } from "@/lib/table-sort";

const boxText: Record<LetterBox, { title: string; subtitle: string; empty: string }> = {
  inbox: { title: "صندوق دریافت", subtitle: "نامه‌هایی که برای شما ارسال شده است", empty: "نامه‌ای در صندوق دریافت نیست." },
  sent: { title: "نامه‌های ارسال‌شده", subtitle: "نامه‌هایی که شما فرستاده‌اید", empty: "هنوز نامه‌ای ارسال نکرده‌اید." },
  drafts: { title: "پیش‌نویس‌ها", subtitle: "نامه‌های ذخیره‌شده که هنوز ارسال نشده‌اند — فقط شما آن‌ها را می‌بینید", empty: "پیش‌نویسی ندارید." },
  archive: { title: "بایگانی", subtitle: "نامه‌های دریافتی که بایگانی کرده‌اید", empty: "نامه‌ای بایگانی نشده است." },
  all: { title: "همهٔ نامه‌ها", subtitle: "نظارت مدیریتی — همهٔ نامه‌های ارسال‌شده (فقط مشاهده؛ هر بار مشاهدهٔ نامه ثبت می‌شود)", empty: "هنوز نامه‌ای ارسال نشده است." },
};

// One dense table shared by the four mailboxes (inbox / sent / drafts /
// archive). Server-side paging and search (subject or letter number).
export function LetterList({ box }: { box: LetterBox }) {
  const router = useRouter();
  const { toasts, pushError, dismiss } = useToasts();
  const text = boxText[box];
  const [items, setItems] = useState<LetterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const { sort, onSort } = useTableSort(null, () => setPage(1));
  const [total, setTotal] = useState(0);
  const lastQuery = useRef(q);

  useEffect(() => {
    let cancelled = false;
    const searchChanged = lastQuery.current !== q;
    lastQuery.current = q;
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams({ box, page: String(page), pageSize: String(LIST_PAGE_SIZE) });
          if (q.trim()) params.set("q", q.trim());
          const data = await apiFetch<Paginated<LetterListItem>>(`/letters?${params.toString()}${sortQuery(sort)}`);
          if (cancelled) return;
          setItems(data.items);
          setTotal(data.total);
        } catch (reason) {
          if (!cancelled) pushError((reason as ApiError).message ?? "دریافت نامه‌ها ناموفق بود.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      searchChanged ? 300 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, q, page, sort]);

  const showSender = box === "inbox" || box === "archive" || box === "all";
  const showRecipients = box === "sent" || box === "drafts" || box === "all";
  const showRead = box === "sent" || box === "all";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{text.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{text.subtitle}</p>
          </div>
          <Button onClick={() => router.push("/letters/new")}>
            <Plus className="size-4" aria-hidden="true" />
            نامه جدید
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
            <label className="flex h-8 w-72 items-center overflow-hidden rounded-md border border-input bg-background">
              <Search className="mx-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">جستجوی نامه</span>
              <input
                className="min-w-0 flex-1 bg-transparent pe-2 text-xs outline-none placeholder:text-muted-foreground"
                placeholder="موضوع یا شماره نامه"
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>

          {loading && items.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">در حال بارگذاری نامه‌ها...</p>
          ) : items.length === 0 ? (
            <p className="py-14 text-center text-sm text-muted-foreground">{q.trim() ? "نامه‌ای با این مشخصات یافت نشد." : text.empty}</p>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <SortHeader label="شماره" sortKey="letterNumber" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    <SortHeader label="موضوع" sortKey="subject" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    {showSender ? <SortHeader label="فرستنده" sortKey="sender" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" /> : null}
                    {showRecipients ? <th className="px-3 py-2.5 font-medium">گیرندگان</th> : null}
                    <SortHeader label={box === "drafts" ? "آخرین ویرایش" : "تاریخ ارسال"} sortKey="date" sort={sort} onSort={onSort} className="px-3 py-2.5 font-medium" />
                    {showRead ? <th className="px-3 py-2.5 font-medium">خوانده‌شده</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((letter) => (
                    <tr key={letter.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => router.push(`/letters/${letter.id}`)}>
                      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{letter.letterNumber ?? "—"}</td>
                      <td className={`px-3 py-2.5 ${letter.unread ? "font-semibold text-foreground" : ""}`}>
                        <span className="inline-flex items-center gap-2">
                          {letter.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="خوانده‌نشده" /> : null}
                          {letter.subject}
                          {letter.hasAttachments ? <Paperclip className="size-3.5 text-muted-foreground" aria-label="دارای پیوست" /> : null}
                        </span>
                      </td>
                      {showSender ? <td className="px-3 py-2.5 text-muted-foreground">{personName(letter.sender)}</td> : null}
                      {showRecipients ? (
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {letter.recipientCount === 0 ? "—" : `${toPersianDigits(letter.recipientCount)} گیرنده`}
                        </td>
                      ) : null}
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatDateTime(box === "drafts" ? letter.updatedAt : letter.sentAt)}
                      </td>
                      {showRead ? (
                        <td className="px-3 py-2.5">
                          <StatusBadge
                            label={`${toPersianDigits(letter.readCount ?? 0)} از ${toPersianDigits(letter.recipientCount)}`}
                            tone={(letter.readCount ?? 0) === letter.recipientCount ? "success" : "muted"}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length > 0 ? (
            <ListPagination className="border-t border-border px-4 py-2.5" page={page} pageSize={LIST_PAGE_SIZE} total={total} loading={loading} onPageChange={setPage} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
